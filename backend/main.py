"""
Brighton Fringe API — FastAPI backend.

Endpoints:
  GET  /api/shows            list & filter shows
  GET  /api/shows/{slug}     single show detail
  GET  /api/genres           distinct genre list
  GET  /api/venues           venue list
  GET  /api/dates            all performance dates
  POST /api/refresh          trigger re-scrape (background)
  GET  /api/refresh/status   scrape progress
  POST /api/refresh/reviews  trigger review scrape (background)
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, Depends, Query, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, exists
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from database import init_db, get_db
from models import Show, Venue, Performance, Review
from scraper import run_scrape
from review_scraper import run_review_scrape
from geocoder import run_geocode

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

# ---------------------------------------------------------------------------
# Global scrape state
# ---------------------------------------------------------------------------

_scrape_state: dict = {
    "running": False,
    "done": 0,
    "total": 0,
    "started_at": None,
    "finished_at": None,
    "last_stats": None,
}

_geocode_state: dict = {
    "running": False,
    "done": 0,
    "total": 0,
    "started_at": None,
    "finished_at": None,
    "last_stats": None,
}

_review_state: dict = {
    "running": False,
    "done": 0,
    "total": 0,
    "started_at": None,
    "finished_at": None,
    "last_stats": None,
}


def _progress(done: int, total: int):
    _scrape_state["done"] = done
    _scrape_state["total"] = total


def _geocode_progress(done: int, total: int):
    _geocode_state["done"] = done
    _geocode_state["total"] = total


def _review_progress(done: int, total: int):
    _review_state["done"] = done
    _review_state["total"] = total


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Bringe API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic response models
# ---------------------------------------------------------------------------

class PerformanceOut(BaseModel):
    id: int
    date: str
    time: str
    standard_price: Optional[float]
    concession_price: Optional[float]
    is_sold_out: bool
    booking_url: str

    model_config = {"from_attributes": True}


class ReviewOut(BaseModel):
    id: int
    source_site: str
    reviewer: str
    rating_stars: Optional[float]
    rating_raw: str
    excerpt: str
    review_url: str

    model_config = {"from_attributes": True}


class ReviewItem(BaseModel):
    """A single review enriched with the show it belongs to. Used by the
    Reviews tab in the UI, which consolidates reviews across all shows."""
    id: int
    show_slug: str
    show_title: str
    source_site: Optional[str]
    reviewer: Optional[str]
    rating_stars: Optional[float]
    rating_raw: Optional[str]
    excerpt: Optional[str]
    review_url: Optional[str]
    fetched_at: Optional[datetime]


class VenueOut(BaseModel):
    id: int
    slug: str
    name: str
    address: Optional[str]
    url: Optional[str]
    lat: Optional[float] = None
    lng: Optional[float] = None

    model_config = {"from_attributes": True}


class PerformanceTime(BaseModel):
    date: str
    time: str


class ShowSummary(BaseModel):
    id: int
    slug: str
    title: str
    company: Optional[str]
    genre: Optional[str]
    duration_minutes: Optional[int]
    age_suitability: Optional[str]
    image_url: Optional[str]
    venue_name: Optional[str]
    venue_slug: Optional[str]
    venue_lat: Optional[float]
    venue_lng: Optional[float]
    min_price: Optional[float]
    next_date: Optional[str]
    next_time: Optional[str]
    # Performance (date, time) pairs filtered to the selected date(s).
    # Empty when no date filter is active (card falls back to next_date).
    times: list[PerformanceTime] = []
    avg_rating: Optional[float]
    review_count: int
    # Best review (highest stars, ties broken by source priority) — surfaced
    # on the card so users can click straight through to a full review.
    top_review_url: Optional[str] = None
    top_review_source: Optional[str] = None
    top_review_rating: Optional[float] = None

    model_config = {"from_attributes": True}


class ShowDetail(BaseModel):
    id: int
    slug: str
    url: str
    title: str
    company: Optional[str]
    genre: Optional[str]
    description: Optional[str]
    duration_minutes: Optional[int]
    age_suitability: Optional[str]
    image_url: Optional[str]
    website: Optional[str]
    instagram: Optional[str]
    twitter: Optional[str]
    facebook: Optional[str]
    accessibility_features: list
    content_warnings: list
    cast: list
    scraped_at: Optional[datetime]
    venue: Optional[VenueOut]
    performances: list[PerformanceOut]
    reviews: list[ReviewOut]

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _venue_name(show: Show) -> Optional[str]:
    return show.venue.name if show.venue else None


def _min_price(show: Show) -> Optional[float]:
    prices = [p.standard_price for p in show.performances if p.standard_price is not None]
    return min(prices) if prices else None


def _next_performance(show: Show) -> tuple[Optional[str], Optional[str]]:
    today = datetime.utcnow().date().isoformat()
    future = [p for p in show.performances if p.date >= today and not p.is_sold_out]
    if not future:
        future = [p for p in show.performances if p.date >= today]
    if not future:
        future = sorted(show.performances, key=lambda p: p.date)
    if future:
        next_p = min(future, key=lambda p: (p.date, p.time or ""))
        return next_p.date, next_p.time
    return None, None


def _avg_rating(show: Show) -> Optional[float]:
    ratings = [r.rating_stars for r in show.reviews if r.rating_stars is not None]
    return round(sum(ratings) / len(ratings), 1) if ratings else None


def _show_summary(show: Show, on_dates: Optional[list[str]] = None) -> ShowSummary:
    if on_dates:
        times = _times_on_dates(show, on_dates)
        # next_date/next_time = earliest performance among the selected days.
        if times:
            next_date, next_time = times[0].date, times[0].time
        else:
            next_date, next_time = None, None
    else:
        next_date, next_time = _next_performance(show)
        times = []
    top = _top_review(show)
    return ShowSummary(
        id=show.id,
        slug=show.slug,
        title=show.title,
        company=show.company,
        genre=show.genre,
        duration_minutes=show.duration_minutes,
        age_suitability=show.age_suitability,
        image_url=show.image_url,
        venue_name=_venue_name(show),
        venue_slug=show.venue.slug if show.venue else None,
        venue_lat=show.venue.lat if show.venue else None,
        venue_lng=show.venue.lng if show.venue else None,
        min_price=_min_price(show),
        next_date=next_date,
        next_time=next_time,
        times=times,
        avg_rating=_avg_rating(show),
        review_count=len(show.reviews),
        top_review_url=top.review_url if top else None,
        top_review_source=top.source_site if top else None,
        top_review_rating=top.rating_stars if top else None,
    )


def _times_on_dates(show: Show, dates: list[str]) -> list[PerformanceTime]:
    """All performance (date, time) pairs the show plays on any of the
    selected dates, sorted by date then time. Deduplicated."""
    seen: set[tuple[str, str]] = set()
    dset = set(dates)
    for p in show.performances:
        if p.date in dset and p.time:
            seen.add((p.date, p.time))
    return [PerformanceTime(date=d, time=t) for d, t in sorted(seen)]


def _top_review(show: Show):
    """Pick the most useful single review to surface on the card. Highest
    star rating wins; ties broken by review presence of a URL then by source
    site preference order. Returns the Review row or None."""
    reviews = [r for r in show.reviews if r.review_url]
    if not reviews:
        return None
    source_rank = {
        "The Reviews Hub": 0,
        "Broadway Baby": 1,
        "Fringe Review": 2,
    }
    reviews.sort(
        key=lambda r: (
            -(r.rating_stars or 0),
            source_rank.get(r.source_site, 99),
        )
    )
    return reviews[0]


# ---------------------------------------------------------------------------
# Routes — data
# ---------------------------------------------------------------------------

@app.get("/api/shows", response_model=list[ShowSummary])
async def list_shows(
    q: Optional[str] = None,
    genres: list[str] = Query(default_factory=list),
    venue_slug: Optional[str] = None,
    dates: list[str] = Query(default_factory=list),
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    min_rating: Optional[float] = None,
    free_only: bool = False,
    accessible: bool = False,
    sort: str = Query("next_date", pattern="^(next_date|title|price|rating)$"),
    limit: int = Query(100, le=500),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Show)
        .outerjoin(Show.venue)
        .outerjoin(Show.performances)
    )

    filters = []
    if q:
        term = f"%{q}%"
        filters.append(or_(
            Show.title.ilike(term),
            Show.company.ilike(term),
            Show.description.ilike(term),
        ))
    if genres:
        # Exact match against the user-selected set. Multi-select on the
        # filter ribbon turns this into an OR across genres.
        filters.append(Show.genre.in_(genres))
    if venue_slug:
        filters.append(Venue.slug == venue_slug)
    if dates:
        filters.append(Performance.date.in_(dates))
    if free_only:
        filters.append(Performance.standard_price == 0)
    if min_price is not None:
        filters.append(Performance.standard_price >= min_price)
    if max_price is not None:
        filters.append(Performance.standard_price <= max_price)
    if accessible:
        filters.append(Show.accessibility_features != "[]")

    if filters:
        stmt = stmt.where(and_(*filters))

    stmt = stmt.distinct(Show.id).options(
        selectinload(Show.venue),
        selectinload(Show.performances),
        selectinload(Show.reviews),
    )

    result = await db.execute(stmt)
    shows = result.scalars().unique().all()

    # Compute summaries and sort in Python (simpler than SQL for derived fields)
    summaries = [_show_summary(s, on_dates=dates) for s in shows]

    # min_rating filtered in Python because it's derived from joined reviews.
    if min_rating is not None:
        summaries = [s for s in summaries if (s.avg_rating or 0) >= min_rating]

    today = datetime.utcnow().date().isoformat()
    if sort == "next_date":
        summaries.sort(key=lambda s: (s.next_date or "9999", s.next_time or ""))
    elif sort == "title":
        summaries.sort(key=lambda s: s.title.lower())
    elif sort == "price":
        summaries.sort(key=lambda s: (s.min_price is None, s.min_price or 0))
    elif sort == "rating":
        summaries.sort(key=lambda s: (s.avg_rating is None, -(s.avg_rating or 0)))

    return summaries[offset: offset + limit]


@app.get("/api/shows/{slug}", response_model=ShowDetail)
async def get_show(slug: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Show)
        .where(Show.slug == slug)
        .options(
            selectinload(Show.venue),
            selectinload(Show.performances),
            selectinload(Show.reviews),
        )
    )
    show = result.scalar_one_or_none()
    if not show:
        raise HTTPException(status_code=404, detail="Show not found")
    return ShowDetail(
        **{c.name: getattr(show, c.name) for c in Show.__table__.columns},
        venue=VenueOut.model_validate(show.venue) if show.venue else None,
        performances=[PerformanceOut.model_validate(p) for p in show.performances],
        reviews=[ReviewOut.model_validate(r) for r in show.reviews],
    )


@app.get("/api/genres")
async def list_genres(db: AsyncSession = Depends(get_db)):
    """Distinct genres ordered by show count, most popular first.

    Genres used by only a single show are excluded — most of them are
    scraper noise (marketing strap-lines or one-off labels) rather than
    real categories. >=2 shows is a cheap signal that it's a real grouping.

    The frontend uses the head of this list for the quick-filter pill row,
    so the most-used categories (Theatre / Comedy / Music etc.) appear as
    pills rather than the alphabetically-earliest ones.
    """
    result = await db.execute(
        select(Show.genre, func.count(Show.id))
        .where(Show.genre.isnot(None), Show.genre != "")
        .group_by(Show.genre)
        .having(func.count(Show.id) >= 2)
        .order_by(func.count(Show.id).desc(), Show.genre.asc())
    )
    return [row[0] for row in result.fetchall() if row[0]]


@app.get("/api/venues", response_model=list[VenueOut])
async def list_venues(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Venue).order_by(Venue.name))
    return result.scalars().all()


@app.get("/api/dates")
async def list_dates(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Performance.date).distinct().order_by(Performance.date)
    )
    return [r[0] for r in result.fetchall()]


@app.get("/api/reviews", response_model=list[ReviewItem])
async def list_reviews(
    # Review-side filters
    min_rating: Optional[float] = None,
    source: Optional[str] = None,
    # Show-side filters (mirror /api/shows so the main FilterBar applies
    # consistently when the user is on the Reviews tab)
    q: Optional[str] = None,
    genres: list[str] = Query(default_factory=list),
    venue_slug: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    free_only: bool = False,
    accessible: bool = False,
    # Performance-date filter (Reviews tab clears this on entry, but the
    # date strip can still be used to narrow to "what's on tonight that's
    # well reviewed")
    dates: list[str] = Query(default_factory=list),
    limit: int = Query(500, le=2000),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """All collected reviews, joined to their show. Highest-rated first.

    Accepts the same filter set as /api/shows so the main FilterBar in
    the UI works consistently across the List / Venues / Map / Reviews
    tabs. Filters that target a Performance row (dates / price / free)
    are applied via an EXISTS subquery so a review isn't duplicated when
    its show plays many matching performances.
    """
    stmt = (
        select(Review, Show.slug, Show.title)
        .join(Show, Show.id == Review.show_id)
        .where(Review.review_url.isnot(None), Review.review_url != "")
    )

    # --- Review-side filters ---
    if min_rating is not None:
        stmt = stmt.where(Review.rating_stars >= min_rating)
    if source:
        stmt = stmt.where(Review.source_site == source)

    # --- Show-side filters ---
    if q:
        term = f"%{q}%"
        stmt = stmt.where(
            or_(
                Show.title.ilike(term),
                Show.company.ilike(term),
                Show.description.ilike(term),
                Review.excerpt.ilike(term),
            )
        )
    if genres:
        stmt = stmt.where(Show.genre.in_(genres))
    if venue_slug:
        stmt = stmt.join(Venue, Show.venue_id == Venue.id).where(
            Venue.slug == venue_slug
        )
    if accessible:
        stmt = stmt.where(Show.accessibility_features != "[]")

    # --- Performance-row filters via EXISTS so reviews don't dupe ---
    perf_filters = []
    if dates:
        perf_filters.append(Performance.date.in_(dates))
    if free_only:
        perf_filters.append(Performance.standard_price == 0)
    if min_price is not None:
        perf_filters.append(Performance.standard_price >= min_price)
    if max_price is not None:
        perf_filters.append(Performance.standard_price <= max_price)
    if perf_filters:
        perf_exists = exists().where(
            and_(Performance.show_id == Show.id, *perf_filters)
        )
        stmt = stmt.where(perf_exists)

    # Coalesce nulls to -1 so rating-less reviews sink to the bottom of
    # the desc sort (SQLite puts NULL first on DESC otherwise).
    stmt = stmt.order_by(
        func.coalesce(Review.rating_stars, -1).desc(),
        Review.fetched_at.desc(),
    )

    result = await db.execute(stmt)
    rows = result.fetchall()
    items = [
        ReviewItem(
            id=review.id,
            show_slug=show_slug,
            show_title=show_title,
            source_site=review.source_site,
            reviewer=review.reviewer,
            rating_stars=review.rating_stars,
            rating_raw=review.rating_raw,
            excerpt=review.excerpt,
            review_url=review.review_url,
            fetched_at=review.fetched_at,
        )
        for review, show_slug, show_title in rows
    ]
    return items[offset: offset + limit]


@app.get("/api/stats")
async def stats(db: AsyncSession = Depends(get_db)):
    show_count = (await db.execute(select(func.count(Show.id)))).scalar()
    venue_count = (await db.execute(select(func.count(Venue.id)))).scalar()
    review_count = (await db.execute(select(func.count(Review.id)))).scalar()
    return {"shows": show_count, "venues": venue_count, "reviews": review_count}


# ---------------------------------------------------------------------------
# Routes — refresh
# ---------------------------------------------------------------------------

@app.post("/api/refresh")
async def trigger_refresh(
    background_tasks: BackgroundTasks,
    force: bool = False,
):
    if _scrape_state["running"]:
        return {"status": "already_running"}

    async def _run():
        _scrape_state["running"] = True
        _scrape_state["done"] = 0
        _scrape_state["total"] = 0
        _scrape_state["started_at"] = datetime.utcnow().isoformat()
        _scrape_state["finished_at"] = None
        try:
            stats = await run_scrape(progress_callback=_progress, force_refresh=force)
            _scrape_state["last_stats"] = stats
        except Exception as exc:
            # Catch here rather than letting it bubble out of the
            # BackgroundTask -- that path renders an unsightly 500
            # traceback in the API console even though the API itself
            # is still healthy. Surface the message via last_stats so
            # the UI's RefreshPanel shows what went wrong.
            log.exception("Scrape failed")
            _scrape_state["last_stats"] = {
                "scraped": 0,
                "skipped": 0,
                "errors": 1,
                "total": 0,
                "error_message": str(exc),
            }
        finally:
            _scrape_state["running"] = False
            _scrape_state["finished_at"] = datetime.utcnow().isoformat()

    background_tasks.add_task(_run)
    return {"status": "started"}


@app.get("/api/refresh/status")
async def refresh_status():
    return _scrape_state


@app.post("/api/refresh/reviews")
async def trigger_review_refresh(
    background_tasks: BackgroundTasks,
    force: bool = False,
):
    if _review_state["running"]:
        return {"status": "already_running"}

    async def _run():
        _review_state["running"] = True
        _review_state["done"] = 0
        _review_state["total"] = 0
        _review_state["started_at"] = datetime.utcnow().isoformat()
        _review_state["finished_at"] = None
        try:
            stats = await run_review_scrape(
                progress_callback=_review_progress,
                force=force,
            )
            _review_state["last_stats"] = stats
        finally:
            _review_state["running"] = False
            _review_state["finished_at"] = datetime.utcnow().isoformat()

    background_tasks.add_task(_run)
    return {"status": "started"}


@app.get("/api/refresh/reviews/status")
async def review_refresh_status():
    return _review_state


@app.post("/api/venues/{slug}/geocode", response_model=VenueOut)
async def geocode_one_venue(slug: str, db: AsyncSession = Depends(get_db)):
    """Geocode a single venue on demand. Used by the UI when a user clicks
    a venue that doesn't yet have map coordinates. If we don't yet have
    a street address on file, we fetch the venue's Brighton Fringe page
    first so Nominatim has something better than just the name."""
    from geocoder import geocode_one as _geocode_one, is_virtual_venue
    from scraper import fetch_venue_details

    result = await db.execute(select(Venue).where(Venue.slug == slug))
    venue = result.scalar_one_or_none()
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")

    # Streaming / online / virtual venues have no physical address; return
    # them as-is so the UI can flag them as online events without polling
    # Nominatim pointlessly.
    if is_virtual_venue(venue.name):
        return venue

    from curl_cffi.requests import AsyncSession as ImpersonatingSession
    from geocoder import _in_brighton

    # Same TLS-impersonation client the bulk scraper uses, so the venue
    # page fetch doesn't get 403d by Cloudflare.
    async with ImpersonatingSession(impersonate="chrome124") as client:
        page_coords = None
        if venue.url:
            details = await fetch_venue_details(venue.url, client)
            if details.get("address") and not venue.address:
                venue.address = details["address"]
            fetched_coords = details.get("coords")
            if fetched_coords and _in_brighton(*fetched_coords):
                page_coords = fetched_coords
        coords = page_coords or await _geocode_one(
            client, venue.name, venue.address
        )
    if coords:
        venue.lat, venue.lng = coords
        venue.geocoded_at = datetime.utcnow()
    await db.commit()
    await db.refresh(venue)
    return venue


@app.post("/api/refresh/geocode")
async def trigger_geocode(background_tasks: BackgroundTasks, force: bool = False):
    if _geocode_state["running"]:
        return {"status": "already_running"}

    async def _run():
        _geocode_state["running"] = True
        _geocode_state["done"] = 0
        _geocode_state["total"] = 0
        _geocode_state["started_at"] = datetime.utcnow().isoformat()
        _geocode_state["finished_at"] = None
        try:
            stats = await run_geocode(progress_callback=_geocode_progress, force=force)
            _geocode_state["last_stats"] = stats
        finally:
            _geocode_state["running"] = False
            _geocode_state["finished_at"] = datetime.utcnow().isoformat()

    background_tasks.add_task(_run)
    return {"status": "started"}


@app.get("/api/refresh/geocode/status")
async def geocode_status():
    return _geocode_state
