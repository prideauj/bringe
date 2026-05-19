"""
Geocoding for Brighton Fringe venues.

Strategy: query OpenStreetMap Nominatim (free, no API key). The service
asks for <=1 request/second and a contact in the User-Agent header. We
respect both. Results are persisted on the Venue row so future startups
don't re-query.
"""

import asyncio
import logging
import re
from datetime import datetime
from typing import Optional

import httpx  # noqa: F401  -- kept for type-compat if other code imports it
from curl_cffi.requests import AsyncSession as ImpersonatingSession
from sqlalchemy import select, or_

from database import SessionLocal
from models import Venue
from scraper import fetch_venue_details

log = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "Bringe Brighton-Fringe browser (https://github.com/local/bringe)"
REQUEST_DELAY = 1.05  # Nominatim policy: max 1 req/sec; small buffer.

# Venue names matching this pattern are virtual / streaming / online and
# have no physical location to geocode. We skip Nominatim for them and
# leave their coords as NULL; the UI renders them as an online event.
_VIRTUAL_VENUE_RE = re.compile(r"\b(streaming|online|virtual|digital)\b", re.I)


def is_virtual_venue(name: str) -> bool:
    return bool(name and _VIRTUAL_VENUE_RE.search(name))


# Loose Brighton/Hove bounding box (left, top, right, bottom).
# Anything Nominatim returns must fall inside this box -- a bare venue name
# like "Lantern Theatre" otherwise matches a London venue.
BRIGHTON_VIEWBOX = "-0.30,50.95,0.10,50.75"
BRIGHTON_LAT_RANGE = (50.75, 50.95)
BRIGHTON_LNG_RANGE = (-0.30, 0.10)


def _in_brighton(lat: float, lng: float) -> bool:
    return (
        BRIGHTON_LAT_RANGE[0] <= lat <= BRIGHTON_LAT_RANGE[1]
        and BRIGHTON_LNG_RANGE[0] <= lng <= BRIGHTON_LNG_RANGE[1]
    )


def _clean_venue_name_for_search(name: str) -> str:
    """Brighton Fringe uses pseudo-venues for walking-tour meeting points
    named like 'MEET: Outside The Walrus' or 'MEET: New Road (opposite
    Theatre Royal)'. The 'MEET:' prefix and the parenthetical qualifier
    are not part of any real place name and confuse Nominatim. Strip them
    so the query is just the underlying place ('The Walrus', 'New Road')."""
    if not name:
        return name
    cleaned = re.sub(r"^\s*MEET\s*:\s*", "", name, flags=re.I)
    cleaned = re.sub(r"\s*\((?:outside|opposite|near|next\s+to|by)[^)]*\)", "", cleaned, flags=re.I)
    cleaned = re.sub(r"^\s*(?:outside|opposite|near|next\s+to|by)\s+", "", cleaned, flags=re.I)
    return cleaned.strip()


async def geocode_one(
    client: httpx.AsyncClient, name: str, address: Optional[str]
) -> Optional[tuple[float, float]]:
    """Return (lat, lng) for a venue or None if it can't be located.

    Queries are constructed so they ALL include 'Brighton' as a tie-breaker,
    and Nominatim is asked to restrict results to the Brighton viewbox
    (bounded=1). Bare venue names without Brighton context are deliberately
    NOT queried -- they match London venues with the same name.
    """
    cleaned_name = _clean_venue_name_for_search(name)
    queries: list[str] = []
    if address:
        queries.append(f"{cleaned_name}, {address}, Brighton, UK")
        queries.append(f"{address}, Brighton, UK")
    queries.append(f"{cleaned_name}, Brighton, UK")
    # If cleaning meaningfully changed the name, also try the raw name as
    # a last resort so we don't regress for real venues that happen to
    # contain words like "Opposite" legitimately.
    if cleaned_name != name and name.strip():
        queries.append(f"{name}, Brighton, UK")

    for q in queries:
        try:
            resp = await client.get(
                NOMINATIM_URL,
                params={
                    "q": q,
                    "format": "json",
                    "limit": 1,
                    "countrycodes": "gb",
                    "viewbox": BRIGHTON_VIEWBOX,
                    "bounded": 1,  # HARD-restrict to the viewbox.
                },
                headers={"User-Agent": USER_AGENT, "Accept-Language": "en-GB"},
                timeout=15.0,
            )
            resp.raise_for_status()
            results = resp.json()
            if results:
                lat = float(results[0]["lat"])
                lng = float(results[0]["lon"])
                # Defence in depth -- if Nominatim ignored bounded=1 (it has
                # been known to in edge cases), reject anything outside.
                if _in_brighton(lat, lng):
                    return lat, lng
                log.warning(
                    "Nominatim returned out-of-Brighton hit for %r at (%.3f,%.3f); ignoring",
                    q, lat, lng,
                )
        except Exception as exc:
            log.warning("Nominatim error for %r: %s", q, exc)
        # Always wait the rate-limit between queries (including failures).
        await asyncio.sleep(REQUEST_DELAY)

    return None


async def run_geocode(progress_callback=None, force: bool = False) -> dict:
    """Geocode all venues that don't yet have coordinates.

    progress_callback(done, total) fires after each venue.
    Returns {"geocoded": int, "skipped": int, "errors": int, "total": int}.
    """
    stats = {"geocoded": 0, "skipped": 0, "errors": 0, "total": 0}

    async with SessionLocal() as session:
        if force:
            result = await session.execute(select(Venue))
        else:
            # Pick venues with no coords OR coords outside the Brighton box
            # (likely fallout from earlier when bounded=0 let Nominatim
            # match a same-named London venue).
            result = await session.execute(
                select(Venue).where(
                    or_(
                        Venue.lat.is_(None),
                        Venue.lng.is_(None),
                        Venue.lat < BRIGHTON_LAT_RANGE[0],
                        Venue.lat > BRIGHTON_LAT_RANGE[1],
                        Venue.lng < BRIGHTON_LNG_RANGE[0],
                        Venue.lng > BRIGHTON_LNG_RANGE[1],
                    )
                )
            )
        venues = list(result.scalars().all())

    stats["total"] = len(venues)
    if not venues:
        log.info("Nothing to geocode.")
        return stats

    log.info("Geocoding %d venue(s) via Nominatim ...", len(venues))

    # follow_redirects is essential: Brighton Fringe redirects venue
    # URLs without a trailing slash (e.g. /venues/foo -> /venues/foo/),
    # and without this we'd see 301s and bail before extracting anything.
    # curl_cffi with a Chrome TLS fingerprint -- the venue-page fetcher
    # (scraper.fetch_venue_details) talks to brightonfringe.org via this
    # client and Cloudflare's Bot Management 403s anything that isn't
    # browser-like. Nominatim doesn't care about TLS fingerprint and is
    # happy to serve us; we still override the User-Agent header per
    # request to identify the app as the policy asks.
    async with ImpersonatingSession(impersonate="chrome124") as client:
        for idx, venue in enumerate(venues, start=1):
            if is_virtual_venue(venue.name):
                stats["skipped"] += 1
                log.info("  skipping virtual venue: %s", venue.name)
                if progress_callback:
                    progress_callback(idx, len(venues))
                continue
            address = venue.address
            page_coords: Optional[tuple[float, float]] = None

            # Fetch the venue page when we don't have everything we need.
            # Two prizes from a venue page: the address text AND (much
            # better) exact lat/lng from an embedded Google Maps iframe.
            if venue.url and (not address or not (venue.lat and venue.lng)):
                details = await fetch_venue_details(venue.url, client)
                fetched_addr = details.get("address")
                fetched_coords = details.get("coords")
                if fetched_addr and not address:
                    address = fetched_addr
                    async with SessionLocal() as session:
                        v = (
                            await session.execute(
                                select(Venue).where(Venue.id == venue.id)
                            )
                        ).scalar_one()
                        v.address = fetched_addr
                        await session.commit()
                    log.info("  fetched address for %s: %s", venue.name, fetched_addr)
                if fetched_coords and _in_brighton(*fetched_coords):
                    page_coords = fetched_coords
                    log.info(
                        "  found coords on page for %s: %.5f, %.5f",
                        venue.name, page_coords[0], page_coords[1],
                    )

            # Page coords beat Nominatim every time -- they were placed
            # by the venue or organisers themselves.
            coords = page_coords or await geocode_one(client, venue.name, address)
            async with SessionLocal() as session:
                # Re-fetch in this session so we can update + commit cleanly.
                v = (
                    await session.execute(select(Venue).where(Venue.id == venue.id))
                ).scalar_one()
                if coords:
                    v.lat, v.lng = coords
                    v.geocoded_at = datetime.utcnow()
                    stats["geocoded"] += 1
                    log.info("  %s -> %.5f, %.5f", venue.name, coords[0], coords[1])
                else:
                    stats["errors"] += 1
                    log.warning("  %s -> no result", venue.name)
                await session.commit()

            if progress_callback:
                progress_callback(idx, len(venues))

    log.info("Geocode complete: %s", stats)
    return stats
