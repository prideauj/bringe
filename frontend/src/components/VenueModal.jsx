import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { X, MapPin, Globe, ExternalLink, Loader2, Star } from "lucide-react";
import { MapContainer, TileLayer, Marker } from "react-leaflet";
import { fetchShows, fetchVenues, geocodeVenue, STATIC_MODE } from "../lib/api";
import { DEFAULT_ICON, isVirtualVenue } from "../lib/leaflet-config";
import GenreBadge from "./GenreBadge";

// Detail page for a single venue. Pulls the venue record from the
// cached venues list and all shows at the venue via fetchShows
// (which in static mode filters the snapshot client-side, in live mode
// hits /api/shows?venue_slug=...).
export default function VenueModal({
  slug,
  venues,
  onClose,
  onSelectShow,
  isFavourite,
  onToggleFavourite,
}) {
  const [venue, setVenue] = useState(() =>
    (venues || []).find((v) => v.slug === slug) || null
  );
  const [shows, setShows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);

  // Refresh from /api/venues if we didn't get a hit from the cached
  // list (shouldn't happen often, but possible if the venue was added
  // mid-session).
  useEffect(() => {
    if (venue) return;
    fetchVenues()
      .then((vs) => setVenue(vs.find((v) => v.slug === slug) || null))
      .catch(() => {});
  }, [slug, venue]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchShows({ venue_slug: slug, limit: 500, sort: "next_date" })
      .then((data) => {
        if (!cancelled) setShows(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Close on Escape, same affordance as ShowModal.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Build per-day buckets of (show, time) entries -- one row per
  // performance of each show at this venue.
  const byDate = useMemo(() => {
    const map = new Map();
    for (const s of shows) {
      if (Array.isArray(s.times) && s.times.length) {
        // When date filter is active, `times` is populated. Otherwise
        // we fall back to next_date/next_time, which only gives us one
        // row per show. For a venue page we want all performances, so
        // when we don't have times we synthesise them from the show's
        // own list if available.
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

  async function handleLocate() {
    if (!venue || STATIC_MODE) return;
    setLocating(true);
    try {
      const updated = await geocodeVenue(slug);
      setVenue(updated);
    } catch {}
    setLocating(false);
  }

  const virtual = venue && isVirtualVenue(venue);
  const hasCoords = venue && venue.lat != null && venue.lng != null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
        >
          <X size={18} />
        </button>

        <div className="p-6 space-y-6">
          {/* Header */}
          <div>
            <div className="flex items-center gap-2 mb-2 text-fringe-pink">
              {virtual ? <Globe size={16} /> : <MapPin size={16} />}
              <span className="text-xs uppercase tracking-wider text-gray-500">
                Venue
              </span>
            </div>
            <h2 className="text-2xl font-bold text-white">
              {venue?.name || "Loading…"}
            </h2>
            {venue?.address && (
              <p className="text-sm text-gray-400 mt-1">{venue.address}</p>
            )}
            {virtual && (
              <p className="text-sm text-fringe-teal mt-1">
                Online event — no physical location
              </p>
            )}
          </div>

          {/* Inline map */}
          {!virtual && hasCoords && (
            <div
              className="rounded-xl overflow-hidden border border-gray-800"
              style={{ height: 280 }}
            >
              <MapContainer
                key={`${venue.lat},${venue.lng}`}
                center={[venue.lat, venue.lng]}
                zoom={16}
                scrollWheelZoom
                className="h-full w-full"
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <Marker
                  position={[venue.lat, venue.lng]}
                  icon={DEFAULT_ICON}
                />
              </MapContainer>
            </div>
          )}
          {!virtual && !hasCoords && (
            <div className="text-sm text-gray-400 flex items-center gap-2">
              {locating ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <MapPin size={14} />
              )}
              Location not yet plotted.
              {!STATIC_MODE && (
                <button
                  onClick={handleLocate}
                  disabled={locating}
                  className="text-fringe-pink hover:underline disabled:opacity-50"
                >
                  Locate now
                </button>
              )}
            </div>
          )}

          {venue?.url && (
            <a
              href={venue.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-fringe-pink hover:underline"
            >
              <ExternalLink size={13} /> Brighton Fringe venue page
            </a>
          )}

          {/* Per-day show listings */}
          <div>
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
              {loading
                ? "Loading shows…"
                : `${shows.length} show${shows.length === 1 ? "" : "s"} at this venue`}
            </h3>
            {!loading && byDate.length === 0 && (
              <p className="text-sm text-gray-500">
                No upcoming performances at this venue.
              </p>
            )}
            <div className="space-y-4">
              {byDate.map(([date, rows]) => (
                <section key={date}>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    {(() => {
                      try {
                        return format(parseISO(date), "EEEE d MMMM");
                      } catch {
                        return date;
                      }
                    })()}
                  </h4>
                  <ul className="divide-y divide-gray-800 border border-gray-800 rounded-xl overflow-hidden">
                    {rows.map((row, idx) => (
                      <li key={`${row.show.slug}-${row.time}-${idx}`}>
                        <button
                          onClick={() => onSelectShow(row.show.slug)}
                          className="w-full text-left px-3 py-2.5 flex items-start gap-3 hover:bg-gray-800/60 transition-colors"
                        >
                          <span className="min-w-[3rem] text-sm font-bold text-fringe-pink tabular-nums">
                            {row.time || "—"}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-semibold text-white">
                              {row.show.title}
                              {isFavourite && isFavourite(row.show.slug) && (
                                <Star
                                  size={12}
                                  fill="currentColor"
                                  className="inline ml-1.5 text-yellow-400"
                                />
                              )}
                            </span>
                            {row.show.company && (
                              <span className="block text-[11px] text-gray-400 truncate">
                                {row.show.company}
                              </span>
                            )}
                            <span className="mt-1 inline-flex items-center gap-1.5 flex-wrap">
                              {row.show.genre && (
                                <GenreBadge genre={row.show.genre} />
                              )}
                              {row.show.min_price === 0 ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-500/20 border border-green-500/50 text-green-400">
                                  FREE
                                </span>
                              ) : row.show.min_price > 0 ? (
                                <span className="text-[11px] text-fringe-pink font-semibold">
                                  £{row.show.min_price}
                                </span>
                              ) : null}
                            </span>
                          </span>
                          {onToggleFavourite && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleFavourite(row.show.slug);
                              }}
                              className={`p-1.5 rounded-full ${
                                isFavourite && isFavourite(row.show.slug)
                                  ? "text-yellow-400"
                                  : "text-gray-500 hover:text-yellow-400"
                              }`}
                            >
                              <Star
                                size={14}
                                fill={
                                  isFavourite && isFavourite(row.show.slug)
                                    ? "currentColor"
                                    : "none"
                                }
                              />
                            </button>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
