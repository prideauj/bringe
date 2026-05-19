import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  X, ExternalLink, MapPin, Clock, Ticket, Users, Calendar,
  AlertCircle, Accessibility, Star, Instagram, Twitter, Globe, Loader2,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { MapContainer, TileLayer, Marker } from "react-leaflet";
import { fetchShow, geocodeVenue, STATIC_MODE } from "../lib/api";
import { DEFAULT_ICON, isVirtualVenue } from "../lib/leaflet-config";
import GenreBadge from "./GenreBadge";
import StarRating from "./StarRating";

function formatDate(dateStr, timeStr) {
  if (!dateStr) return dateStr;
  try {
    const d = parseISO(dateStr);
    const day = format(d, "EEEE d MMMM yyyy");
    return timeStr ? `${day} at ${timeStr}` : day;
  } catch {
    return `${dateStr}${timeStr ? " at " + timeStr : ""}`;
  }
}

export default function ShowModal({
  slug,
  dateFilter = [],
  onClose,
  isFavourite,
  onToggleFavourite,
  onSelectVenue,
}) {
  const [show, setShow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAllDates, setShowAllDates] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchShow(slug).then(setShow).finally(() => setLoading(false));
  }, [slug]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const avgRating = show?.reviews?.length
    ? show.reviews.reduce((s, r) => s + (r.rating_stars || 0), 0) / show.reviews.filter((r) => r.rating_stars).length
    : null;

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

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin text-4xl">🎭</div>
          </div>
        ) : !show ? (
          <div className="p-8 text-center text-gray-400">Show not found.</div>
        ) : (
          <>
            {/* Hero image */}
            {show.image_url && (
              <div className="aspect-[21/9] relative overflow-hidden rounded-t-2xl">
                <img
                  src={show.image_url}
                  alt={show.title}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-transparent to-transparent" />
              </div>
            )}

            <div className="p-6 space-y-6">
              {/* Title & meta */}
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <GenreBadge genre={show.genre} />
                  {avgRating && <StarRating rating={avgRating} count={show.reviews.length} />}
                  {onToggleFavourite && (
                    <button
                      type="button"
                      onClick={() => onToggleFavourite(show.slug)}
                      className={`ml-auto flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold transition-colors ${
                        isFavourite
                          ? "border-yellow-400 bg-yellow-400/10 text-yellow-400"
                          : "border-gray-700 text-gray-400 hover:border-yellow-400 hover:text-yellow-400"
                      }`}
                    >
                      <Star
                        size={13}
                        fill={isFavourite ? "currentColor" : "none"}
                      />
                      {isFavourite ? "In my picks" : "Add to picks"}
                    </button>
                  )}
                </div>
                <h2 className="text-2xl font-bold text-white">{show.title}</h2>
                {show.company && (
                  <p className="text-gray-400 flex items-center gap-1 mt-1">
                    <Users size={14} /> {show.company}
                  </p>
                )}
              </div>

              {/* Times for the selected date(s) — compact row near the top */}
              <TimesForSelected show={show} dateFilter={dateFilter} />

              {/* Quick facts */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {show.venue?.name && (
                  <VenueCard
                    venue={show.venue}
                    onGeocoded={(v) => setShow({ ...show, venue: v })}
                    onSelectVenue={onSelectVenue}
                  />
                )}
                {show.duration_minutes && (
                  <FactPill icon={<Clock size={13} />} label="Duration" value={`${show.duration_minutes} mins`} />
                )}
                {show.age_suitability && (
                  <FactPill icon={<Users size={13} />} label="Suitable for" value={show.age_suitability} />
                )}
              </div>

              {/* Description */}
              {show.description && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">About</h3>
                  <p className="text-gray-300 text-sm leading-relaxed">{show.description}</p>
                </div>
              )}

              {/* Performances */}
              {show.performances?.length > 0 &&
                (() => {
                  // If the user has selected specific dates on the main page,
                  // we hide the other performances by default so the booking
                  // buttons only reflect what they actually want to attend.
                  // A toggle reveals the full schedule on demand.
                  const filterActive = dateFilter.length > 0 && !showAllDates;
                  const dset = new Set(dateFilter);
                  const allPerfs = [...show.performances].sort((a, b) =>
                    (a.date + (a.time || "")).localeCompare(b.date + (b.time || ""))
                  );
                  const visible = filterActive
                    ? allPerfs.filter((p) => dset.has(p.date))
                    : allPerfs;
                  const hiddenCount = allPerfs.length - visible.length;
                  return (
                    <div>
                      <div className="flex items-baseline justify-between mb-3">
                        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                          Performances
                          {filterActive && (
                            <span className="ml-2 normal-case text-fringe-pink text-xs">
                              · filtered to selected date{dateFilter.length === 1 ? "" : "s"}
                            </span>
                          )}
                        </h3>
                        {dateFilter.length > 0 && hiddenCount > 0 && (
                          <button
                            onClick={() => setShowAllDates((v) => !v)}
                            className="text-xs text-gray-400 hover:text-fringe-pink underline"
                          >
                            {showAllDates
                              ? "Show only selected dates"
                              : `Show all ${allPerfs.length} performances`}
                          </button>
                        )}
                      </div>
                      <div className="space-y-2">
                        {visible.length === 0 ? (
                          <p className="text-sm text-gray-500">
                            No performances on the selected date
                            {dateFilter.length === 1 ? "" : "s"}.
                          </p>
                        ) : (
                          visible.map((p) => (
                            <div
                              key={p.id}
                              className={`flex items-center justify-between p-3 rounded-xl border ${
                                p.is_sold_out
                                  ? "border-gray-700 opacity-50"
                                  : "border-gray-700 hover:border-fringe-pink/40"
                              } transition-colors`}
                            >
                              <div className="flex items-center gap-2 text-sm">
                                <Calendar size={14} className="text-gray-400" />
                                <span className="text-gray-300">
                                  {formatDate(p.date, p.time)}
                                </span>
                                {p.is_sold_out && (
                                  <span className="text-red-400 text-xs font-semibold">
                                    SOLD OUT
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3">
                                {p.standard_price !== null && (
                                  <span className="text-sm">
                                    <span className="text-fringe-pink font-semibold">
                                      {p.standard_price === 0
                                        ? "Free"
                                        : `£${p.standard_price}`}
                                    </span>
                                    {p.concession_price != null &&
                                      p.concession_price !== p.standard_price && (
                                        <span className="text-gray-400 text-xs ml-1">
                                          / £{p.concession_price} conc.
                                        </span>
                                      )}
                                  </span>
                                )}
                                {!p.is_sold_out && (
                                  <a
                                    href={p.booking_url || show.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-1 px-3 py-1 rounded-lg bg-fringe-pink text-white text-xs font-semibold hover:bg-pink-500 transition-colors"
                                  >
                                    <Ticket size={11} /> Book
                                  </a>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })()}

              {/* Cast */}
              {show.cast?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Cast</h3>
                  <div className="flex flex-wrap gap-2">
                    {show.cast.map((name) => (
                      <span key={name} className="px-2 py-1 bg-gray-800 rounded-lg text-xs text-gray-300">
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Accessibility */}
              {show.accessibility_features?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Accessibility size={14} /> Accessibility
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {show.accessibility_features.map((f) => (
                      <span key={f} className="px-2 py-1 bg-teal-900/40 border border-teal-600/30 text-teal-300 rounded-lg text-xs">
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Content warnings */}
              {show.content_warnings?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <AlertCircle size={14} /> Content Warnings
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {show.content_warnings.map((w) => (
                      <span key={w} className="px-2 py-1 bg-yellow-900/30 border border-yellow-600/30 text-yellow-300 rounded-lg text-xs">
                        {w}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Reviews */}
              {show.reviews?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1">
                    <Star size={14} /> Reviews
                  </h3>
                  <div className="space-y-3">
                    {show.reviews.map((r) => (
                      <div key={r.id} className="p-4 bg-gray-800 rounded-xl border border-gray-700">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div>
                            <span className="text-xs font-semibold text-gray-400">{r.source_site}</span>
                            {r.reviewer && <span className="text-gray-500 text-xs"> · {r.reviewer}</span>}
                          </div>
                          {r.rating_stars && <StarRating rating={r.rating_stars} />}
                        </div>
                        {r.excerpt && <p className="text-gray-300 text-sm leading-relaxed">{r.excerpt}</p>}
                        {r.review_url && (
                          <a
                            href={r.review_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-fringe-pink hover:underline mt-2"
                          >
                            Read full review <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Links */}
              <div className="flex flex-wrap gap-3 pt-2 border-t border-gray-800">
                <a
                  href={show.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-sm text-fringe-pink hover:underline"
                >
                  <ExternalLink size={13} /> Brighton Fringe page
                </a>
                {show.website && (
                  <a href={show.website} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 text-sm text-gray-400 hover:text-white">
                    <Globe size={13} /> Website
                  </a>
                )}
                {show.instagram && (
                  <a href={show.instagram} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 text-sm text-gray-400 hover:text-pink-400">
                    <Instagram size={13} /> Instagram
                  </a>
                )}
                {show.twitter && (
                  <a href={show.twitter} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 text-sm text-gray-400 hover:text-blue-400">
                    <Twitter size={13} /> Twitter/X
                  </a>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FactPill({ icon, label, value }) {
  return (
    <div className="flex items-start gap-2 p-3 bg-gray-800 rounded-xl">
      <span className="text-gray-400 mt-0.5">{icon}</span>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm text-gray-200">{value}</p>
      </div>
    </div>
  );
}

// Compact row of time pills for the date(s) the user has currently selected
// on the main listing. Shows weekday prefix when more than one date is in
// play so "Sat 14:00 · Sun 19:30" reads sensibly.
function TimesForSelected({ show, dateFilter }) {
  if (!show.performances?.length || !dateFilter?.length) return null;
  const dset = new Set(dateFilter);
  const relevant = show.performances
    .filter((p) => dset.has(p.date) && p.time)
    .slice()
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  if (!relevant.length) return null;
  const multiDay = new Set(relevant.map((p) => p.date)).size > 1;
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <Clock size={13} className="text-gray-400 flex-shrink-0" />
      {relevant.map((p) => {
        let label = p.time;
        if (multiDay) {
          try {
            label = `${format(parseISO(p.date), "EEE")} ${p.time}`;
          } catch {}
        }
        return (
          <span
            key={p.id}
            className={`px-2 py-0.5 rounded text-xs font-semibold tabular-nums ${
              p.is_sold_out
                ? "bg-gray-800 border border-gray-700 text-gray-500 line-through"
                : "bg-fringe-pink/15 border border-fringe-pink/40 text-fringe-pink"
            }`}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

// Venue panel. Three states:
//   - Virtual (Brighton Fringe Streaming etc): rendered as an "Online event"
//     pill. No click action, no map -- there's no physical location.
//   - Has coords: click toggles an inline OpenStreetMap mini-map below.
//   - No coords: click asks the backend to geocode the venue (which will
//     scrape the venue page for an address first), then auto-opens the
//     mini-map with the new coordinates.
function VenueCard({ venue, onGeocoded, onSelectVenue }) {
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState(null);
  const [mapOpen, setMapOpen] = useState(false);

  const virtual = isVirtualVenue(venue);
  const hasCoords = venue.lat != null && venue.lng != null;

  // Online/virtual venues: no map, no click.
  if (virtual) {
    return (
      <div className="flex items-start gap-2 p-3 bg-gray-800 rounded-xl">
        <Globe size={13} className="text-fringe-teal mt-0.5 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-500">Venue</p>
          <p className="text-sm text-gray-200 truncate">{venue.name}</p>
          <p className="text-[11px] text-fringe-teal mt-0.5">
            Online event — no physical location
          </p>
        </div>
      </div>
    );
  }

  async function handleClick() {
    setErr(null);
    if (hasCoords) {
      setMapOpen((v) => !v);
      return;
    }
    if (STATIC_MODE) {
      // No backend to geocode against; nothing to do.
      setErr("Venue location not available in this snapshot.");
      return;
    }
    setLocating(true);
    try {
      const updated = await geocodeVenue(venue.slug);
      onGeocoded?.(updated);
      if (updated.lat != null && updated.lng != null) {
        setMapOpen(true);
      } else {
        setErr("Couldn't locate this venue automatically.");
      }
    } catch {
      setErr("Error contacting geocoder.");
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="p-3 bg-gray-800 rounded-xl border border-transparent hover:border-fringe-pink/40 transition-colors">
      <button
        onClick={handleClick}
        disabled={locating}
        title={
          hasCoords
            ? mapOpen
              ? "Hide map"
              : "Show map"
            : "Click to locate this venue"
        }
        className="text-left flex items-start gap-2 w-full disabled:opacity-60"
      >
        <span className="text-gray-400 mt-0.5 flex-shrink-0">
          {locating ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <MapPin size={13} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-500 flex items-center gap-1">
            Venue
            {hasCoords && (
              mapOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />
            )}
          </p>
          <p className="text-sm text-gray-200 truncate">{venue.name}</p>
          {venue.address && (
            <p className="text-[11px] text-gray-500 mt-0.5 truncate">
              {venue.address}
            </p>
          )}
          {err && <p className="text-[11px] text-red-400 mt-1">{err}</p>}
          {!hasCoords && !err && !locating && (
            <p className="text-[11px] text-fringe-teal mt-0.5">
              Click to locate on map
            </p>
          )}
        </div>
      </button>

      {mapOpen && hasCoords && (
        <div
          className="mt-3 rounded-lg overflow-hidden border border-gray-700"
          style={{ height: 220 }}
        >
          {/* Keying on coords forces a fresh map when the venue is
              re-geocoded mid-session, avoiding Leaflet trying to mutate
              an already-disposed map instance. */}
          <MapContainer
            key={`${venue.lat},${venue.lng}`}
            center={[venue.lat, venue.lng]}
            zoom={16}
            scrollWheelZoom={false}
            className="h-full w-full"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={[venue.lat, venue.lng]} icon={DEFAULT_ICON} />
          </MapContainer>
        </div>
      )}

      {/* Deep-link into the venue page: full address, larger map, every
          show at this venue across the festival. */}
      {onSelectVenue && venue.slug && (
        <button
          type="button"
          onClick={() => onSelectVenue(venue.slug)}
          className="mt-2 text-xs text-fringe-pink hover:underline self-start"
        >
          All shows at this venue →
        </button>
      )}
    </div>
  );
}
