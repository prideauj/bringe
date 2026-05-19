import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { MapPin, Globe, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { MapContainer, TileLayer, Marker } from "react-leaflet";
import GenreBadge from "./GenreBadge";
import StarRating from "./StarRating";
import { isVirtualVenue, DEFAULT_ICON } from "../lib/leaflet-config";
import { geocodeVenue, STATIC_MODE } from "../lib/api";

// Card-grid layout: each venue is a self-contained card, shows inside
// listed in time order. Cards flow into a responsive grid so the page
// stays tidy regardless of how many venues there are.
export default function VenuesView({ shows, onSelectShow, dateFilter }) {
  const venues = useMemo(() => {
    const map = new Map();

    function ensure(slug, name, lat, lng) {
      const key = slug || `__unknown__:${name || "Unknown venue"}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          slug,
          name: name || "Unknown venue",
          lat: lat ?? null,
          lng: lng ?? null,
          rows: [],
        });
      }
      return map.get(key);
    }

    for (const s of shows) {
      const v = ensure(s.venue_slug, s.venue_name, s.venue_lat, s.venue_lng);
      if (Array.isArray(s.times) && s.times.length) {
        for (const t of s.times) {
          v.rows.push({ show: s, date: t.date, time: t.time });
        }
      } else if (s.next_date) {
        v.rows.push({ show: s, date: s.next_date, time: s.next_time || "" });
      } else {
        v.rows.push({ show: s, date: "", time: "" });
      }
    }

    for (const v of map.values()) {
      v.rows.sort((a, b) =>
        (a.date + (a.time || "")).localeCompare(b.date + (b.time || ""))
      );
    }

    return [...map.values()].sort((a, b) => {
      const aUnknown = !a.slug;
      const bUnknown = !b.slug;
      if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [shows]);

  if (!venues.length) {
    return (
      <p className="text-center text-gray-500 py-12 text-sm">
        No venues match the current filters.
      </p>
    );
  }

  const multiDay = (dateFilter?.length || 0) > 1;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {venues.map((v) => (
        <VenueCard
          key={v.key}
          venue={v}
          multiDay={multiDay}
          onSelectShow={onSelectShow}
        />
      ))}
    </div>
  );
}

function VenueCard({ venue, multiDay, onSelectShow }) {
  const virtual = isVirtualVenue(venue);
  // Local coord state so a click-to-locate result persists for the rest
  // of the session even though the parent's `shows` array still has the
  // old null lat/lng. Refreshed on the next data load anyway.
  const [coords, setCoords] = useState(
    venue.lat != null && venue.lng != null ? [venue.lat, venue.lng] : null
  );
  const [mapOpen, setMapOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState(null);

  async function handleHeaderClick() {
    setErr(null);
    if (virtual) return;
    if (coords) {
      setMapOpen((v) => !v);
      return;
    }
    if (!venue.slug) {
      setErr("No venue page on record.");
      return;
    }
    if (STATIC_MODE) {
      setErr("Venue location not available in this snapshot.");
      return;
    }
    setLocating(true);
    try {
      const updated = await geocodeVenue(venue.slug);
      if (updated?.lat != null && updated?.lng != null) {
        setCoords([updated.lat, updated.lng]);
        setMapOpen(true);
      } else {
        setErr("Couldn't locate this venue.");
      }
    } catch {
      setErr("Error contacting geocoder.");
    } finally {
      setLocating(false);
    }
  }

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden flex flex-col hover:border-fringe-pink/30 transition-colors">
      <button
        onClick={handleHeaderClick}
        disabled={virtual || locating}
        title={
          virtual
            ? "Online event — no map"
            : coords
            ? mapOpen
              ? "Hide map"
              : "Show map"
            : "Click to locate this venue"
        }
        className="px-4 py-3 border-b border-gray-800 flex items-center gap-2 text-left hover:bg-gray-800/50 disabled:opacity-100 disabled:cursor-default transition-colors"
      >
        {virtual ? (
          <Globe size={14} className="text-fringe-teal flex-shrink-0" />
        ) : locating ? (
          <Loader2 size={14} className="text-gray-400 flex-shrink-0 animate-spin" />
        ) : (
          <MapPin size={14} className="text-gray-400 flex-shrink-0" />
        )}
        <h3 className="text-sm font-bold text-white truncate flex-1">
          {venue.name}
        </h3>
        {!virtual && (
          coords ? (
            mapOpen ? (
              <ChevronUp size={13} className="text-gray-400 flex-shrink-0" />
            ) : (
              <ChevronDown size={13} className="text-gray-400 flex-shrink-0" />
            )
          ) : (
            <span className="text-[10px] text-fringe-teal flex-shrink-0">
              locate
            </span>
          )
        )}
        <span className="text-[11px] text-gray-500 flex-shrink-0">
          {venue.rows.length} show{venue.rows.length === 1 ? "" : "s"}
        </span>
      </button>

      {err && (
        <p className="px-4 py-1.5 text-[11px] text-red-400 border-b border-gray-800">
          {err}
        </p>
      )}

      {mapOpen && coords && (
        <div
          className="border-b border-gray-800"
          style={{ height: 180 }}
        >
          <MapContainer
            key={`${coords[0]},${coords[1]}`}
            center={coords}
            zoom={16}
            scrollWheelZoom={false}
            className="h-full w-full"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={coords} icon={DEFAULT_ICON} />
          </MapContainer>
        </div>
      )}
      <ul className="divide-y divide-gray-800/60">
        {venue.rows.map((row, idx) => (
          <li key={`${row.show.slug}-${row.date}-${row.time}-${idx}`}>
            <button
              onClick={() => onSelectShow(row.show.slug)}
              className="w-full text-left px-3 py-2.5 flex items-start gap-2.5 hover:bg-gray-800/60 transition-colors"
            >
              {/* Time column */}
              <div className="flex flex-col items-center justify-center min-w-[3rem] text-fringe-pink leading-tight">
                {multiDay && row.date && (
                  <span className="text-[9px] uppercase tracking-wider opacity-80">
                    {fmtWeekday(row.date)}
                  </span>
                )}
                <span className="text-sm font-bold tabular-nums">
                  {row.time || "—"}
                </span>
                {row.show.is_sold_out && (
                  <span className="text-[9px] text-red-400 font-semibold mt-0.5">
                    SOLD
                  </span>
                )}
              </div>

              {/* Content column */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white leading-snug line-clamp-2">
                  {row.show.title}
                </p>
                {row.show.company && (
                  <p className="text-[11px] text-gray-400 truncate">
                    {row.show.company}
                  </p>
                )}
                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                  {row.show.genre && <GenreBadge genre={row.show.genre} />}
                  {row.show.min_price === 0 ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-500/20 border border-green-500/50 text-green-400">
                      FREE
                    </span>
                  ) : row.show.min_price > 0 ? (
                    <span className="text-[11px] text-fringe-pink font-semibold">
                      £{row.show.min_price}
                    </span>
                  ) : null}
                  {row.show.avg_rating && (
                    <StarRating
                      rating={row.show.avg_rating}
                      count={row.show.review_count}
                    />
                  )}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function fmtWeekday(d) {
  try {
    return format(parseISO(d), "EEE");
  } catch {
    return d;
  }
}
