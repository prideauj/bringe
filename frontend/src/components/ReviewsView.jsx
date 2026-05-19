import { useEffect, useState } from "react";
import { ExternalLink, Star } from "lucide-react";
import { fetchReviews } from "../lib/api";
import StarRating from "./StarRating";

// Consolidated reviews list, displayed as a responsive card grid. The
// main FilterBar (genre / venue / price / accessibility / min-rating /
// search) and the DateStrip both filter this view via the same API
// parameters they pass to /api/shows. The only review-only filter
// kept locally is the source dropdown.
export default function ReviewsView({
  onSelectShow,
  filters = {},
  searchQ = "",
  dateFilter = [],
}) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [source, setSource] = useState("");
  const [allSources, setAllSources] = useState([]);

  // Stable string-ified dep so we re-fetch when array contents change,
  // not just identity. Filters object also keyed by its serialised form
  // for the same reason.
  const datesKey = dateFilter.join("|");
  const filtersKey = JSON.stringify(filters || {});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Build the param object: main FilterBar fields take precedence,
    // local source select adds on top. Empty strings / falsy values
    // are skipped so we don't send "?genre=" etc.
    const params = { limit: 1000 };
    if (searchQ) params.q = searchQ;
    if (filters.genres && filters.genres.length) params.genres = filters.genres;
    if (filters.venue_slug) params.venue_slug = filters.venue_slug;
    if (filters.max_price !== "" && filters.max_price != null) {
      params.max_price = filters.max_price;
    }
    if (filters.min_rating !== "" && filters.min_rating != null) {
      params.min_rating = filters.min_rating;
    }
    if (filters.free_only) params.free_only = true;
    if (filters.accessible) params.accessible = true;
    if (source) params.source = source;
    if (dateFilter.length) params.dates = dateFilter;

    fetchReviews(params)
      .then((data) => {
        if (cancelled) return;
        setReviews(data);
        setAllSources((prev) => {
          const set = new Set(prev);
          for (const r of data) if (r.source_site) set.add(r.source_site);
          const next = [...set].sort();
          if (
            next.length === prev.length &&
            next.every((v, i) => v === prev[i])
          ) {
            return prev;
          }
          return next;
        });
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || "Failed to load reviews.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, datesKey, filtersKey, searchQ]);

  const mainFilterActive =
    !!filters.genre ||
    !!filters.venue_slug ||
    !!filters.max_price ||
    !!filters.min_rating ||
    !!filters.free_only ||
    !!filters.accessible ||
    !!searchQ ||
    dateFilter.length > 0;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Star size={16} className="text-fringe-pink" />
          {mainFilterActive || source ? "Filtered reviews" : "All reviews"}
        </h2>
        <span className="text-sm text-gray-500">
          {loading
            ? "loading…"
            : `${reviews.length} review${reviews.length === 1 ? "" : "s"}`}
        </span>
        <div className="ml-auto flex gap-2">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className={`bg-gray-800 border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-fringe-pink ${
              source ? "border-fringe-pink" : "border-gray-700"
            }`}
            title="Filter by review source"
          >
            <option value="">All sources</option>
            {allSources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {source && (
            <button
              onClick={() => setSource("")}
              className="text-xs px-2 py-1 rounded-full border border-fringe-pink text-fringe-pink hover:bg-fringe-pink/10"
              title="Clear source filter"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-950 border border-red-800 rounded-xl p-4 text-red-300 text-sm mb-4">
          {error}
        </div>
      )}

      {!loading && !error && reviews.length === 0 && (
        <p className="text-center text-gray-500 py-12 text-sm">
          {mainFilterActive || source
            ? "No reviews match the current filters."
            : "No reviews yet. Click the settings cog and \"Fetch reviews\" to scrape Broadway Baby, Fringe Review and The Reviews Hub."}
        </p>
      )}

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-4 animate-pulse h-44"
            />
          ))}
        </div>
      )}

      {!loading && reviews.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {reviews.map((r) => (
            <ReviewCard key={r.id} review={r} onSelectShow={onSelectShow} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ review, onSelectShow }) {
  return (
    <article className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex flex-col gap-2 hover:border-fringe-pink/40 transition-colors">
      <header className="flex items-start justify-between gap-2">
        <button
          onClick={() => onSelectShow(review.show_slug)}
          className="text-left flex-1 min-w-0"
        >
          <h3 className="font-semibold text-white text-sm hover:text-fringe-pink transition-colors line-clamp-2 leading-snug">
            {review.show_title}
          </h3>
          <p className="text-[11px] text-gray-500 mt-0.5 truncate">
            {review.source_site || "Unknown source"}
            {review.reviewer ? ` · ${review.reviewer}` : ""}
          </p>
        </button>
        {review.rating_stars != null && (
          <div className="flex-shrink-0">
            <StarRating rating={review.rating_stars} />
          </div>
        )}
      </header>

      {review.excerpt && (
        <p className="text-gray-300 text-xs leading-relaxed line-clamp-4 flex-1">
          {review.excerpt}
        </p>
      )}

      {review.review_url && (
        <a
          href={review.review_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-fringe-pink hover:underline self-start mt-auto"
        >
          Read full review <ExternalLink size={11} />
        </a>
      )}
    </article>
  );
}
