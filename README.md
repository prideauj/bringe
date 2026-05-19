# Bringe

A friendlier browser for [Brighton Fringe](https://www.brightonfringe.org)
listings. Built because the official site, while comprehensive, makes it
hard to plan a day or weekend at the festival. Bringe is date-driven,
filter-rich, and works on phone and laptop.

> Not affiliated with Brighton Fringe — Bringe is a personal project that
> scrapes the public website and aggregates publicly-available reviews.
> Booking links still point you back to brightonfringe.org and the
> official ticket sites.

---

## Features

- **Date-driven browsing.** Pick a day (or a range — shift-click works in
  the date strip) and see only shows playing then.
- **Five views, same data.**
  - *List* — show cards in a grid.
  - *Venues* — shows grouped by venue, in time order.
  - *Map* — Leaflet/OpenStreetMap with clustered venue pins.
  - *Reviews* — all aggregated reviews, ratings-first.
  - *My picks* — your starred shows, grouped by day, with conflict
    detection and walking-distance hints.
- **Multi-genre, time, price, rating, accessibility filters.**
- **Reviews from three sources** — Fringe Review (FR), Broadway Baby
  (BB) and The Reviews Hub (TRH). Each source's rating system is
  normalised to a 5-star scale.
- **Inline mini-maps per venue.** Click any venue card; if the venue
  page has a Google Maps embed we use those coordinates, otherwise we
  fall back to OpenStreetMap Nominatim with the scraped address.
- **iCal export.** Send your selected picks straight to Google /
  Apple / Outlook calendar.
- **Shareable plan URLs.** Copy a link that pre-loads picks + dates
  for a friend.
- **Free / unticketed events** clearly flagged on every card.

---

## Architecture

Two-mode design so the same React app runs locally with a full backend
(for scraping & curation) and publicly as a static site (for reading).

```
Local laptop (you)                Public site (anyone)
─────────────────                 ───────────────────
backend/  FastAPI + SQLite        frontend/dist/  bundled by Vite
          scraper / geocoder      data/*.json     snapshot from your DB
          review fetcher
                |
                | export_static.py
                v
          frontend/public/data/*.json  ─── git push ───►  Render Static
```

Toggled at build time by `VITE_STATIC_MODE`:

| `VITE_STATIC_MODE` | What `lib/api.js` does |
|---|---|
| unset / empty | hits local FastAPI at `/api/...` (dev default) |
| `1` or `true` | reads `/data/*.json` and applies filters client-side |

The frontend's filters all work identically in either mode — the static
build re-implements the live API's filter semantics in JS.

### Tech stack

- **Frontend** — React 18, Vite 5, Tailwind CSS, react-leaflet 4,
  date-fns, axios.
- **Backend** — FastAPI, SQLAlchemy 2 (async), aiosqlite,
  BeautifulSoup, curl_cffi for TLS-impersonating scrapes (Cloudflare
  fingerprints standard Python TLS).
- **Hosting** — Render Static for the public site (free tier).
- **Geocoding** — preferred path is the Google Maps embed URL on each
  venue page; fallback is OpenStreetMap Nominatim (free, 1 req/sec
  rate-limited).

---

## Local setup

This project uses an unusual layout because the canonical source lives
on Google Drive (so the developer can scrape from multiple machines)
but `node_modules` and the Python venv must stay local. The Windows
batch scripts handle the split via NTFS junctions.

### Prerequisites

- Windows 10/11 (the launchers are `.bat`)
- Python 3.11+
- Node 18+ and npm
- Git

### First-time setup

From the repo root in `cmd` (PowerShell works too):

```cmd
setup.bat
```

This creates:

- `%LOCALAPPDATA%\bringe\backend-venv\` — Python venv, `pip install`s
  `backend/requirements.txt`.
- `%LOCALAPPDATA%\bringe\frontend\node_modules\` — local `npm install`.
- An NTFS junction from `%LOCALAPPDATA%\bringe\frontend\src` to
  `<repo>/frontend/src` so the launch pad's dev server reads the real
  source from the repo.

### Day-to-day

```cmd
run.bat
```

Starts the FastAPI backend on `:8000` and the Vite dev server on
`:5173` in one console. Output is interleaved. Press `Ctrl+C` once to
stop both; the window closes itself.

Open <http://localhost:5173>.

### First run / data refresh

On a fresh install the database is empty. Open the local site, click
the **cog** (top-right), then:

1. **Refresh new shows** — scrapes brightonfringe.org for events
   missing from the DB. Takes ~2 min for ~860 shows on a first run.
2. **Geocode venues** — fetches each venue page, prefers any Google
   Maps embed for exact coords, falls back to Nominatim with the
   scraped address. ~1 sec/venue.
3. **Fetch reviews** — scrapes Fringe Review, Broadway Baby and The
   Reviews Hub for each show. ~3 min for the full catalogue.

The settings panel shows live progress bars for each step.

---

## Scripts

| Script | What it does |
|---|---|
| `setup.bat` | First-time setup: venv, npm install, junction, pip install. Idempotent — safe to re-run after pulling new deps. |
| `run.bat` | Day-to-day: backend + frontend in one console. |
| `run-static.bat` | Local preview of the public static build (`VITE_STATIC_MODE=1`). Useful before pushing. |
| `push.bat` | Refresh snapshot, untrack any `.gitignore`d files, commit, push. Triggers Render auto-deploy. Accepts `"commit message"` as an argument, or `/nosnapshot "msg"` for code-only commits. |
| `cleanup-repo.bat` | One-shot — drops obsolete local-only files and re-pushes a clean tree. |

---

## Public deployment

Detailed flow is in [DEPLOY.md](./DEPLOY.md). Short version:

```cmd
push.bat "your commit message"
```

That runs `backend/export_static.py` to dump the SQLite DB into
`frontend/public/data/*.json`, then commits and pushes to `main` on
GitHub. Render watches the `main` branch and auto-rebuilds the static
bundle within ~30 seconds.

Render setup is one-shot from the included `render.yaml` — connect the
repo as a Blueprint and apply.

---

## Project structure

```
bringe/
├── backend/                       FastAPI + SQLite
│   ├── main.py                    HTTP API routes
│   ├── models.py                  SQLAlchemy models
│   ├── database.py                async engine + migrations
│   ├── scraper.py                 brightonfringe.org -> SQLite
│   ├── review_scraper.py          FR / BB / TRH -> SQLite
│   ├── geocoder.py                venue coords (Google embed -> Nominatim)
│   ├── export_static.py           SQLite -> /data/*.json snapshot
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx                main app + view tabs + state
│   │   ├── components/            ShowCard, ShowModal, DateStrip,
│   │   │                          MapView, VenuesView, ReviewsView,
│   │   │                          MyPicksView, VenueModal,
│   │   │                          FilterBar, RefreshPanel, etc
│   │   └── lib/
│   │       ├── api.js             switches live vs static
│   │       ├── api-static.js      in-memory filter implementations
│   │       ├── favourites.js      localStorage-backed picks
│   │       ├── ical.js            VEVENT generator
│   │       ├── sharePlan.js       ?picks=...&dates=... codec
│   │       ├── geo.js             Haversine distance
│   │       └── leaflet-config.js  shared icon + module init
│   ├── public/
│   │   └── data/                  snapshot JSON files (committed)
│   ├── package.json
│   └── vite.config.js
├── setup.bat                       first-time install
├── run.bat                         dev server
├── run-static.bat                  preview static build
├── push.bat                        publish to git + Render
├── cleanup-repo.bat                one-shot cleanup
├── render.yaml                     Render Static blueprint
├── DEPLOY.md                       deployment guide
└── README.md
```

---

## Data, attribution, and limits

- **Brighton Fringe show data** is scraped from the public listings on
  brightonfringe.org. The scraper sets a polite user-agent, respects
  per-request delays, and uses TLS-impersonation only because
  Cloudflare's bot management blocks generic Python HTTP clients —
  the request volume is intentionally modest (~1k pages once a day
  at most).
- **Reviews** are scraped from [Fringe Review](https://fringereview.co.uk),
  [Broadway Baby](https://broadwaybaby.com) and
  [The Reviews Hub](https://www.thereviewshub.com). All review excerpts
  are shown with credit to the source and a deep link back to the
  original review. Reviewers and outlets own their content.
- **Geocoding** uses the Google Maps embed coordinates published on
  each Brighton Fringe venue page when available; otherwise
  [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org)
  (1 req/sec, user-agent identifying this project).
- **Map tiles** are from OpenStreetMap. Attribution shown on every map.

If you're an editor at Brighton Fringe, FR, BB, TRH, or anywhere else
referenced here and would like the scraper tuned (lower volume, removed,
attribution adjusted) please open an issue and I'll act on it the same
day.

---

## License

Personal / educational project. No license terms set — assume "all
rights reserved" for the code itself. Festival data, reviews and map
tiles are property of their respective owners as listed above.
