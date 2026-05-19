"""
Dump the live SQLite DB into static JSON files for the public read-only
build of the site.

Files written, all under frontend/public/data/ :

  shows.json        list[ShowSummary]   -- as served by GET /api/shows (no filter)
  show-<slug>.json  ShowDetail          -- one file per show, as served by /api/shows/{slug}
  reviews.json      list[ReviewItem]    -- as served by GET /api/reviews (no filter)
  venues.json       list[VenueOut]      -- as served by GET /api/venues
  dates.json        list[str]           -- distinct performance dates
  genres.json       list[str]           -- popular genres (>=2 shows)
  stats.json        {shows, venues, reviews, generated_at}
  manifest.json     {generated_at, counts}

Run from the project root, with the backend venv active:

  python backend/export_static.py

The frontend's static-mode lib/api will load these files and apply the
same filters in memory that the FastAPI server would.
"""

from __future__ import annotations

import asyncio
import json
import sys
import textwrap
from datetime import datetime, timezone
from pathlib import Path
from collections import Counter

# Allow running as a script from project root: python backend/export_static.py
HERE = Path(__file__).parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import selectinload  # noqa: E402

from database import SessionLocal, init_db  # noqa: E402
from models import Show, Venue, Performance, Review  # noqa: E402

OUTPUT_DIR = HERE.parent / "frontend" / "public" / "data"


def _show_summary(show: Show) -> dict:
    perfs = list(show.performances or [])
    today = datetime.now(timezone.utc).date().isoformat()

    # Earliest still-future, not-sold-out performance (mirrors API logic)
    future_open = [p for p in perfs if p.date >= today and not p.is_sold_out]
    future_any  = [p for p in perfs if p.date >= today]
    chosen = None
    if future_open:
        chosen = min(future_open, key=lambda p: (p.date, p.time or ""))
    elif future_any:
        chosen = min(future_any, key=lambda p: (p.date, p.time or ""))
    elif perfs:
        chosen = min(perfs, key=lambda p: (p.date, p.time or ""))

    prices = [p.standard_price for p in perfs if p.standard_price is not None]
    min_price = min(prices) if prices else None
    ratings = [r.rating_stars for r in (show.reviews or []) if r.rating_stars is not None]
    avg_rating = round(sum(ratings) / len(ratings), 1) if ratings else None

    # Best review (highest stars, ties broken by source priority)
    reviews_with_url = [r for r in (show.reviews or []) if r.review_url]
    SOURCE_RANK = {"The Reviews Hub": 0, "Broadway Baby": 1, "Fringe Review": 2}
    if reviews_with_url:
        reviews_with_url.sort(
            key=lambda r: (-(r.rating_stars or 0), SOURCE_RANK.get(r.source_site, 99))
        )
        top = reviews_with_url[0]
        top_review_url = top.review_url
        top_review_source = top.source_site
        top_review_rating = top.rating_stars
    else:
        top_review_url = top_review_source = top_review_rating = None

    venue = show.venue
    return {
        "id": show.id,
        "slug": show.slug,
        "title": show.title,
        "company": show.company,
        "genre": show.genre,
        "duration_minutes": show.duration_minutes,
        "age_suitability": show.age_suitability,
        "image_url": show.image_url,
        "venue_name": venue.name if venue else None,
        "venue_slug": venue.slug if venue else None,
        "venue_lat":  venue.lat  if venue else None,
        "venue_lng":  venue.lng  if venue else None,
        "min_price": min_price,
        "summary": (
            textwrap.shorten(show.description, width=440, placeholder="…")
            if show.description
            else None
        ),
        "next_date": chosen.date if chosen else None,
        "next_time": chosen.time if chosen else None,
        # `times` is empty here -- it's a date-filter-derived field;
        # static mode will reconstruct it client-side when the user
        # picks dates.
        "times": [],
        "avg_rating": avg_rating,
        "review_count": len(show.reviews or []),
        "top_review_url": top_review_url,
        "top_review_source": top_review_source,
        "top_review_rating": top_review_rating,
        # Extra fields used by the static-mode in-memory filter that the
        # live API doesn't bother serialising:
        "_perfs": [
            {
                "date": p.date,
                "time": p.time or "",
                "standard_price": p.standard_price,
                "is_sold_out": bool(p.is_sold_out),
            }
            for p in perfs
        ],
        "_accessibility_features": list(show.accessibility_features or []),
        "_description": show.description or "",
    }


def _show_detail(show: Show) -> dict:
    venue = show.venue
    return {
        "id": show.id,
        "slug": show.slug,
        "url": show.url,
        "title": show.title,
        "company": show.company,
        "genre": show.genre,
        "description": show.description,
        "duration_minutes": show.duration_minutes,
        "age_suitability": show.age_suitability,
        "image_url": show.image_url,
        "website": show.website,
        "instagram": show.instagram,
        "twitter": show.twitter,
        "facebook": show.facebook,
        "accessibility_features": list(show.accessibility_features or []),
        "content_warnings": list(show.content_warnings or []),
        "cast": list(show.cast or []),
        "scraped_at": show.scraped_at.isoformat() if show.scraped_at else None,
        "venue": (
            {
                "id": venue.id,
                "slug": venue.slug,
                "name": venue.name,
                "address": venue.address,
                "url": venue.url,
                "lat": venue.lat,
                "lng": venue.lng,
            }
            if venue
            else None
        ),
        "performances": [
            {
                "id": p.id,
                "date": p.date,
                "time": p.time or "",
                "standard_price": p.standard_price,
                "concession_price": p.concession_price,
                "is_sold_out": bool(p.is_sold_out),
                "booking_url": p.booking_url or "",
            }
            for p in (show.performances or [])
        ],
        "reviews": [
            {
                "id": r.id,
                "source_site": r.source_site,
                "reviewer": r.reviewer,
                "rating_stars": r.rating_stars,
                "rating_raw": r.rating_raw or "",
                "excerpt": r.excerpt or "",
                "review_url": r.review_url or "",
            }
            for r in (show.reviews or [])
        ],
    }


async def export_all():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc).isoformat()

    await init_db()
    async with SessionLocal() as session:
        # Eager-load everything we need so we can serialise without
        # triggering async lazy-loads.
        result = await session.execute(
            select(Show).options(
                selectinload(Show.venue),
                selectinload(Show.performances),
                selectinload(Show.reviews),
            )
        )
        shows = list(result.scalars().unique().all())

        result = await session.execute(select(Venue).order_by(Venue.name))
        venues = list(result.scalars().all())

    # ---- shows.json + per-show detail files ----
    summaries = [_show_summary(s) for s in shows]
    summaries.sort(key=lambda s: (s["next_date"] or "9999", s["next_time"] or ""))
    (OUTPUT_DIR / "shows.json").write_text(
        json.dumps(summaries, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    details_dir = OUTPUT_DIR / "shows"
    details_dir.mkdir(exist_ok=True)
    # Clear stale detail files (shows that have been removed).
    current_slugs = {s.slug for s in shows}
    for old in details_dir.glob("*.json"):
        if old.stem not in current_slugs:
            old.unlink()
    for s in shows:
        (details_dir / f"{s.slug}.json").write_text(
            json.dumps(_show_detail(s), ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )

    # ---- venues.json ----
    venues_payload = [
        {
            "id": v.id,
            "slug": v.slug,
            "name": v.name,
            "address": v.address,
            "url": v.url,
            "lat": v.lat,
            "lng": v.lng,
        }
        for v in venues
    ]
    (OUTPUT_DIR / "venues.json").write_text(
        json.dumps(venues_payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    # ---- dates.json (distinct performance dates) ----
    all_dates = sorted({p["date"] for s in summaries for p in s["_perfs"]})
    (OUTPUT_DIR / "dates.json").write_text(
        json.dumps(all_dates, ensure_ascii=False),
        encoding="utf-8",
    )

    # ---- genres.json (count desc, >= 2 shows) ----
    genre_counts = Counter(s["genre"] for s in summaries if s["genre"])
    genres = [g for g, n in sorted(genre_counts.items(), key=lambda kv: (-kv[1], kv[0])) if n >= 2]
    (OUTPUT_DIR / "genres.json").write_text(
        json.dumps(genres, ensure_ascii=False),
        encoding="utf-8",
    )

    # ---- reviews.json (flattened, sorted highest-rated first) ----
    review_items = []
    for s in shows:
        for r in (s.reviews or []):
            if not r.review_url:
                continue
            review_items.append(
                {
                    "id": r.id,
                    "show_slug": s.slug,
                    "show_title": s.title,
                    "source_site": r.source_site,
                    "reviewer": r.reviewer,
                    "rating_stars": r.rating_stars,
                    "rating_raw": r.rating_raw or "",
                    "excerpt": r.excerpt or "",
                    "review_url": r.review_url,
                    "fetched_at": r.fetched_at.isoformat() if r.fetched_at else None,
                }
            )
    # Two stable sorts: secondary first (fetched_at desc), then primary
    # (rating_stars desc, nulls last). Python's sort is stable so ties
    # in rating preserve the date ordering.
    review_items.sort(
        key=lambda r: r["fetched_at"] or "",
        reverse=True,
    )
    review_items.sort(
        key=lambda r: r["rating_stars"] if r["rating_stars"] is not None else -1,
        reverse=True,
    )
    (OUTPUT_DIR / "reviews.json").write_text(
        json.dumps(review_items, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    # ---- stats.json + manifest.json ----
    stats = {
        "shows": len(shows),
        "venues": len(venues),
        "reviews": len(review_items),
        "generated_at": generated_at,
    }
    (OUTPUT_DIR / "stats.json").write_text(
        json.dumps(stats, ensure_ascii=False),
        encoding="utf-8",
    )
    manifest = {
        "generated_at": generated_at,
        "counts": {
            "shows": len(shows),
            "venues": len(venues),
            "reviews": len(review_items),
            "dates": len(all_dates),
            "genres": len(genres),
        },
    }
    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    total_kb = sum(
        f.stat().st_size for f in OUTPUT_DIR.rglob("*.json")
    ) / 1024
    print(
        f"Wrote {len(shows)} shows, {len(venues)} venues, "
        f"{len(review_items)} reviews to {OUTPUT_DIR} "
        f"({total_kb:.0f} KB total)."
    )


if __name__ == "__main__":
    asyncio.run(export_all())
