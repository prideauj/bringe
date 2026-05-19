import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Settings, X, List, Map as MapIcon, Landmark, Star } from "lucide-react";
import ShowCard from "./components/ShowCard";
import ShowModal from "./components/ShowModal";
import FilterBar, { DEFAULT_FILTERS } from "./components/FilterBar";
import DateStrip from "./components/DateStrip";
import MapView from "./components/MapView";
import VenuesView from "./components/VenuesView";
import ReviewsView from "./components/ReviewsView";
import RefreshPanel from "./components/RefreshPanel";
import {
  fetchGenres,
  fetchVenues,
  fetchDates,
  fetchShows,
  fetchStats,
  STATIC_MODE,
} from "./lib/api";

const SORT_OPTIONS = [
  { value: "next_date", label: "Soonest first" },
  { value: "title", label: "A – Z" },
  { value: "price", label: "Price" },
  { value: "rating", label: "Best rated" },
];

const VIEWS = [
  { value: "list",    label: "List",    Icon: List },
  { value: "venues",  label: "Venues",  Icon: Landmark },
  { value: "map",     label: "Map",     Icon: MapIcon },
  { value: "reviews", label: "Reviews", Icon: Star },
];

// Pick the date the user should land on: today if any shows play today,
// otherwise the next future date that has shows, otherwise the first
// available date.
function pickInitialDate(dates) {
  if (!dates.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  return dates.find((d) => d >= today) || dates[0];
}

export default function App() {
  const [shows, setShows] = useState([]);
  const [genres, setGenres] = useState([]);
  const [venues, setVenues] = useState([]);
  const [dates, setDates] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSlug, setSelected] = useState(null);
  const [showSettings, setSettings] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [sort, setSort] = useState("next_date");
  const [view, setView] = useState("list"); // "list" | "venues" | "map" | "reviews"
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  // Empty array means "all upcoming"; populated array filters to those days.
  const [selectedDates, setSelectedDates] = useState([]);
  const searchTimeout = useRef(null);

  const loadMeta = useCallback(async () => {
    const [g, v, d, s] = await Promise.all([
      fetchGenres(),
      fetchVenues(),
      fetchDates(),
      fetchStats(),
    ]);
    setGenres(g);
    setVenues(v);
    setDates(d);
    setStats(s);
    // First time we get dates, default to today (or the next day with shows).
    setSelectedDates((cur) => {
      if (cur.length > 0 || !d.length) return cur;
      const initial = pickInitialDate(d);
      return initial ? [initial] : [];
    });
  }, []);

  const loadShows = useCallback(async (q, f, s, datesArr) => {
    setLoading(true);
    setError(null);
    try {
      const params = { sort: s, limit: 500 };
      if (q) params.q = q;
      if (f.genres && f.genres.length) params.genres = f.genres;
      if (f.venue_slug) params.venue_slug = f.venue_slug;
      if (f.max_price !== "") params.max_price = f.max_price;
      if (f.min_rating !== "") params.min_rating = f.min_rating;
      if (f.min_time) params.min_time = f.min_time;
      if (f.max_time) params.max_time = f.max_time;
      if (f.free_only) params.free_only = true;
      if (f.accessible) params.accessible = true;
      if (datesArr && datesArr.length) params.dates = datesArr;
      const data = await fetchShows(params);
      setShows(data);
    } catch (e) {
      setError(
        e.response?.status === 0 || !e.response
          ? "Cannot reach the API. Is the backend running? (see terminal)"
          : `API error: ${e.message}`
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced reload whenever inputs change.
  useEffect(() => {
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(
      () => loadShows(searchQ, filters, sort, selectedDates),
      300
    );
    return () => clearTimeout(searchTimeout.current);
  }, [searchQ, filters, sort, selectedDates, loadShows]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  // Reviews inherits the currently-selected date(s). In practice this
  // is what users want: "I'm planning Saturday — show me Saturday's
  // shows AND Saturday's reviewed shows." If they want all reviews
  // they can hit "All" in the date strip.
  function handleViewChange(next) {
    setView(next);
  }

  // Header line: pretty summary of the date selection.
  function fmt(d) {
    return new Date(d).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }
  let friendlyDate;
  if (selectedDates.length === 0) friendlyDate = "All upcoming dates";
  else if (selectedDates.length === 1) {
    friendlyDate = new Date(selectedDates[0]).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  } else if (selectedDates.length <= 3) {
    friendlyDate = selectedDates.map(fmt).join(" · ");
  } else {
    friendlyDate = `${fmt(selectedDates[0])} → ${fmt(
      selectedDates[selectedDates.length - 1]
    )} (${selectedDates.length} days)`;
  }

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-2xl">🎭</span>
            <div>
              <h1 className="text-base font-bold text-white leading-none">Bringe</h1>
              <p className="text-xs text-gray-500">Brighton Fringe 2026</p>
            </div>
          </div>

          {/* Search */}
          <div className="flex-1 max-w-md relative">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
            />
            <input
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Search shows, companies…"
              className="w-full bg-gray-800 border border-gray-700 rounded-full px-4 py-2 pl-9 text-sm text-white
                         placeholder-gray-500 focus:outline-none focus:border-fringe-pink transition-colors"
            />
            {searchQ && (
              <button
                onClick={() => setSearchQ("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Sort */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="hidden sm:block bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white
                       focus:outline-none focus:border-fringe-pink"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          {/* View toggle */}
          <div className="flex items-center bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                onClick={() => handleViewChange(v.value)}
                className={`flex items-center gap-1 px-3 py-2 text-xs font-semibold transition-colors ${
                  view === v.value
                    ? "bg-fringe-pink text-white"
                    : "text-gray-400 hover:text-white"
                }`}
                title={`${v.label} view`}
              >
                <v.Icon size={14} />
                <span className="hidden md:inline">{v.label}</span>
              </button>
            ))}
          </div>

          {!STATIC_MODE && (
            <button
              onClick={() => setSettings(!showSettings)}
              className={`p-2 rounded-lg border transition-colors flex-shrink-0 ${
                showSettings
                  ? "border-fringe-pink text-fringe-pink"
                  : "border-gray-700 text-gray-400 hover:text-white"
              }`}
            >
              <Settings size={16} />
            </button>
          )}
        </div>
      </header>

      {/* Date strip */}
      <DateStrip
        dates={dates}
        selected={selectedDates}
        onChange={setSelectedDates}
      />

      {/* Filters */}
      <FilterBar
        genres={genres}
        venues={venues}
        filters={filters}
        onChange={setFilters}
      />

      {/* Settings/Refresh panel — only available in the local (live API)
          build of the app. The public static snapshot doesn't have a
          backend to refresh against. */}
      {!STATIC_MODE && showSettings && (
        <div className="max-w-7xl mx-auto px-4 py-4">
          <RefreshPanel
            onRefreshDone={() => {
              loadMeta();
              loadShows(searchQ, filters, sort, selectedDates);
            }}
          />
        </div>
      )}

      {/* Main */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Header line: date + count. Hidden in reviews view, which has
            its own self-contained header inside ReviewsView. */}
        {view !== "reviews" && (
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">{friendlyDate}</h2>
            {!loading && !error && (
              <p className="text-sm text-gray-500">
                {shows.length} show{shows.length === 1 ? "" : "s"}
                {searchQ && ` matching "${searchQ}"`}
              </p>
            )}
          </div>
        )}

        {/* Empty DB prompt */}
        {view !== "reviews" && !loading && !error && shows.length === 0 && stats?.shows === 0 && (
          <div className="text-center py-24">
            <div className="text-6xl mb-4">🎭</div>
            <h2 className="text-xl font-bold text-white mb-2">No shows loaded yet</h2>
            <p className="text-gray-400 mb-6 max-w-md mx-auto">
              Click the <Settings size={14} className="inline" /> settings icon
              above, then hit <strong>"Refresh new shows"</strong> to scrape
              Brighton Fringe and populate the database.
            </p>
            <button
              onClick={() => setSettings(true)}
              className="px-4 py-2 bg-fringe-pink text-white rounded-lg text-sm font-semibold hover:bg-pink-500 transition-colors"
            >
              Open settings
            </button>
          </div>
        )}

        {/* Empty filter result */}
        {view !== "reviews" && !loading && !error && shows.length === 0 && stats?.shows > 0 && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-base mb-2">No shows match your filters.</p>
            <p className="text-sm">
              Try clearing some filters or picking a different date.
            </p>
          </div>
        )}

        {error && (
          <div className="bg-red-950 border border-red-800 rounded-xl p-4 text-red-300 text-sm mb-6">
            {error}
          </div>
        )}

        {view !== "reviews" && loading && shows.length === 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {Array.from({ length: 20 }).map((_, i) => (
              <div
                key={i}
                className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden animate-pulse"
              >
                <div className="aspect-[16/9] bg-gray-800" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-gray-800 rounded w-3/4" />
                  <div className="h-3 bg-gray-800 rounded w-1/2" />
                  <div className="h-3 bg-gray-800 rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Reviews has its own data fetch; render unconditionally. */}
        {view === "reviews" && (
          <ReviewsView
            onSelectShow={setSelected}
            filters={filters}
            searchQ={searchQ}
            dateFilter={selectedDates}
          />
        )}

        {view !== "reviews" && shows.length > 0 && (
          <>
            {view === "list" && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {shows.map((show) => (
                  <ShowCard key={show.slug} show={show} onClick={setSelected} />
                ))}
              </div>
            )}
            {view === "venues" && (
              <VenuesView
                shows={shows}
                onSelectShow={setSelected}
                dateFilter={selectedDates}
              />
            )}
            {view === "map" && (
              <MapView shows={shows} onSelectShow={setSelected} />
            )}
          </>
        )}
      </main>

      {/* Modal */}
      {selectedSlug && (
        <ShowModal
          slug={selectedSlug}
          dateFilter={selectedDates}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Snapshot footer in static mode so users know how fresh the data is */}
      {STATIC_MODE && stats?.generated_at && (
        <footer className="max-w-7xl mx-auto px-4 py-6 text-center text-[11px] text-gray-600">
          Snapshot generated{" "}
          {new Date(stats.generated_at).toLocaleString("en-GB", {
            dateStyle: "long",
            timeStyle: "short",
          })}
        </footer>
      )}
    </div>
  );
}
