"""
Looks up reviews for Brighton Fringe shows from:
  - Broadway Baby (broadwaybaby.com)
  - Fringe Review  (fringereview.co.uk)
  - The Argus      (theargus.co.uk)
"""

import asyncio
import re
import logging
from typing import Optional
from dataclasses import dataclass
from urllib.parse import quote_plus

import httpx
from bs4 import BeautifulSoup
from sqlalchemy import select, delete, func

from database import SessionLocal
from models import Show, Review

log = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}
CONCURRENCY = 3
REVIEW_SITES = ["Broadway Baby", "Fringe Review", "The Reviews Hub"]


@dataclass
class ReviewData:
    source_site: str
    reviewer: str
    rating_stars: Optional[float]
    rating_raw: str
    excerpt: str
    review_url: str


def stars_from_text(text: str) -> Optional[float]:
    """Extract numeric star rating from various formats."""
    # ★★★★☆ style
    filled = text.count("★")
    if filled:
        return float(filled)
    # "4/5" or "4 out of 5"
    m = re.search(r"(\d(?:\.\d)?)\s*/\s*5", text)
    if m:
        return float(m.group(1))
    m = re.search(r"(\d(?:\.\d)?)\s*out\s*of\s*5", text, re.I)
    if m:
        return float(m.group(1))
    # "4 stars"
    m = re.search(r"(\d(?:\.\d)?)\s*stars?", text, re.I)
    if m:
        return float(m.group(1))
    return None


# ---------------------------------------------------------------------------
# Broadway Baby
# ---------------------------------------------------------------------------

# Broadway Baby renders reviews inline on /reviews (and paginated /reviews/N).
# There is no per-review permalink: each review is an <article>-like block
# with its show title as the heading and a "post-link" to the show page.
# We fetch the listing pages once per process run and cache the parsed
# entries by show title, then look up each show against the cache.

_BB_LISTING_CACHE: dict[str, "ReviewData"] = {}
_BB_LISTING_LOADED = False
_BB_MAX_PAGES = 6  # ~120 most recent reviews; bump if BB pagination needs it.


async def _load_broadway_baby_listing(client: httpx.AsyncClient) -> None:
    """Pull recent Broadway Baby reviews into _BB_LISTING_CACHE keyed by
    normalised show title. Runs at most once per process."""
    global _BB_LISTING_LOADED
    if _BB_LISTING_LOADED:
        return
    _BB_LISTING_LOADED = True

    for page in range(1, _BB_MAX_PAGES + 1):
        url = "https://broadwaybaby.com/reviews" if page == 1 else f"https://broadwaybaby.com/reviews/{page}"
        try:
            resp = await client.get(url, timeout=20)
        except Exception as e:
            log.debug("Broadway Baby listing fetch failed at page %d: %s", page, e)
            break
        if resp.status_code != 200:
            break
        soup = BeautifulSoup(resp.text, "html.parser")

        # Each review article links to the show page via a `.post-link`
        # whose href looks like /shows/<slug>/<id>. Use that as the anchor
        # for one review; the surrounding container's heading is the title
        # and its paragraphs are the body.
        post_links = soup.find_all("a", href=re.compile(r"^https://broadwaybaby\.com/shows/[^/]+/\d+"))
        new_entries = 0
        for post_link in post_links:
            review_url = post_link["href"]
            # Find the surrounding article-like container.
            container = post_link
            for _ in range(6):
                container = container.parent
                if container is None:
                    break
                # A meaningful container has a heading + some paragraphs.
                if container.find(["h2", "h3"]) and len(container.find_all("p")) >= 2:
                    break
            if container is None:
                continue
            title_el = container.find(["h2", "h3"])
            if not title_el:
                continue
            title = _text(title_el)
            if not title:
                continue
            paras = [
                p.get_text(" ", strip=True)
                for p in container.find_all("p")
                if len(p.get_text(strip=True)) > 40
            ]
            excerpt = " ".join(paras[:2])[:400]
            # Star rating: BB uses Unicode stars or an image alt.
            rating_raw = ""
            star_el = container.find(string=re.compile(r"[★]{1,5}"))
            if star_el:
                m = re.search(r"[★]{1,5}", str(star_el))
                rating_raw = m.group(0) if m else ""
            if not rating_raw:
                star_img = container.find("img", alt=re.compile(r"star|rating", re.I))
                if star_img:
                    rating_raw = star_img.get("alt") or ""
            rating_stars = stars_from_text(rating_raw)
            # Reviewer
            author_el = container.find(class_=re.compile(r"author|byline", re.I))
            reviewer = _text(author_el)

            key = _normalise_title(title)
            if key and key not in _BB_LISTING_CACHE:
                _BB_LISTING_CACHE[key] = ReviewData(
                    source_site="Broadway Baby",
                    reviewer=reviewer,
                    rating_stars=rating_stars,
                    rating_raw=rating_raw,
                    excerpt=excerpt,
                    review_url=review_url,
                )
                new_entries += 1
        if new_entries == 0:
            # Page returned no fresh reviews; assume we've hit the end.
            break


def _normalise_title(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


async def search_broadway_baby(show_title: str, client: httpx.AsyncClient) -> list[ReviewData]:
    """Look up the show in the cached Broadway Baby listing."""
    await _load_broadway_baby_listing(client)
    if not _BB_LISTING_CACHE:
        return []

    key = _normalise_title(show_title)
    if not key:
        return []

    # Exact-normalised match first.
    if key in _BB_LISTING_CACHE:
        return [_BB_LISTING_CACHE[key]]

    # Word-overlap fallback so subtle title variations still match.
    target_words = [w for w in key.split() if len(w) >= 4]
    if len(target_words) < 2:
        return []
    target_set = set(target_words)
    best: Optional[tuple[int, ReviewData]] = None
    for cached_key, rev in _BB_LISTING_CACHE.items():
        cached_words = set(w for w in cached_key.split() if len(w) >= 4)
        overlap = len(target_set & cached_words)
        if overlap >= max(2, len(target_set) // 2):
            if best is None or overlap > best[0]:
                best = (overlap, rev)
    return [best[1]] if best else []


# ---------------------------------------------------------------------------
# Fringe Review
# ---------------------------------------------------------------------------

# Fringe Review's rating is rendered as an image badge whose filename names
# the tier ("HIGHLY_RECOMMENDED_SHOW.png"). Map that wording to a star value
# on the conventional 5-point scale used by the rest of the app.
_FR_BADGE_TIERS = [
    (re.compile(r"outstanding",             re.I), 5.0, "Outstanding Show"),
    (re.compile(r"very[\s_-]highly[\s_-]recommended", re.I), 5.0, "Very Highly Recommended"),
    (re.compile(r"highly[\s_-]recommended", re.I), 4.0, "Highly Recommended"),
    (re.compile(r"medium[\s_-]recommended", re.I), 3.0, "Medium Recommended"),
    (re.compile(r"low[\s_-]recommended",    re.I), 2.0, "Low Recommended"),
    # Generic fallback in case FR introduces a new tier.
    (re.compile(r"recommended",             re.I), 3.5, "Recommended"),
]


def _fringe_review_rating_from_badge(soup) -> tuple[Optional[float], str]:
    """Return (stars, human-readable wording) parsed from the .fr-badge
    image filename. Returns (None, '') if no badge is present."""
    badge_img = None
    badge_div = soup.find(class_=re.compile(r"fr-badge", re.I))
    if badge_div:
        badge_img = badge_div.find("img")
    if badge_img is None:
        # Fallback: any image whose src has _RECOMMENDED_ in it.
        for img in soup.find_all("img"):
            src = img.get("src") or ""
            if re.search(r"recommended|outstanding", src, re.I):
                badge_img = img
                break
    if badge_img is None:
        return None, ""
    src = badge_img.get("src", "")
    for pat, stars, label in _FR_BADGE_TIERS:
        if pat.search(src):
            return stars, label
    return None, ""


async def search_fringe_review(show_title: str, client: httpx.AsyncClient) -> list[ReviewData]:
    """Hits Fringe Review's WordPress search, prefers URLs that look like
    Brighton Fringe review permalinks (/review/brighton-fringe/<year>/<slug>/)
    so we don't accidentally pick up news posts about the show."""
    reviews: list[ReviewData] = []
    try:
        q = quote_plus(show_title)
        url = f"https://fringereview.co.uk/?s={q}"
        resp = await client.get(url, timeout=15)
        if resp.status_code != 200:
            return reviews
        soup = BeautifulSoup(resp.text, "html.parser")

        # Score every link on the search page: prefer real review permalinks,
        # then by title-word overlap with the show title.
        title_words = [
            w.lower()
            for w in re.findall(r"[A-Za-z]+", show_title)
            if len(w) >= 4
        ]
        if not title_words:
            return reviews
        candidates: list[tuple[int, int, str]] = []  # (-permalink, -score, url)
        for link in soup.find_all("a", href=True):
            href = link["href"]
            if "fringereview.co.uk" not in href:
                continue
            is_review = 1 if "/review/brighton-fringe/" in href else 0
            slug = href.lower().rsplit("/", 2)[-2] if href.endswith("/") else href.lower().rsplit("/", 1)[-1]
            score = sum(1 for w in title_words if w in slug)
            if is_review and score >= max(1, len(title_words) // 2):
                candidates.append((is_review, score, href))
        if not candidates:
            return reviews
        candidates.sort(key=lambda c: (-c[0], -c[1]))
        rev = await _fetch_fringe_review(candidates[0][2], client)
        if rev:
            reviews.append(rev)
    except Exception as e:
        log.debug("Fringe Review search failed for '%s': %s", show_title, e)
    return reviews


async def _fetch_fringe_review(url: str, client: httpx.AsyncClient) -> Optional[ReviewData]:
    try:
        resp = await client.get(url, timeout=15)
        soup = BeautifulSoup(resp.text, "html.parser")

        # Rating: from the image badge filename.
        rating_stars, rating_label = _fringe_review_rating_from_badge(soup)
        rating_raw = rating_label

        # Reviewer: <span class="author vcard"><a>Name</a></span>
        author_el = soup.find(class_=re.compile(r"\bauthor\b", re.I))
        reviewer = _text(author_el)

        # Body: <div class="fr-maincontent"> with the review title and paragraphs.
        body_el = (
            soup.find(class_=re.compile(r"fr-maincontent", re.I))
            or soup.find(class_=re.compile(r"entry.?content|post.?content", re.I))
        )
        excerpt = ""
        if body_el:
            paras = [
                p.get_text(" ", strip=True)
                for p in body_el.find_all("p")
                if len(p.get_text(strip=True)) > 30
                # Skip the author-attribution paragraph.
                and "author" not in " ".join(p.get("class") or [])
                and "fr-authorattribution" not in " ".join(p.get("class") or [])
            ]
            excerpt = " ".join(paras[:2])[:400]

        return ReviewData(
            source_site="Fringe Review",
            reviewer=reviewer,
            rating_stars=rating_stars,
            rating_raw=rating_raw,
            excerpt=excerpt,
            review_url=url,
        )
    except Exception as e:
        log.debug("Fringe Review fetch failed for %s: %s", url, e)
        return None


def _text(el) -> str:
    return el.get_text(separator=" ", strip=True) if el else ""


# ---------------------------------------------------------------------------
# The Reviews Hub (thereviewshub.com) -- WordPress site, similar to
# Fringe Review in structure.
# ---------------------------------------------------------------------------

async def search_reviews_hub(show_title: str, client: httpx.AsyncClient) -> list[ReviewData]:
    """The Reviews Hub Brighton Fringe reviews all live at slugs like
    https://www.thereviewshub.com/brighton-fringe-<show>-<venue>/. We search
    for the show, then keep only result URLs containing 'brighton-fringe-',
    and score them by word overlap with the show title to pick the best.
    """
    reviews: list[ReviewData] = []
    try:
        q = quote_plus(f"brighton fringe {show_title}")
        url = f"https://www.thereviewshub.com/?s={q}"
        resp = await client.get(url, timeout=15)
        if resp.status_code != 200:
            return reviews
        soup = BeautifulSoup(resp.text, "html.parser")

        # Tokenise the show title into matchable words (drop very short ones
        # like "a", "of", "the" that match anything).
        STOP = {"the", "and", "for", "with", "from", "but", "his", "her", "you", "are"}
        title_words = [
            w.lower()
            for w in re.findall(r"[A-Za-z]+", show_title)
            if len(w) >= 4 and w.lower() not in STOP
        ]
        if not title_words:
            # Title is all stopwords or single-letters; fall back to looser match.
            title_words = [w.lower() for w in re.findall(r"[A-Za-z]+", show_title)]
        if not title_words:
            return reviews

        candidates: list[tuple[int, str]] = []
        # WordPress search puts each hit in an <article>; fall back to any
        # link if the theme isn't using <article>.
        articles = soup.find_all("article") or [soup]
        for art in articles:
            for link in art.find_all("a", href=True):
                href = link["href"]
                # Brighton-Fringe-only filter: ignores TRH Edinburgh / Off-West-
                # End / etc reviews whose titles might otherwise score well.
                if "thereviewshub.com" not in href:
                    continue
                if "/brighton-fringe-" not in href:
                    continue
                # Score: how many distinctive title words are in the URL slug.
                slug = href.rsplit("/brighton-fringe-", 1)[-1].lower()
                score = sum(1 for w in title_words if w in slug)
                if score:
                    candidates.append((score, href))

        if not candidates:
            return reviews

        # Highest overlap first; require at least half the title's distinctive
        # words to match so a generic two-word match doesn't pull in a
        # different show.
        candidates.sort(key=lambda c: -c[0])
        threshold = max(1, len(title_words) // 2)
        best_score, best_href = candidates[0]
        if best_score < threshold:
            return reviews

        # De-dupe URLs (search result link + read-more link both appear).
        rev = await _fetch_reviews_hub_review(best_href, client)
        if rev:
            reviews.append(rev)
    except Exception as e:
        log.debug("Reviews Hub search failed for '%s': %s", show_title, e)
    return reviews


async def _fetch_reviews_hub_review(url: str, client: httpx.AsyncClient) -> Optional[ReviewData]:
    try:
        resp = await client.get(url, timeout=15)
        soup = BeautifulSoup(resp.text, "html.parser")

        # Star ratings on TRH are usually rendered as "★★★★" inline in the
        # post body or in a dedicated rating element. Try both, then fall back
        # to scanning the first ~500 chars of body text.
        rating_el = soup.find(class_=re.compile(r"star|rating|score", re.I))
        rating_raw = _text(rating_el) if rating_el else ""
        if not rating_raw:
            m = re.search(r"[★☆✭✩]{1,5}", soup.get_text())
            rating_raw = m.group(0) if m else ""

        body_el = (
            soup.find(class_=re.compile(r"entry.?content|post.?content|review.?text", re.I))
            or soup.find("article")
        )
        body_text = body_el.get_text(separator=" ", strip=True) if body_el else ""
        rating_stars = stars_from_text(rating_raw) or stars_from_text(body_text[:500])

        # TRH credit line usually reads "Reviewer: Name" or "Reviewed by Name".
        reviewer = ""
        m = re.search(r"Review(?:er|ed by)[:\s]+([^\n.]+)", body_text)
        if m:
            reviewer = m.group(1).strip()[:80]
        if not reviewer:
            reviewer_el = soup.find(class_=re.compile(r"author|byline", re.I))
            reviewer = _text(reviewer_el)[:80]

        excerpt = ""
        if body_el:
            paras = [
                p.get_text(strip=True)
                for p in body_el.find_all("p")
                if len(p.get_text(strip=True)) > 30
            ]
            excerpt = " ".join(paras[:2])[:400]

        return ReviewData(
            source_site="The Reviews Hub",
            reviewer=reviewer,
            rating_stars=rating_stars,
            rating_raw=rating_raw,
            excerpt=excerpt,
            review_url=url,
        )
    except Exception as e:
        log.debug("Reviews Hub fetch failed for %s: %s", url, e)
        return None


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

async def fetch_reviews_for_show(show_id: int, show_title: str, client: httpx.AsyncClient) -> int:
    """Fetch reviews for one show from each source. Returns the number
    of reviews persisted (0 if no source had a match)."""
    all_reviews: list[ReviewData] = []
    all_reviews += await search_broadway_baby(show_title, client)
    all_reviews += await search_fringe_review(show_title, client)
    all_reviews += await search_reviews_hub(show_title, client)

    if not all_reviews:
        return 0

    async with SessionLocal() as session:
        # Bulk delete avoids touching show.reviews (lazy-loaded) under async.
        await session.execute(delete(Review).where(Review.show_id == show_id))
        await session.flush()
        for r in all_reviews:
            session.add(Review(
                show_id=show_id,
                source_site=r.source_site,
                reviewer=r.reviewer,
                rating_stars=r.rating_stars,
                rating_raw=r.rating_raw,
                excerpt=r.excerpt,
                review_url=r.review_url,
            ))
        await session.commit()
    log.info("Saved %d reviews for '%s'", len(all_reviews), show_title)
    return len(all_reviews)


async def run_review_scrape(
    show_ids: Optional[list[int]] = None,
    progress_callback=None,
    force: bool = False,
) -> dict:
    """Fetch reviews for shows.

    By default skips any show that already has at least one review on
    file -- review pages don't change often and re-scraping ~850 shows
    every time is slow. Pass force=True to refresh all shows anyway.

    progress_callback(done, total) is called after each show is processed.
    Returns a stats dict.
    """
    # Drop the BB-listing cache so each scrape run re-fetches the
    # /reviews index and picks up newly-published reviews.
    global _BB_LISTING_LOADED
    _BB_LISTING_LOADED = False
    _BB_LISTING_CACHE.clear()

    stats = {"checked": 0, "skipped": 0, "with_reviews": 0, "errors": 0, "total": 0}

    async with SessionLocal() as session:
        query = select(Show.id, Show.title)
        if show_ids:
            query = query.where(Show.id.in_(show_ids))
        all_rows = (await session.execute(query)).fetchall()

        # Unless force=True, drop shows that already have at least one
        # review attached. Cheap: one grouped count query.
        if not force:
            already = (await session.execute(
                select(Review.show_id, func.count(Review.id))
                .group_by(Review.show_id)
                .having(func.count(Review.id) > 0)
            )).fetchall()
            already_set = {sid for sid, _ in already}
            rows = [r for r in all_rows if r[0] not in already_set]
            stats["skipped"] = len(all_rows) - len(rows)
        else:
            rows = list(all_rows)

    stats["total"] = len(rows)
    if not rows:
        log.info("No shows need reviews fetching (skipped %d).", stats["skipped"])
        if progress_callback:
            progress_callback(0, 0)
        return stats

    done = 0
    sem = asyncio.Semaphore(CONCURRENCY)
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True) as client:
        async def bounded(show_id, title):
            nonlocal done
            async with sem:
                try:
                    n = await fetch_reviews_for_show(show_id, title, client)
                    if n:
                        stats["with_reviews"] += 1
                except Exception:
                    log.exception("Failed to fetch reviews for show %s", title)
                    stats["errors"] += 1
                stats["checked"] += 1
                done += 1
                if progress_callback:
                    progress_callback(done, stats["total"])
                await asyncio.sleep(1)

        await asyncio.gather(*[bounded(sid, title) for sid, title in rows])

    log.info("Review scrape complete: %s", stats)
    return stats
