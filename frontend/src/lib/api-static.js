// Static-mode API. Same shape as the live FastAPI client in api.js, but
// every read is satisfied from snapshot JSON files under /data/ and
// every filter is applied in memory. Write endpoints (triggerRefresh /
// geocodeVenue / etc) return inert results so the UI doesn't error.
//
// Activated via VITE_STATIC_MODE=1 at build time. The exporter
// (backend/export_static.py) produces the JSON files in
// frontend/public/data/.

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

// Cached payloads. Each entry is a promise so concurrent callers share
// a single fetch.
const _cache = {};

function _fetchOnce(name, path) {
  if (!_cache[name]) {
    _cache[name] = fetch(`${BASE}/data/${path}`).then((r) => {
      if (!r.ok) throw new Error(`Failed to load /data/${path}: ${r.status}`);
      return r.json();
    });
  }
  return _cache[name];
}

const loadShows   = () => _fetchOnce("shows",   "shows.json");
const loadReviews = () => _fetchOnce("reviews", "reviews.json");
const loadVenues  = () => _fetchOnce("venues",  "venues.json");
const loadDates   = () => _fetchOnce("dates",   "dates.json");
const loadGenres  = () => _fetchOnce("genres",  "genres.json");
const loadStats   = () => _fetchOnce("stats",   "stats.json");

// ---------------------------------------------------------------------
// /api/shows — full filter parity with the backend list_shows endpoint.
// ---------------------------------------------------------------------
export async function fetchShows(params = {}) {
  const all = await loadShows();
  const {
    q,
    genres,
    venue_slug,
    dates,
    min_price,
    max_price,
    min_rating,
    min_time,
    max_time,
    free_only,
    accessible,
    sort = "next_date",
    limit = 100,
    offset = 0,
  } = params;

  const dset = dates && dates.length ? new Set(dates) : null;
  const gset = genres && genres.length ? new Set(genres) : null;
  const term = q ? q.toLowerCase() : null;
  const minPrice = min_price !== "" && min_price != null ? parseFloat(min_price) : null;
  const maxPrice = max_price !== "" && max_price != null ? parseFloat(max_price) : null;
  const perfFilterActive =
    dset || free_only || minPrice != null || maxPrice != null || min_time || max_time;

  function _perfMatches(p) {
    if (dset && !dset.has(p.date)) return false;
    if (free_only && p.standard_price !== 0) return false;
    if (minPrice != null && (p.standard_price == null || p.standard_price < minPrice))
      return false;
    if (maxPrice != null && (p.standard_price == null || p.standard_price > maxPrice))
      return false;
    if (min_time && (!p.time || p.time < min_time)) return false;
    if (max_time && (!p.time || p.time > max_time)) return false;
    return true;
  }

  let rows = all.filter((s) => {
    if (term) {
      const hay = [
        s.title,
        s.company,
        s._description || "",
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(term)) return false;
    }
    if (gset && !gset.has(s.genre)) return false;
    if (venue_slug && s.venue_slug !== venue_slug) return false;
    if (accessible && !(s._accessibility_features && s._accessibility_features.length)) {
      return false;
    }
    if (min_rating != null && min_rating !== "") {
      if ((s.avg_rating || 0) < parseFloat(min_rating)) return false;
    }

    // Performance-row filters: a show passes if SOME single performance
    // satisfies ALL active perf-row conditions together. (Mirrors the
    // backend's outerjoin + WHERE, where ANDed predicates have to be
    // true on the SAME row.)
    if (perfFilterActive) {
      const perfs = s._perfs || [];
      if (!perfs.some(_perfMatches)) return false;
    }
    return true;
  });

  // Compute `times` and override next_date/next_time when a date filter
  // is active, exactly as _show_summary does on the backend.
  if (dset) {
    rows = rows.map((s) => {
      const seen = new Set();
      const times = [];
      for (const p of s._perfs || []) {
        if (dset.has(p.date) && p.time) {
          const key = `${p.date}-${p.time}`;
          if (!seen.has(key)) {
            seen.add(key);
            times.push({ date: p.date, time: p.time });
          }
        }
      }
      times.sort((a, b) =>
        (a.date + a.time).localeCompare(b.date + b.time)
      );
      return {
        ...s,
        times,
        next_date: times.length ? times[0].date : null,
        next_time: times.length ? times[0].time : null,
      };
    });
  }

  // Sort
  rows = rows.slice();
  if (sort === "next_date") {
    rows.sort((a, b) =>
      ((a.next_date || "9999") + (a.next_time || "")).localeCompare(
        (b.next_date || "9999") + (b.next_time || "")
      )
    );
  } else if (sort === "title") {
    rows.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  } else if (sort === "price") {
    rows.sort(
      (a, b) =>
        (a.min_price == null) - (b.min_price == null) ||
        (a.min_price || 0) - (b.min_price || 0)
    );
  } else if (sort === "rating") {
    rows.sort(
      (a, b) =>
        (a.avg_rating == null) - (b.avg_rating == null) ||
        (b.avg_rating || 0) - (a.avg_rating || 0)
    );
  }

  // Strip the underscore-prefixed implementation-detail fields so the
  // payload that reaches the rest of the app matches the live API.
  return rows.slice(offset, offset + limit).map(_publicShape);
}

function _publicShape(s) {
  // eslint-disable-next-line no-unused-vars
  const { _perfs, _accessibility_features, _description, ...pub } = s;
  return pub;
}

// ---------------------------------------------------------------------
// /api/shows/{slug}
// ---------------------------------------------------------------------
export async function fetchShow(slug) {
  const r = await fetch(`${BASE}/data/shows/${slug}.json`);
  if (!r.ok) throw new Error(`Show ${slug} not found in snapshot`);
  return r.json();
}

// ---------------------------------------------------------------------
// /api/reviews — same filter parity (mirrors list_reviews).
// ---------------------------------------------------------------------
export async function fetchReviews(params = {}) {
  const [reviews, shows] = await Promise.all([loadReviews(), loadShows()]);
  const showBySlug = new Map(shows.map((s) => [s.slug, s]));

  const {
    min_rating,
    source,
    q,
    genres,
    venue_slug,
    dates,
    min_price,
    max_price,
    min_time,
    max_time,
    free_only,
    accessible,
    limit = 500,
    offset = 0,
  } = params;
  const dset = dates && dates.length ? new Set(dates) : null;
  const gset = genres && genres.length ? new Set(genres) : null;
  const term = q ? q.toLowerCase() : null;
  const minPrice = min_price !== "" && min_price != null ? parseFloat(min_price) : null;
  const maxPrice = max_price !== "" && max_price != null ? parseFloat(max_price) : null;
  const perfFilterActive =
    dset || free_only || minPrice != null || maxPrice != null || min_time || max_time;

  function _perfMatches(p) {
    if (dset && !dset.has(p.date)) return false;
    if (free_only && p.standard_price !== 0) return false;
    if (minPrice != null && (p.standard_price == null || p.standard_price < minPrice))
      return false;
    if (maxPrice != null && (p.standard_price == null || p.standard_price > maxPrice))
      return false;
    if (min_time && (!p.time || p.time < min_time)) return false;
    if (max_time && (!p.time || p.time > max_time)) return false;
    return true;
  }

  const rows = reviews.filter((r) => {
    if (min_rating != null && min_rating !== "") {
      if ((r.rating_stars == null ? -1 : r.rating_stars) < parseFloat(min_rating)) {
        return false;
      }
    }
    if (source && r.source_site !== source) return false;

    // Show-side filters require the matching show summary.
    const s = showBySlug.get(r.show_slug);
    if (!s) return true; // Orphan review; default to keeping.

    if (term) {
      const hay = [
        s.title,
        s.company,
        s._description || "",
        r.excerpt || "",
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(term)) return false;
    }
    if (gset && !gset.has(s.genre)) return false;
    if (venue_slug && s.venue_slug !== venue_slug) return false;
    if (accessible && !(s._accessibility_features && s._accessibility_features.length)) {
      return false;
    }
    if (perfFilterActive) {
      const perfs = s._perfs || [];
      if (!perfs.some(_perfMatches)) return false;
    }
    return true;
  });

  return rows.slice(offset, offset + limit);
}

// ---------------------------------------------------------------------
// Other reads
// ---------------------------------------------------------------------
export const fetchGenres = () => loadGenres();
export const fetchVenues = () => loadVenues();
export const fetchDates  = () => loadDates();
export const fetchStats  = () => loadStats();

// ---------------------------------------------------------------------
// Write paths -- inert in static mode. The UI checks STATIC_MODE and
// hides the buttons that would call these, but we still return shapes
// the polling code understands so nothing crashes if a stray timer fires.
// ---------------------------------------------------------------------
const INERT_STATUS = {
  running: false,
  done: 0,
  total: 0,
  started_at: null,
  finished_at: null,
  last_stats: null,
};
const INERT = () => ({ status: "static_mode" });

export const triggerRefresh         = async () => INERT();
export const getRefreshStatus       = async () => INERT_STATUS;
export const triggerReviewRefresh   = async () => INERT();
export const getReviewRefreshStatus = async () => INERT_STATUS;
export const triggerGeocode         = async () => INERT();
export const getGeocodeStatus       = async () => INERT_STATUS;
export const geocodeVenue           = async (slug) => {
  // Try to read from the snapshot so the venue card can at least show
  // whatever coords we have (it won't be able to fetch new ones).
  const venues = await loadVenues();
  return venues.find((v) => v.slug === slug) || null;
};
