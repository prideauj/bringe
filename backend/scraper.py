"""
Scrapes Brighton Fringe show data from brightonfringe.org.

Strategy:
  1. Pull all event slugs from events-sitemap.xml
  2. For each slug, fetch the show page and parse with BeautifulSoup
  3. Use multiple extraction strategies (schema.org, meta tags, text heuristics)
  4. Upsert results into SQLite via SQLAlchemy
"""

import asyncio
import re
import logging
from datetime import datetime
from typing import Optional
from dataclasses import dataclass, field

import httpx
from curl_cffi.requests import AsyncSession as ImpersonatingSession
from bs4 import BeautifulSoup
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from database import SessionLocal, init_db
from models import Show, Venue, Performance

log = logging.getLogger(__name__)

BASE_URL = "https://www.brightonfringe.org"
SITEMAP_URL = f"{BASE_URL}/events-sitemap.xml"
# Cloudflare's bot detection on brightonfringe.org returns 403 when only
# the bare-minimum browser headers are sent. Mirroring a real Chrome
# request -- Accept, Accept-Encoding, Connection, Sec-Fetch-*, etc. --
# gets us back to 200. Refresh these if Cloudflare tightens again.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,image/apng,*/*;q=0.8"
    ),
    "Accept-Language": "en-GB,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
}
CONCURRENCY = 8          # parallel fetches
REQUEST_DELAY = 0.3      # seconds between batches


# ---------------------------------------------------------------------------
# Data container
# ---------------------------------------------------------------------------

@dataclass
class ShowData:
    slug: str
    url: str
    title: str = ""
    company: str = ""
    genre: str = ""
    description: str = ""
    duration_minutes: Optional[int] = None
    age_suitability: str = ""
    image_url: str = ""
    website: str = ""
    instagram: str = ""
    twitter: str = ""
    facebook: str = ""
    venue_name: str = ""
    venue_slug: str = ""
    venue_url: str = ""
    accessibility_features: list = field(default_factory=list)
    content_warnings: list = field(default_factory=list)
    cast: list = field(default_factory=list)
    performances: list = field(default_factory=list)


@dataclass
class PerfData:
    date: str            # "2026-05-08"
    time: str            # "19:30"
    standard_price: Optional[float] = None
    concession_price: Optional[float] = None
    is_sold_out: bool = False
    booking_url: str = ""


# ---------------------------------------------------------------------------
# Sitemap helpers
# ---------------------------------------------------------------------------

async def fetch_show_urls(client: ImpersonatingSession) -> list[str]:
    # Cloudflare occasionally serves a 403 on the first sitemap hit
    # (especially after a recent heavy scrape from the same IP). Retry
    # with exponential backoff before giving up.
    last_status: Optional[int] = None
    for attempt in range(4):
        try:
            resp = await client.get(SITEMAP_URL, timeout=30)
        except Exception as exc:
            last_status = None
            log.warning(
                "Sitemap fetch raised %s on attempt %d/4; retrying",
                exc.__class__.__name__, attempt + 1,
            )
            await asyncio.sleep(5 * (attempt + 1))
            continue
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, "xml")
            urls = [
                loc.text.strip()
                for loc in soup.find_all("loc")
                if re.match(
                    r"https://www\.brightonfringe\.org/events/[^/]+/$",
                    loc.text.strip(),
                )
            ]
            log.info("Found %d show URLs in sitemap", len(urls))
            return urls
        last_status = resp.status_code
        if resp.status_code in (403, 429, 503):
            wait = 5 * (attempt + 1)
            log.warning(
                "Sitemap fetch returned %d on attempt %d/4 -- "
                "Cloudflare may be rate-limiting. Waiting %ds.",
                resp.status_code, attempt + 1, wait,
            )
            await asyncio.sleep(wait)
            continue
        # Any other status: don't bother retrying.
        resp.raise_for_status()
    raise RuntimeError(
        f"Could not fetch sitemap after 4 attempts; last status={last_status}. "
        "Wait a few minutes (Cloudflare cools down) and try again."
    )


def slug_from_url(url: str) -> str:
    return url.rstrip("/").rsplit("/", 1)[-1]


# ---------------------------------------------------------------------------
# HTML parsing helpers
# ---------------------------------------------------------------------------

def _text(el) -> str:
    return el.get_text(separator=" ", strip=True) if el else ""


def _find_text(soup, *args, **kwargs) -> str:
    el = soup.find(*args, **kwargs)
    return _text(el)


def parse_price(text: str) -> Optional[float]:
    """Extract first £N.NN or £N from a string."""
    m = re.search(r"£(\d+(?:\.\d{1,2})?)", text)
    return float(m.group(1)) if m else None


def parse_duration(text: str) -> Optional[int]:
    """Return minutes from strings like '60 mins', '1hr 30', '1h30m'."""
    text = text.lower()
    m = re.search(r"(\d+)\s*(?:hr|hour)s?\s*(\d+)?\s*(?:min|minute)?", text)
    if m:
        hrs = int(m.group(1))
        mins = int(m.group(2) or 0)
        return hrs * 60 + mins
    m = re.search(r"(\d+)\s*(?:min|minute)", text)
    if m:
        return int(m.group(1))
    return None


MONTH_MAP = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4,
    "jun": 6, "jul": 7, "aug": 8,
    "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def parse_date(text: str) -> Optional[str]:
    """Return ISO date from 'May 8, 2026' / '8 May 2026' / 'Mon 8 May' etc."""
    text = text.strip()
    # "May 8, 2026"
    m = re.search(r"(\w+)\s+(\d{1,2}),?\s+(\d{4})", text, re.I)
    if m:
        month_name, day, year = m.groups()
        month = MONTH_MAP.get(month_name.lower())
        if month:
            return f"{year}-{month:02d}-{int(day):02d}"
    # "8 May 2026"
    m = re.search(r"(\d{1,2})\s+(\w+)\s+(\d{4})", text, re.I)
    if m:
        day, month_name, year = m.groups()
        month = MONTH_MAP.get(month_name.lower())
        if month:
            return f"{year}-{month:02d}-{int(day):02d}"
    # "Mon 8 May" (no year, assume 2026)
    m = re.search(r"\d{1,2}\s+(\w+)$", text, re.I)
    if m:
        month = MONTH_MAP.get(m.group(1).lower())
        day_m = re.search(r"(\d{1,2})", text)
        if month and day_m:
            return f"2026-{month:02d}-{int(day_m.group(1)):02d}"
    return None


def _extract_description(soup: BeautifulSoup) -> str:
    """Return the show's body description. Tries the page's canonical
    block first, then JSON-LD, then meta tags, then a heuristic paragraph
    scan. Suffixes of the form ' - <Venue> - <date>, <date>, ...' that
    Yoast appends to the meta/JSON-LD versions are stripped."""
    import json as _json

    def _strip_suffix(text: str) -> str:
        # Yoast/Brighton-Fringe pattern:
        # "<description> - <Venue Name> - Tue 5th 2026, Tue 12th 2026, ..."
        # Cut from the last " - <Capitalised word>" that is followed
        # somewhere by a date-looking token.
        m = re.search(
            r"\s*-\s*[^-\n]+?-\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+\d.*$",
            text,
        )
        if m:
            return text[: m.start()].strip()
        return text.strip()

    # 1) Eventotron's .etron-description div -- the canonical full body.
    etron = soup.find(class_=re.compile(r"etron-description", re.I))
    if etron:
        # <br> separators -> spaces, then collapse whitespace.
        for br in etron.find_all("br"):
            br.replace_with(" ")
        text = etron.get_text(" ", strip=True)
        if text:
            return re.sub(r"\s+", " ", text)

    # 2) JSON-LD `description` (Yoast schema graph). Strip the venue+
    # date suffix that gets appended automatically.
    for script in soup.find_all("script", type="application/ld+json"):
        raw = script.string or script.get_text() or ""
        try:
            data_ld = _json.loads(raw)
        except Exception:
            continue
        items = data_ld if isinstance(data_ld, list) else [data_ld]
        graph = []
        for it in items:
            if isinstance(it, dict) and isinstance(it.get("@graph"), list):
                graph.extend(it["@graph"])
            elif isinstance(it, dict):
                graph.append(it)
        for it in graph:
            desc = it.get("description") if isinstance(it, dict) else None
            if isinstance(desc, str) and len(desc) > 40:
                return _strip_suffix(desc)

    # 3) <meta name="description"> / og:description.
    for sel in (
        {"name": "description"},
        {"property": "og:description"},
    ):
        meta = soup.find("meta", attrs=sel)
        if meta:
            content = meta.get("content") or ""
            if content.strip():
                return _strip_suffix(content)

    # 4) Last resort: longest paragraph block in a generic content
    # container.
    container = (
        soup.find(class_=re.compile(r"entry.?content|post.?content|main.?content", re.I))
        or soup.find("article")
        or soup.find("main")
    )
    if container:
        for tag in container.find_all(["nav", "aside", "header", "footer", "form"]):
            tag.decompose()
        paragraphs = [
            p.get_text(" ", strip=True)
            for p in container.find_all("p")
            if len(p.get_text(strip=True)) > 40
        ]
        if paragraphs:
            return " ".join(paragraphs[:4])

    return ""


def parse_time(text: str) -> Optional[str]:
    """Return HH:MM from '7:30 pm', '19:30', '7.30pm', '7pm'."""
    # Hour:Minute (with optional am/pm) — the most specific form.
    m = re.search(r"(\d{1,2})[:.h](\d{2})\s*(am|pm)?", text, re.I)
    if m:
        hour, minute, ampm = int(m.group(1)), int(m.group(2)), (m.group(3) or "").lower()
        if ampm == "pm" and hour < 12:
            hour += 12
        elif ampm == "am" and hour == 12:
            hour = 0
        return f"{hour:02d}:{minute:02d}"
    # Hour-only with am/pm (e.g. "7pm", "11 am"). Skipping any leading
    # number that's clearly part of a date ("3 May 7pm" => 19:00).
    m = re.search(r"\b(\d{1,2})\s*(am|pm)\b", text, re.I)
    if m:
        hour, ampm = int(m.group(1)), m.group(2).lower()
        if ampm == "pm" and hour < 12:
            hour += 12
        elif ampm == "am" and hour == 12:
            hour = 0
        return f"{hour:02d}:00"
    return None


# ---------------------------------------------------------------------------
# Main page parser
# ---------------------------------------------------------------------------

def parse_show_page(url: str, html: str) -> ShowData:
    slug = slug_from_url(url)
    soup = BeautifulSoup(html, "html.parser")
    data = ShowData(slug=slug, url=url)

    # --- Title ---
    h1 = soup.find("h1")
    data.title = _text(h1) if h1 else slug.replace("-", " ").title()

    # --- Open Graph image ---
    og_img = soup.find("meta", property="og:image")
    if og_img:
        data.image_url = og_img.get("content", "")

    # --- Full page text for regex extraction ---
    page_text = soup.get_text(separator="\n", strip=True)

    # --- Genre ---
    # Typical patterns: "Genre: Theatre" or "Comedy" in a badge/label
    genre_el = (
        soup.find(class_=re.compile(r"genre|category|tag", re.I))
        or soup.find("span", string=re.compile(r"Theatre|Comedy|Music|Circus|Dance|Cabaret|Spoken|Children|Family|Visual", re.I))
    )
    if genre_el:
        data.genre = _text(genre_el)
    else:
        m = re.search(r"(?:Genre|Category)[:\s]+([^\n]+)", page_text, re.I)
        if m:
            data.genre = m.group(1).strip()

    # --- Company / Presented by ---
    # Brighton Fringe renders this as
    #   <strong>Company:</strong> Brighton and District Organists Association
    # i.e. a label tag immediately followed by a text node. The previous
    # extraction strategy (class-based, or a `[^\n]+` page-text capture)
    # over-shot massively because the page packs every labelled field
    # onto a single logical line, so the company ended up containing the
    # genre, duration, performer list and half the description.
    data.company = ""
    for strong in soup.find_all("strong"):
        label = _text(strong).rstrip(":").strip().lower()
        if label not in ("company", "presented by", "presenter", "by"):
            continue
        nxt = strong.next_sibling
        if nxt is None:
            continue
        if isinstance(nxt, str):
            data.company = nxt.strip()
        else:
            # An element sibling -- take just its visible text, no recursion
            # into deeper labelled sections.
            data.company = nxt.get_text(" ", strip=True)
        break

    if not data.company:
        # Page-text fallback. Stop at the next known label so we don't
        # spill into Genre / Duration / Venue / Age sections.
        m = re.search(
            r"(?:Company|Presented\s+by|Presenter)\s*:\s*"
            r"([^\n]{1,200}?)"
            r"(?:\s*(?:Genre|Duration|Venue|Age\s+suitability|Babes|Content\s+Warnings|Suitable\s+for)\b|\n|$)",
            page_text,
            re.I,
        )
        if m:
            data.company = m.group(1).strip()

    # Final guardrail: company names are usually short. If we still ended
    # up with a paragraph of description text, drop it rather than
    # propagating the bug to the UI.
    if data.company and len(data.company) > 150:
        data.company = ""

    # --- Description ---
    # Brighton Fringe (Eventotron plugin) puts the full show description
    # inside `<div class="etron-description">` as plain text, separated
    # by <br> rather than <p> tags. The old "find <p> children" approach
    # captured nothing here, so we'd silently fall back to a different
    # container and lose the opening sentence or the whole body.
    data.description = _extract_description(soup)

    # --- Duration ---
    duration_el = soup.find(class_=re.compile(r"duration|runtime|length", re.I))
    duration_text = _text(duration_el) if duration_el else ""
    if not duration_text:
        m = re.search(r"(\d+\s*(?:hr|hour|min|minute)[^|\n]{0,20})", page_text, re.I)
        if m:
            duration_text = m.group(1)
    data.duration_minutes = parse_duration(duration_text)

    # --- Age suitability ---
    # The Brighton Fringe page label is literally "Age suitability:" (two
    # words). The old regex allowed bare "Age" as a label which matched
    # the Shakespeare quote "Age cannot wither her..." in descriptions
    # and produced nonsense values. We now require the full label, then
    # fall back to direct rating tokens (18+, All ages, etc).
    m = re.search(
        r"\bAge\s+suitability\s*:\s*([^\n]+)",
        page_text,
        re.I,
    )
    if not m:
        m = re.search(
            r"\b(?:Suitable\s+for|Suitability)\s*:\s*([^\n]+)",
            page_text,
            re.I,
        )
    if m:
        val = m.group(1).strip()
        # Drop the trailing "(Restriction)" / "(Advisory)" annotations.
        val = re.sub(r"\s*\([^)]*\)\s*$", "", val).strip()
        # Drop a stray <strong></strong> separator that some pages have
        # between the rating and its annotation.
        val = re.sub(r"\s{2,}", " ", val).strip()
        data.age_suitability = val
    else:
        m = re.search(
            r"\b(All ages|Family friendly|18\+|16\+|14\+|12\+|Under\s*\d+|\d+\+)",
            page_text,
            re.I,
        )
        if m:
            data.age_suitability = m.group(1)

    # --- Venue ---
    # The show page has a literal "Venue" / "Venues" label (a heading or
    # similar) and the actual venue link sits immediately after it. We
    # anchor on the label and then walk forward in document order to find
    # the first /venues/<slug> link with a real name. This avoids picking
    # up site-nav / sidebar / breadcrumb links that match the URL pattern
    # but appear earlier in the DOM.
    venue_link = None

    label_node = None
    for tag in soup.find_all(
        ["h1", "h2", "h3", "h4", "h5", "h6", "strong", "label", "dt", "p", "span", "b"]
    ):
        text = _text(tag).strip().rstrip(":").strip()
        if text.lower() in {"venue", "venues"}:
            label_node = tag
            break

    if label_node:
        for el in label_node.find_all_next("a", href=True):
            href = el.get("href", "")
            if not re.search(r"/venues/[^/?#]+", href):
                continue
            text = _text(el).strip()
            if not text or text.lower() in {"venues", "venue"}:
                continue
            venue_link = el
            break

    # Fallback if no label found: scan all /venues/<slug> links, skip
    # ones whose text is just generic "Venues".
    if not venue_link:
        for cand in soup.find_all("a", href=re.compile(r"/venues/[^/?#]+")):
            text = _text(cand)
            if not text or text.lower().strip() in {"venues", "venue"}:
                continue
            venue_link = cand
            break

    if venue_link:
        data.venue_name = _text(venue_link)
        href = venue_link.get("href", "")
        data.venue_slug = href.rstrip("/").rsplit("/", 1)[-1]
        data.venue_url = BASE_URL + href if href.startswith("/") else href
    else:
        m = re.search(r"(?:Venue|At)[:\s]+([^\n]+)", page_text, re.I)
        if m:
            data.venue_name = m.group(1).strip()

    # --- Social links ---
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "instagram.com" in href:
            data.instagram = href
        elif "twitter.com" in href or "x.com" in href:
            data.twitter = href
        elif "facebook.com" in href:
            data.facebook = href

    # External website (not social)
    website_el = soup.find("a", string=re.compile(r"website|more info|official", re.I))
    if website_el:
        href = website_el.get("href", "")
        if href and "brightonfringe.org" not in href and href.startswith("http"):
            data.website = href

    # --- Accessibility features ---
    access_keywords = [
        "wheelchair", "accessible", "audio description", "captioned", "bsl",
        "hearing loop", "assistance dog", "relaxed", "neurodivergent",
    ]
    found_access = []
    for kw in access_keywords:
        if kw.lower() in page_text.lower():
            found_access.append(kw.title())
    data.accessibility_features = found_access

    # --- Content warnings ---
    warnings = []
    for m in re.finditer(r"(?:content warning|contains?)[:\s]+([^\n.]+)", page_text, re.I):
        warnings.append(m.group(1).strip())
    # Also look for haze, strobe etc.
    warning_keywords = ["haze", "smoke", "strobe", "flashing lights", "loud", "adult content", "nudity", "violence"]
    for kw in warning_keywords:
        if kw.lower() in page_text.lower() and kw.title() not in warnings:
            warnings.append(kw.title())
    data.content_warnings = warnings

    # --- Cast ---
    cast_section = soup.find(class_=re.compile(r"cast|performer|crew", re.I))
    if cast_section:
        names = [li.get_text(strip=True) for li in cast_section.find_all("li")]
        data.cast = names if names else []

    # --- Performances ---
    data.performances = _parse_performances(soup, page_text, url)

    return data


_TIME_PATTERN = re.compile(
    r"\b\d{1,2}[:.h]\d{2}\s*(?:am|pm)?\b|\b\d{1,2}\s*(?:am|pm)\b",
    re.I,
)
_DATE_PATTERN = re.compile(
    r"(\d{1,2}\s+\w+\s+\d{4}"
    r"|\w+\s+\d{1,2},?\s+\d{4}"
    r"|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+\d{1,2}\s+\w+"
    r"|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)",
    re.I,
)


def _parse_jsonld_performances(soup: BeautifulSoup) -> list[PerfData]:
    """Try schema.org JSON-LD Event blocks first. Many event sites emit
    a clean machine-readable startDate per performance, which is much more
    reliable than scraping date/time text out of the DOM."""
    import json as _json

    perfs: list[PerfData] = []
    for script in soup.find_all("script", type="application/ld+json"):
        raw = script.string or script.get_text()
        if not raw:
            continue
        try:
            data = _json.loads(raw)
        except Exception:
            continue
        items = data if isinstance(data, list) else [data]
        expanded = []
        for it in items:
            if isinstance(it, dict) and isinstance(it.get("@graph"), list):
                expanded.extend(it["@graph"])
            elif isinstance(it, dict):
                expanded.append(it)
        for item in expanded:
            t = item.get("@type")
            if t != "Event" and not (isinstance(t, list) and "Event" in t):
                continue
            start = item.get("startDate") or item.get("doorTime")
            if not start or not isinstance(start, str):
                continue
            m = re.match(r"(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}):(\d{2}))?", start)
            if not m:
                continue
            date_str = m.group(1)
            # Brighton Fringe's JSON-LD uses T00:00:00 as a "time not set"
            # placeholder for events that didn't specify a clock time.
            # Treat it as no time rather than literally midnight.
            if m.group(2) and not (m.group(2) == "00" and m.group(3) == "00"):
                time_str = f"{m.group(2)}:{m.group(3)}"
            else:
                time_str = ""
            offers = item.get("offers") or {}
            if isinstance(offers, list) and offers:
                offers = offers[0]
            price_raw = offers.get("price") if isinstance(offers, dict) else None
            try:
                std_price = float(price_raw) if price_raw is not None else None
            except (TypeError, ValueError):
                std_price = None
            booking_url = ""
            sold_out = False
            if isinstance(offers, dict):
                booking_url = offers.get("url", "") or ""
                avail = (offers.get("availability") or "").lower()
                sold_out = "soldout" in avail.replace(" ", "")
            perfs.append(PerfData(
                date=date_str,
                time=time_str,
                standard_price=std_price,
                concession_price=None,
                is_sold_out=sold_out,
                booking_url=booking_url,
            ))
    return perfs


# Patterns that strongly indicate the page is describing a free event,
# used to backfill standard_price=0 for performances whose JSON-LD entry
# omitted the price.
_FREE_PATTERNS = [
    re.compile(r"\bfree\s+(?:entry|admission|event|show|performance|ticket)", re.I),
    re.compile(r"(?:price|tickets?|cost)[:\s]+free", re.I),
    re.compile(r"\bthis\s+(?:is|event\s+is)\s+free\b", re.I),
    re.compile(r"\bpay\s+what\s+you\s+(?:want|can|like|decide|wish)", re.I),
]


def _page_indicates_free(soup: BeautifulSoup) -> bool:
    """Return True if the show page prominently advertises itself as free
    or pay-what-you-want. Used to enrich JSON-LD performances whose price
    field was omitted (which Brighton Fringe does for free events)."""
    text = soup.get_text(" ", strip=True)
    return any(p.search(text) for p in _FREE_PATTERNS)


def _parse_performances(soup: BeautifulSoup, page_text: str, base_url: str) -> list[PerfData]:
    """Extract performance date/time/price rows from a show page.

    Strategies, in order of reliability:
      1. JSON-LD schema.org/Event blocks.
      2. DOM grouping: every text node that parses as a date, then walk
         UP to the smallest ancestor whose text ALSO contains a time, and
         take everything off that block. This fixes the previous bug where
         a `performance-date` sibling and a `performance-time` sibling
         were treated as separate "containers" and the time got dropped.
      3. Plain-text line scan as a last resort.
    """
    # --- Strategy 1: JSON-LD ---
    perfs = _parse_jsonld_performances(soup)
    if perfs:
        # Brighton Fringe omits offers.price for free events. If any perf
        # has a null price and the page text advertises the show as free
        # (or pay-what-you-want), backfill standard_price=0 so the UI
        # gets a FREE badge and the free_only filter works.
        if any(p.standard_price is None for p in perfs) and _page_indicates_free(soup):
            for p in perfs:
                if p.standard_price is None:
                    p.standard_price = 0.0
        return _dedupe_perfs(perfs)

    # --- Strategy 2: DOM, grouped by nearest ancestor that has time too ---
    perfs = []
    seen: set[tuple[str, str]] = set()

    TIME_SIGNAL = re.compile(
        r"\b\d{1,2}[:.h]\d{2}\b|\b\d{1,2}\s*(?:am|pm)\b",
        re.I,
    )
    # Anything that indicates a price or free-event marker. "unticketed"
    # is Brighton Fringe's word for drop-in free events.
    PRICE_SIGNAL = re.compile(
        r"£|\bfree\b|pay\s+what|\bunticketed\b|\bdonation\b",
        re.I,
    )

    def _extract_price(text: str) -> tuple[Optional[float], Optional[float]]:
        prices = re.findall(r"£(\d+(?:\.\d{1,2})?)", text)
        if prices:
            std = float(prices[0])
            conc = float(prices[1]) if len(prices) > 1 else None
            return std, conc
        # No £-amount. Catch FREE / Pay-what-you-want / unticketed as zero
        # so the UI's "FREE" badge and free_only filter still kick in.
        if re.search(r"\bfree\b", text, re.I):
            return 0.0, None
        if re.search(r"pay\s+what\s+you\s+(?:want|can|like|decide|wish)", text, re.I):
            return 0.0, None
        if re.search(r"\bunticketed\b", text, re.I):
            return 0.0, None
        return None, None

    for node in soup.find_all(string=_DATE_PATTERN):
        date = parse_date(node.strip())
        if not date:
            continue

        # Walk up the DOM looking for an ancestor that wraps an entire
        # performance row -- one that has BOTH a time and a price/free
        # signal. Brighton Fringe lays each performance out as
        #   <div class="etron-perf-row perfdate-YYYY-MM-DD">
        #     <div class="column-one">date / time / venue</div>
        #     <div class="column-two">price</div>
        #   </div>
        # so the time and price live in SIBLING columns. Stopping at the
        # first ancestor with a time signal (column-one) means we never
        # see the price in column-two.
        #
        # Strategy: walk up until we find both signals, or until the
        # block grows past 800 chars (likely the parent of multiple
        # rows). As a shortcut, treat any ancestor whose class names a
        # "perf-row" / "performance" container as the target row.
        block = None
        time_only_fallback = None
        cur = node.parent
        for _ in range(8):
            if cur is None:
                break
            classes = " ".join(cur.get("class") or []) if hasattr(cur, "get") else ""
            block_text = cur.get_text(" ", strip=True)
            # Explicit perf-row container -> use it directly.
            if re.search(r"perf[-_]row|performance(?!\w)", classes, re.I):
                block = cur
                break
            if len(block_text) > 800:
                break  # Climbed past a single row.
            has_time = bool(TIME_SIGNAL.search(block_text))
            has_price = bool(PRICE_SIGNAL.search(block_text))
            if has_time and has_price:
                block = cur
                break
            if has_time and time_only_fallback is None:
                time_only_fallback = cur
            cur = cur.parent

        if block is None:
            block = time_only_fallback

        if block is None:
            key = (date, "")
            if key not in seen:
                seen.add(key)
                perfs.append(PerfData(date=date, time=""))
            continue

        block_text = block.get_text(" ", strip=True)
        time_str = parse_time(block_text) or ""
        std_price, conc_price = _extract_price(block_text)
        sold_out = bool(re.search(r"sold.?out", block_text, re.I))
        book_link = block.find(
            "a", href=re.compile(r"ticket|book|buy|checkout|basket", re.I)
        )
        booking_url = book_link["href"] if book_link else ""

        key = (date, time_str)
        if key in seen:
            continue
        seen.add(key)
        perfs.append(PerfData(
            date=date,
            time=time_str,
            standard_price=std_price,
            concession_price=conc_price,
            is_sold_out=sold_out,
            booking_url=booking_url,
        ))

    if perfs:
        return perfs

    # --- Strategy 3: text-line scan (last resort) ---
    lines = page_text.split("\n")
    for i, line in enumerate(lines):
        line = line.strip()
        date_m = _DATE_PATTERN.search(line)
        if not date_m:
            continue
        date_str = parse_date(date_m.group(0))
        if not date_str:
            continue
        block = " ".join(lines[i: i + 4])
        time_str = parse_time(block) or ""
        std_price, conc_price = _extract_price(block)
        sold_out = bool(re.search(r"sold.?out", block, re.I))
        key = (date_str, time_str)
        if key in seen:
            continue
        seen.add(key)
        perfs.append(PerfData(
            date=date_str,
            time=time_str,
            standard_price=std_price,
            concession_price=conc_price,
            is_sold_out=sold_out,
        ))

    return perfs


def _dedupe_perfs(perfs: list[PerfData]) -> list[PerfData]:
    seen = set()
    out = []
    for p in perfs:
        key = (p.date, p.time)
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


# ---------------------------------------------------------------------------
# Database upsert
# ---------------------------------------------------------------------------

async def upsert_show(session: AsyncSession, data: ShowData):
    # Upsert venue
    venue_id = None
    if data.venue_name:
        venue_slug = data.venue_slug or re.sub(r"[^a-z0-9]+", "-", data.venue_name.lower()).strip("-")
        result = await session.execute(select(Venue).where(Venue.slug == venue_slug))
        venue = result.scalar_one_or_none()
        if not venue:
            venue = Venue(slug=venue_slug, name=data.venue_name, url=data.venue_url)
            session.add(venue)
            await session.flush()
        venue_id = venue.id

    # Upsert show
    result = await session.execute(select(Show).where(Show.slug == data.slug))
    show = result.scalar_one_or_none()
    if not show:
        show = Show(slug=data.slug, url=data.url)
        session.add(show)

    show.title = data.title
    show.company = data.company
    show.genre = data.genre
    show.description = data.description
    show.duration_minutes = data.duration_minutes
    show.age_suitability = data.age_suitability
    show.image_url = data.image_url
    show.website = data.website
    show.instagram = data.instagram
    show.twitter = data.twitter
    show.facebook = data.facebook
    show.venue_id = venue_id
    show.accessibility_features = data.accessibility_features
    show.content_warnings = data.content_warnings
    show.cast = data.cast
    show.scraped_at = datetime.utcnow()

    await session.flush()

    # Replace performances. Direct bulk delete avoids touching the
    # lazy-loaded show.performances relationship, which would trigger
    # an implicit load and blow up under async SQLAlchemy.
    await session.execute(delete(Performance).where(Performance.show_id == show.id))
    await session.flush()

    for p in data.performances:
        session.add(Performance(
            show_id=show.id,
            date=p.date,
            time=p.time,
            standard_price=p.standard_price,
            concession_price=p.concession_price,
            is_sold_out=p.is_sold_out,
            booking_url=p.booking_url,
        ))

    await session.commit()


# ---------------------------------------------------------------------------
# Venue page scraping (called from the geocoder when a venue's address is
# unknown -- a populated address lets Nominatim resolve the venue reliably
# instead of guessing from the name alone).
# ---------------------------------------------------------------------------

# Brighton/Hove postcodes start with BN. Used as a last-resort heuristic
# to recognise an address line in unstructured page text.
_POSTCODE_RE = re.compile(r"\b(BN\d{1,2}\s*\d[A-Z]{2})\b", re.I)


def _extract_address_from_soup(soup) -> Optional[str]:
    """Try several strategies to pull an address out of a venue page,
    most specific first. Returns a cleaned single-line address or None."""

    def _clean(text: str) -> str:
        text = re.sub(r"\s+", " ", text).strip(" ,;")
        return text

    # 1) JSON-LD with PostalAddress / Place data.
    import json as _json
    for script in soup.find_all("script", type="application/ld+json"):
        raw = script.string or script.get_text() or ""
        try:
            data = _json.loads(raw)
        except Exception:
            continue
        items = data if isinstance(data, list) else [data]
        for it in items:
            if not isinstance(it, dict):
                continue
            addr = it.get("address")
            if isinstance(addr, dict):
                parts = [
                    addr.get("streetAddress"),
                    addr.get("addressLocality"),
                    addr.get("postalCode"),
                ]
                joined = ", ".join(p for p in parts if isinstance(p, str) and p.strip())
                if joined:
                    return _clean(joined)
            if isinstance(addr, str) and addr.strip():
                return _clean(addr)

    # 2) Microdata.
    el = soup.find(attrs={"itemprop": "streetAddress"})
    if el:
        parts = [_text(el)]
        for prop in ("addressLocality", "postalCode"):
            sib = soup.find(attrs={"itemprop": prop})
            if sib:
                parts.append(_text(sib))
        full = ", ".join(p for p in parts if p)
        if full:
            return _clean(full)
    el = soup.find(attrs={"itemprop": "address"})
    if el:
        text = _clean(el.get_text(" ", strip=True))
        if text:
            return text

    # 3) <address> tag.
    el = soup.find("address")
    if el:
        text = _clean(el.get_text(" ", strip=True))
        if text:
            return text

    # 4) Element with class/id containing "address" (but not just "no-address"
    # / "email-address" / etc — require a word match).
    for el in soup.find_all(attrs={"class": re.compile(r"(^|\s|-)address(\s|-|$)", re.I)}):
        text = _clean(el.get_text(" ", strip=True))
        if text and len(text) > 5 and len(text) < 300:
            return text

    # 5) <dt>Address</dt><dd>...</dd><dd>...</dd> -- Brighton Fringe's
    # venue pages use definition lists with one line per <dd>. Collect every
    # <dd> following the labelled <dt> until the next <dt>.
    for dt in soup.find_all("dt"):
        if not re.search(r"\b(address|location)\b", _text(dt), re.I):
            continue
        parts: list[str] = []
        for sib in dt.find_next_siblings():
            if sib.name == "dt":
                break
            if sib.name == "dd":
                t = _text(sib)
                if t:
                    parts.append(t)
        if parts:
            return _clean(", ".join(parts))

    # 6) <h?>Address</h?> followed by sibling <p>/<div>/text lines until
    # the next heading. Same idea as the dl pattern but for sites that
    # use headings + paragraphs rather than definition lists.
    for label in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "strong", "b"]):
        if not re.search(r"^\s*(address|location)\s*:?\s*$", _text(label), re.I):
            continue
        parts = []
        for sib in label.find_next_siblings():
            if sib.name and re.match(r"h[1-6]$", sib.name):
                break
            t = _text(sib)
            if not t:
                continue
            if t.lower() in {"address", "address:", "location", "location:"}:
                continue
            parts.append(t)
            if len(parts) >= 5:  # bound the walk so we don't slurp a footer
                break
        if parts:
            joined = ", ".join(parts)
            # Trim at the first obvious "next section" word if it got swept in.
            joined = re.split(
                r"\b(Phone|Email|Website|Opening|Hours|About|Venue\s+Details|Capacity)\b",
                joined,
                maxsplit=1,
                flags=re.I,
            )[0].rstrip(" ,;")
            if joined:
                return _clean(joined)

    # 7) "Address:" / "Location:" inline label followed by text on the same
    # line (kept as a last-ditch heuristic for non-structured pages).
    for label in soup.find_all(string=re.compile(r"\b(Address|Location)\s*:?\s*$", re.I)):
        parent = label.parent
        if not parent:
            continue
        for ns in parent.find_all_next(string=True):
            text = ns.strip() if isinstance(ns, str) else ""
            if not text or text.lower() in {"address:", "location:", "address", "location"}:
                continue
            if len(text) > 5 and ("brighton" in text.lower() or _POSTCODE_RE.search(text) or "hove" in text.lower()):
                return _clean(text)
            break

    # 6) Postcode-anchored fallback. Find the Brighton postcode and walk
    # backwards looking for the nearest line that names a Brighton-area
    # locality (Brighton / Hove / a street keyword). Beats blindly taking
    # the previous 3 lines, which often picks up nav crumbs.
    page_text = soup.get_text("\n")
    m = _POSTCODE_RE.search(page_text)
    if m:
        before = page_text[: m.start()].splitlines()
        STREET_KW = re.compile(
            r"\b(?:Road|Rd|Street|St|Avenue|Ave|Lane|Ln|Drive|Dr|Square|Sq|"
            r"Place|Pl|Crescent|Cres|Mews|Terrace|Hill|Parade|Way|Court|"
            r"Brighton|Hove)\b",
            re.I,
        )
        # Walk backwards over the last ~10 lines, take the most recent
        # contiguous block that looks address-y (has Brighton/Hove or
        # a street keyword, short-ish lines).
        addr_lines: list[str] = []
        for line in reversed(before[-10:]):
            line = line.strip()
            if not line or len(line) > 120:
                if addr_lines:
                    break
                continue
            if STREET_KW.search(line) or re.search(r"\bBN\d", line, re.I):
                addr_lines.append(line)
            elif addr_lines:
                # Allow one more line of context just above an address-y line
                # (e.g. building name), then stop.
                addr_lines.append(line)
                break
        if addr_lines:
            addr_lines.reverse()
            full = f"{', '.join(addr_lines)}, {m.group(1)}"
            return _clean(full)

    return None


_GMAPS_COORD_PATTERNS = [
    # google.com/maps/embed/v1/place?...&q=LAT,LNG
    # google.com/maps?q=LAT,LNG
    re.compile(
        r"google\.com/maps(?:/embed/v1/place)?\?[^\"'<>]*?[?&]q=([+-]?\d+\.\d+),([+-]?\d+\.\d+)",
        re.I,
    ),
    # Embed iframes with the pb= encoding: ...!3d<lat>!4d<lng>...
    re.compile(
        r"google\.com/maps/embed\?[^\"'<>]*?!3d([+-]?\d+\.\d+)!4d([+-]?\d+\.\d+)",
        re.I,
    ),
    # /maps/@LAT,LNG,zoom
    re.compile(
        r"google\.com/maps/@([+-]?\d+\.\d+),([+-]?\d+\.\d+)",
        re.I,
    ),
    # ?ll=LAT,LNG
    re.compile(
        r"[?&]ll=([+-]?\d+\.\d+),([+-]?\d+\.\d+)",
        re.I,
    ),
]


def _extract_gmaps_coords(html: str) -> Optional[tuple[float, float]]:
    """Find latitude/longitude embedded in a Google Maps URL anywhere on
    the page. Brighton Fringe venue pages contain an embed iframe with
    the venue's exact coords in the `q=` parameter, which beats anything
    Nominatim can do from a free-text address."""
    for pat in _GMAPS_COORD_PATTERNS:
        m = pat.search(html)
        if m:
            try:
                return float(m.group(1)), float(m.group(2))
            except ValueError:
                continue
    return None


async def fetch_venue_details(venue_url: str, client: ImpersonatingSession) -> dict:
    """Fetch a Brighton Fringe venue page and pull out whatever venue
    metadata we can. Returns {"address": str?, "coords": (lat,lng)?}.
    Either key may be absent. Returns {} on transport failure."""
    out: dict = {}
    if not venue_url:
        return out
    try:
        resp = await client.get(venue_url, headers=HEADERS, timeout=15)
        if resp.status_code != 200:
            return out
        html = resp.text
        soup = BeautifulSoup(html, "html.parser")
        addr = _extract_address_from_soup(soup)
        if addr:
            out["address"] = addr
        coords = _extract_gmaps_coords(html)
        if coords:
            out["coords"] = coords
    except Exception as exc:
        log.debug("Venue detail fetch failed for %s: %s", venue_url, exc)
    return out


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

async def scrape_one(url: str, client: ImpersonatingSession) -> Optional[ShowData]:
    try:
        resp = await client.get(url, timeout=20)
        resp.raise_for_status()
        return parse_show_page(url, resp.text)
    except Exception as exc:
        log.warning("Failed to scrape %s: %s", url, exc)
        return None


async def run_scrape(
    progress_callback=None,
    force_refresh: bool = False,
    max_shows: Optional[int] = None,
):
    """
    Main entry point. Fetches sitemap, scrapes each show, upserts to DB.

    progress_callback(done, total) is called after each show is processed.
    Returns dict with stats.
    """
    await init_db()

    stats = {"scraped": 0, "skipped": 0, "errors": 0, "total": 0}

    # Use curl_cffi with a Chrome 124 TLS fingerprint -- Cloudflare's Bot
    # Management on brightonfringe.org blocks httpx/requests/aiohttp (it
    # fingerprints Python's TLS stack) but waves through anything that
    # looks like a real browser.
    async with ImpersonatingSession(
        impersonate="chrome124",
        headers=HEADERS,
    ) as client:
        urls = await fetch_show_urls(client)

        # Filter out already-scraped shows unless force refresh
        if not force_refresh:
            async with SessionLocal() as session:
                result = await session.execute(select(Show.slug))
                existing_slugs = {row[0] for row in result.fetchall()}
            urls = [u for u in urls if slug_from_url(u) not in existing_slugs]
            stats["skipped"] = len(existing_slugs)
            log.info("%d new shows to scrape (skipping %d existing)", len(urls), stats["skipped"])

        if max_shows:
            urls = urls[:max_shows]

        stats["total"] = len(urls) + stats["skipped"]

        sem = asyncio.Semaphore(CONCURRENCY)
        done = stats["skipped"]

        async def fetch_and_save(url: str):
            nonlocal done
            async with sem:
                try:
                    data = await scrape_one(url, client)
                    if data:
                        async with SessionLocal() as session:
                            await upsert_show(session, data)
                        stats["scraped"] += 1
                    else:
                        stats["errors"] += 1
                except Exception:
                    # Isolate per-show failures so one bad row doesn't
                    # cancel sibling tasks and tear down the http client.
                    log.exception("Failed to upsert %s", url)
                    stats["errors"] += 1
                done += 1
                if progress_callback:
                    progress_callback(done, stats["total"])
                await asyncio.sleep(REQUEST_DELAY / CONCURRENCY)

        tasks = [fetch_and_save(u) for u in urls]
        await asyncio.gather(*tasks, return_exceptions=True)

    log.info("Scrape complete: %s", stats)
    return stats


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    asyncio.run(run_scrape())
