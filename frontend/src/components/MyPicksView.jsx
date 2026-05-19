import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  Star, Calendar, Trash2, Share2, MapPin, AlertTriangle, Clock, Ticket,
} from "lucide-react";
import { fetchShows } from "../lib/api";
import { downloadICS } from "../lib/ical";
import { buildSharePlanUrl } from "../lib/sharePlan";
import { distanceMetres, formatDistance } from "../lib/geo";
import GenreBadge from "./GenreBadge";

const DEFAULT_DURATION = 90; // mins, used when a show has no recorded duration

// "HH:MM" -> minutes since midnight, or null
function timeToMin(t) {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// Detect overlapping pairs within an array of {show, time} rows for one
// day. Two rows overlap if [start, start+duration] windows intersect.
function findConflicts(rows) {
  const intervals = rows
    .map((r) => {
      const start = timeToMin(r.time);
      if (start == null) return null;
      const dur = r.show.duration_minutes && r.show.duration_minutes > 0
        ? r.show.duration_minutes
        : DEFAULT_DURATION;
      return { ...r, start, end: start + dur };
    })
    .filter(Boolean);
  const conflicts = [];
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      const a = intervals[i];
      const b = intervals[j];
      if (a.start < b.end && b.start < a.end) {
        conflicts.push([a, b]);
      }
    }
  }
  return conflicts;
}

// Component
export default function MyPicksView({
  favourites,
  toggleFavourite,
  clearFavourites,
  onSelectShow,
  onSelectVenue,
  dateFilter,
}) {
  const [shows, setShows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copyMsg, setCopyMsg] = useState("");

  // Whenever the favourites list changes, refetch JUST those shows so
  // we get fresh data (avg_rating, venue coords, etc.). For the static
  // build this is a single in-memory filter; for the live API it's a
  // single request with no special endpoint.
  useEffect(() => {
    let cancelled = false;
    if (!favourites.length) {
      setShows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    // We don't have a "by slug list" endpoint; pull everything and
    // filter. Cheap for a few hundred shows.
    fetchShows({ limit: 500, sort: "next_date" })
      .then((data) => {
        if (cancelled) return;
        const set = new Set(favourites);
        setShows(data.filter((s) => set.has(s.slug)));
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || "Failed to load picks.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [favourites]);

  // Build per-day rows: one entry per performance of each picked show.
  const byDate = useMemo(() => {
    const map = new Map();
    for (const s of shows) {
      // Each show might appear once per performance (when a date is
      // selected, the backend gives us `times`). When the date strip
      // is empty we still get next_date/next_time, which we'd rather
      // not show as the only performance -- the picks page should
      // surface every performance the user might attend. We have the
      // performance details in the show modal but they're not on the
      // summary. Compromise for now: when times[] is present use it,
      // otherwise fall back to next_date/next_time so we still show
      // *something*.
      if (Array.isArray(s.times) && s.times.length) {
        for (const t of s.times) {
          if (!map.has(t.date)) map.set(t.date, []);
          map.get(t.date).push({ show: s, time: t.time });
        }
      } else if (s.next_date) {
        if (!map.has(s.next_date)) map.set(s.next_date, []);
        map.get(s.next_date).push({ show: s, time: s.next_time || "" });
      }
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    }
    return [...map.entries()].sort();
  }, [shows]);

  // Flatten to ICS-friendly performance records.
  function exportToCalendar() {
    const records = [];
    for (const [date, rows] of byDate) {
      for (const r of rows) {
        records.push({
          slug: r.show.slug,
          title: r.show.title,
          date,
          time: r.time,
          duration_minutes: r.show.duration_minutes,
          venue_name: r.show.venue_name,
          venue_address: null,
          url: undefined,
          summary: r.show.summary,
        });
      }
    }
    downloadICS("bringe-picks.ics", records);
  }

  async function copyShareUrl() {
    const url = buildSharePlanUrl({
      picks: favourites,
      dates: dateFilter || [],
      view: "picks",
    });
    try {
      await navigator.clipboard.writeText(url);
      setCopyMsg("Share link copied to clipboard.");
    } catch {
      setCopyMsg(url);
    }
    setTimeout(() => setCopyMsg(""), 4000);
  }

  function confirmClear() {
    if (favourites.length === 0) return;
    if (window.confirm(`Clear all ${favourites.length} picks?`)) {
      clearFavourites();
    }
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Star size={16} className="text-yellow-400" fill="currentColor" />
          My picks
        </h2>
        <span className="text-sm text-gray-500">
          {loading
            ? "loading…"
            : `${favourites.length} pick${favourites.length === 1 ? "" : "s"}`}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            onClick={exportToCalendar}
            disabled={!favourites.length || loading}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-700 text-xs text-gray-300 hover:border-fringe-pink hover:text-fringe-pink disabled:opacity-40 disabled:cursor-not-allowed"
            title="Download .ics file for Google / Apple / Outlook calendar"
          >
            <Calendar size={13} /> Export to calendar
          </button>
          <button
            onClick={copyShareUrl}
            disabled={!favourites.length}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-700 text-xs text-gray-300 hover:border-fringe-pink hover:text-fringe-pink disabled:opacity-40 disabled:cursor-not-allowed"
            title="Copy a link that pre-loads these picks on someone else's browser"
          >
            <Share2 size={13} /> Share plan
          </button>
          <button
            onClick={confirmClear}
            disabled={!favourites.length}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-700 text-xs text-gray-300 hover:border-red-400 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 size={13} /> Clear all
          </button>
        </div>
      </div>

      {copyMsg && (
        <p className="text-xs text-fringe-pink mb-3">{copyMsg}</p>
      )}

      {error && (
        <div className="bg-red-950 border border-red-800 rounded-xl p-4 text-red-300 text-sm mb-4">
          {error}
        </div>
      )}

      {!loading && favourites.length === 0 && (
        <div className="text-center py-16">
          <Star
            size={48}
            className="mx-auto text-yellow-400/40 mb-4"
            fill="currentColor"
          />
          <p className="text-sm text-gray-400 mb-2">
            No picks yet.
          </p>
          <p className="text-xs text-gray-500 max-w-md mx-auto">
            Hit the star on any show card or in the show detail to add
            it here. Saved picks stay on this browser; you can export
            them to your calendar or share a link with a friend.
          </p>
        </div>
      )}

      {!loading && favourites.length > 0 && byDate.length === 0 && (
        <p className="text-center text-gray-500 py-12 text-sm">
          Your starred shows don't have any upcoming performance data yet.
          Try selecting a date in the date strip above.
        </p>
      )}

      <div className="space-y-6">
        {byDate.map(([date, rows]) => {
          const conflicts = findConflicts(rows);
          let prettyDate = date;
          try {
            prettyDate = format(parseISO(date), "EEEE d MMMM");
          } catch {}
          return (
            <section key={date}>
              <header className="flex items-baseline justify-between mb-2">
                <h3 className="text-sm font-bold text-white">
                  {prettyDate}
                </h3>
                <span className="text-[11px] text-gray-500">
                  {rows.length} performance{rows.length === 1 ? "" : "s"}
                </span>
              </header>

              {conflicts.length > 0 && (
                <div className="mb-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 text-yellow-300 text-xs p-2.5 space-y-1">
                  {conflicts.map(([a, b], i) => (
                    <p key={i} className="flex items-start gap-1.5">
                      <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                      <span>
                        Overlap: <strong>{a.show.title}</strong>{" "}
                        ({a.time}) clashes with{" "}
                        <strong>{b.show.title}</strong> ({b.time}).
                      </span>
                    </p>
                  ))}
                </div>
              )}

              <ol className="space-y-2">
                {rows.map((row, idx) => (
                  <PicksRow
                    key={`${row.show.slug}-${row.time}-${idx}`}
                    row={row}
                    nextRow={rows[idx + 1]}
                    onSelectShow={onSelectShow}
                    onSelectVenue={onSelectVenue}
                    onToggle={toggleFavourite}
                  />
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function PicksRow({ row, nextRow, onSelectShow, onSelectVenue, onToggle }) {
  const s = row.show;
  // Walking-distance hint to the NEXT pick on this day, if both venues
  // are geocoded and they're different venues.
  let walkLabel = null;
  if (
    nextRow &&
    s.venue_slug &&
    nextRow.show.venue_slug &&
    s.venue_slug !== nextRow.show.venue_slug &&
    s.venue_lat != null &&
    s.venue_lng != null &&
    nextRow.show.venue_lat != null &&
    nextRow.show.venue_lng != null
  ) {
    const m = distanceMetres(
      s.venue_lat,
      s.venue_lng,
      nextRow.show.venue_lat,
      nextRow.show.venue_lng,
    );
    if (m != null) walkLabel = formatDistance(m);
  }

  return (
    <li>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 flex items-start gap-3 hover:border-fringe-pink/40 transition-colors">
        <div className="min-w-[3.5rem] text-fringe-pink leading-tight">
          <Clock size={11} className="opacity-70" />
          <span className="block text-base font-bold tabular-nums">
            {row.time || "—"}
          </span>
          {s.duration_minutes && (
            <span className="block text-[10px] text-gray-500">
              {s.duration_minutes} min
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <button
            onClick={() => onSelectShow(s.slug)}
            className="text-left block"
          >
            <p className="text-sm font-semibold text-white hover:text-fringe-pink transition-colors">
              {s.title}
            </p>
            {s.company && (
              <p className="text-[11px] text-gray-400 truncate">
                {s.company}
              </p>
            )}
          </button>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {s.genre && <GenreBadge genre={s.genre} />}
            {s.min_price === 0 ? (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-500/20 border border-green-500/50 text-green-400">
                FREE
              </span>
            ) : s.min_price > 0 ? (
              <span className="text-[11px] text-fringe-pink font-semibold flex items-center gap-0.5">
                <Ticket size={10} />£{s.min_price}
              </span>
            ) : null}
            {s.venue_name && (
              <button
                onClick={() =>
                  s.venue_slug && onSelectVenue && onSelectVenue(s.venue_slug)
                }
                className="text-[11px] text-gray-400 inline-flex items-center gap-0.5 hover:text-fringe-pink truncate max-w-[14rem]"
                title="Open venue page"
              >
                <MapPin size={10} /> {s.venue_name}
              </button>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onToggle(s.slug)}
          className="p-1.5 rounded-full text-yellow-400 hover:bg-gray-800"
          title="Remove from My picks"
        >
          <Star size={14} fill="currentColor" />
        </button>
      </div>
      {walkLabel && (
        <p className="text-[11px] text-gray-500 ml-[4.5rem] mt-1 mb-0">
          → {walkLabel} to next venue
        </p>
      )}
    </li>
  );
}
