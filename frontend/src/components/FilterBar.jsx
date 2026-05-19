import { useState } from "react";
import { ChevronDown, X, SlidersHorizontal, Star } from "lucide-react";

export const DEFAULT_FILTERS = {
  genres: [],
  venue_slug: "",
  max_price: "",
  min_rating: "",
  min_time: "",
  max_time: "",
  free_only: false,
  accessible: false,
};

// Cap on the pill ribbon. Genres beyond this still appear in the
// expanded panel's dropdown (which adds to the selection rather than
// replacing it).
const RIBBON_GENRE_LIMIT = 11;

// Top-of-page filter bar. Date is intentionally NOT here -- that's owned by
// the DateStrip component so the date is always visible above the fold.
export default function FilterBar({ genres, venues, filters, onChange }) {
  const [open, setOpen] = useState(false);

  function set(key, value) {
    onChange({ ...filters, [key]: value });
  }

  function toggleGenre(g) {
    const current = filters.genres || [];
    const next = current.includes(g)
      ? current.filter((x) => x !== g)
      : [...current, g];
    set("genres", next);
  }

  function addGenre(g) {
    if (!g) return;
    const current = filters.genres || [];
    if (current.includes(g)) return;
    set("genres", [...current, g]);
  }

  function clearAll() {
    onChange({ ...DEFAULT_FILTERS });
  }

  const selectedGenres = filters.genres || [];
  const activeCount =
    selectedGenres.length +
    [
      filters.venue_slug,
      filters.max_price,
      filters.min_rating,
      filters.min_time,
      filters.max_time,
      filters.free_only,
      filters.accessible,
    ].filter(Boolean).length;

  return (
    <div className="bg-gray-900 border-b border-gray-800">
      {/* Pill row */}
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-2 overflow-x-auto scrollbar-hide">
        <button
          onClick={() => setOpen(!open)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors flex-shrink-0
            ${
              open || activeCount
                ? "border-fringe-pink text-fringe-pink"
                : "border-gray-600 text-gray-400 hover:border-gray-400"
            }`}
        >
          <SlidersHorizontal size={14} />
          Filters
          {activeCount > 0 && (
            <span className="bg-fringe-pink text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
              {activeCount}
            </span>
          )}
        </button>

        {/* Clear-all sits at the left so it stays in view regardless of
            how many genre pills are showing or how far the ribbon has
            scrolled. */}
        {activeCount > 0 && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1 px-3 py-1.5 rounded-full border border-gray-700 text-xs text-gray-400 hover:text-white flex-shrink-0"
            title="Clear every active filter"
          >
            <X size={12} /> Clear all
          </button>
        )}

        {/* Up to RIBBON_GENRE_LIMIT pills, popularity-ordered. Clicking
            toggles the genre in/out of the multi-select set; less-common
            genres are still reachable from the expanded panel below. */}
        {genres.slice(0, RIBBON_GENRE_LIMIT).map((g) => {
          // Some scraped categories are absurdly long ("Theatre / Spoken
          // Word / Storytelling / ...") and wreck the row. Truncate the
          // visible label and keep the full text in `title` for hover.
          const label = g.length > 20 ? `${g.slice(0, 19)}…` : g;
          const selected = selectedGenres.includes(g);
          return (
            <button
              key={g}
              onClick={() => toggleGenre(g)}
              title={g}
              className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-colors flex-shrink-0 max-w-[14rem] truncate
                ${
                  selected
                    ? "border-fringe-pink bg-fringe-pink/10 text-fringe-pink"
                    : "border-gray-700 text-gray-400 hover:border-gray-500"
                }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Expanded filter panel */}
      {open && (
        <div className="max-w-7xl mx-auto px-4 pb-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">
              Add genre
              {selectedGenres.length > 0 && (
                <span className="ml-1 text-fringe-pink">
                  ({selectedGenres.length} selected)
                </span>
              )}
            </label>
            <div className="relative">
              <select
                value=""
                onChange={(e) => addGenre(e.target.value)}
                className="w-full appearance-none bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white
                           focus:outline-none focus:border-fringe-pink pr-8"
              >
                <option value="">Add a genre…</option>
                {[...genres]
                  .sort((a, b) => a.localeCompare(b))
                  .filter((g) => !selectedGenres.includes(g))
                  .map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
              </select>
              <ChevronDown
                size={14}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              />
            </div>
            {selectedGenres.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {selectedGenres.map((g) => (
                  <button
                    key={g}
                    onClick={() => toggleGenre(g)}
                    title={`Remove ${g}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-fringe-pink/15 border border-fringe-pink/50 text-fringe-pink text-[11px]"
                  >
                    {g.length > 18 ? `${g.slice(0, 17)}…` : g}
                    <X size={10} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <Select
            label="Venue"
            value={filters.venue_slug}
            onChange={(v) => set("venue_slug", v)}
            options={venues.map((v) => ({ value: v.slug, label: v.name }))}
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">Max price (£)</label>
            <input
              type="number"
              min="0"
              step="1"
              value={filters.max_price || ""}
              onChange={(e) => set("max_price", e.target.value)}
              placeholder="Any"
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white w-full focus:outline-none focus:border-fringe-pink"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">
              Time range
              {(filters.min_time || filters.max_time) && (
                <button
                  type="button"
                  onClick={() => {
                    set("min_time", "");
                    set("max_time", "");
                  }}
                  className="ml-1 text-fringe-pink hover:underline"
                  title="Clear time range"
                >
                  clear
                </button>
              )}
            </label>
            <div className="flex items-center gap-1">
              <input
                type="time"
                value={filters.min_time || ""}
                onChange={(e) => set("min_time", e.target.value)}
                title="From"
                className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-fringe-pink min-w-0 flex-1"
              />
              <span className="text-gray-500 text-xs flex-shrink-0">to</span>
              <input
                type="time"
                value={filters.max_time || ""}
                onChange={(e) => set("max_time", e.target.value)}
                title="Until"
                className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-fringe-pink min-w-0 flex-1"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 flex items-center gap-1">
              <Star size={11} /> Min rating
            </label>
            <select
              value={filters.min_rating || ""}
              onChange={(e) => set("min_rating", e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-fringe-pink"
            >
              <option value="">Any</option>
              <option value="3">3+ stars</option>
              <option value="3.5">3.5+ stars</option>
              <option value="4">4+ stars</option>
              <option value="4.5">4.5+ stars</option>
            </select>
          </div>
          <div className="flex flex-col gap-2 justify-end">
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.free_only || false}
                onChange={(e) => set("free_only", e.target.checked)}
                className="accent-fringe-pink"
              />
              Free only
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.accessible || false}
                onChange={(e) => set("accessible", e.target.checked)}
                className="accent-fringe-pink"
              />
              Accessible
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-500">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white
                     focus:outline-none focus:border-fringe-pink pr-8"
        >
          <option value="">All</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
        />
      </div>
    </div>
  );
}
