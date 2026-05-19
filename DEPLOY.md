# Deploying Bringe as a public read-only site

The app supports two run modes:

* **Live** (your laptop) — full-fat FastAPI backend, you can scrape,
  geocode, fetch reviews, geocode individual venues from the UI.
* **Static snapshot** (the public site) — same React frontend, but every
  read is served from JSON files baked at build time. No backend, no
  write actions.

Toggled by the `VITE_STATIC_MODE` env var at build time:

| `VITE_STATIC_MODE` | What `lib/api.js` does |
|---|---|
| unset / empty | hits the local FastAPI at `/api/...` (dev default) |
| `1` or `true` | reads `/data/*.json` and applies filters client-side |

In static mode the settings cog, the data-refresh panel and the
click-to-locate venue trigger are hidden — there is no server to
respond to them. Everything else (filters, search, date strip, list /
venues / map / reviews tabs, the inline OSM map per venue) keeps
working.

## How to publish an update

You run all the scrapes on your laptop (your local backend is the
"production" data pipeline). When you are happy with the data, three
commands push it live:

```sh
# 1. Refresh the snapshot files (dumps SQLite -> frontend/public/data/*.json)
python backend/export_static.py

# 2. Commit the snapshot
git add frontend/public/data
git commit -m "data: refresh snapshot"

# 3. Push -- Render auto-deploys from the connected branch
git push
```

That's it. Render rebuilds and serves the new bundle in under a minute.

## First-time Render setup

1. Go to Render's dashboard → **New +** → **Blueprint**.
2. Connect this GitHub repo. Render will pick up the `render.yaml`
   in the project root, which already pins:
   * runtime: static
   * rootDir: `frontend`
   * buildCommand: `npm ci && VITE_STATIC_MODE=1 npm run build`
   * publish dir: `frontend/dist`
   * SPA rewrite rule (everything → `index.html`)
   * Cache headers for `/data/*` and `/assets/*`
3. Apply. Render creates the static service and starts the first build.
4. (Optional) Connect a custom domain in the service settings. HTTPS is
   automatic.

## What's in the snapshot

`backend/export_static.py` writes the following under
`frontend/public/data/`:

| File | Shape | Used by |
|---|---|---|
| `shows.json` | array of `ShowSummary` (with `_perfs`, `_description`, `_accessibility_features` extras for client-side filtering) | List / Venues / Map tabs |
| `shows/<slug>.json` | single `ShowDetail` per show | Modal |
| `venues.json` | array of `VenueOut` | Map + venue dropdown |
| `dates.json` | array of ISO date strings | Date strip |
| `genres.json` | array of genre names, popularity-sorted, ≥2 shows | Filter pills |
| `reviews.json` | array of `ReviewItem` | Reviews tab |
| `stats.json` | `{shows, venues, reviews, generated_at}` | header + footer |
| `manifest.json` | counts + generated_at (human-readable) | debugging |

Typical size for a full Brighton Fringe is ~1.5 MB total. The
`shows.json` and per-show details together account for most of it.
Render serves them from its CDN, gzipped, so first-page load is fast.

## Running the public build locally

To test what users will see:

```sh
cd frontend
VITE_STATIC_MODE=1 npm run build
npx serve dist
```

Open the URL it prints. The Settings cog and the "click to locate"
hints will be missing, every filter still works, time pills still
populate when a date is selected.

## Caveats

* **No live geocoding.** A venue without `lat`/`lng` in the snapshot
  has no way to acquire one on the public site. Geocode them locally
  before exporting (`Settings → Geocode venues`).
* **No live review fetching.** Same reasoning. Run `Fetch reviews`
  locally before exporting.
* **Search is client-side.** Title + company + description + (in
  Reviews) review excerpt are searched in memory. Plenty fast for
  ~850 shows.

## Local development unchanged

Nothing about the live dev flow changes. `run.bat` still starts the
FastAPI backend + Vite dev server. `VITE_STATIC_MODE` is unset in dev,
so `lib/api.js` keeps talking to the local API.
