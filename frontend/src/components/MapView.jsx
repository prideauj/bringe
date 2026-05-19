import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import { MapPin } from "lucide-react";
import { L, DEFAULT_ICON } from "../lib/leaflet-config";

// Pink fringe-themed icon for venues that have multiple shows.
function clusterIcon(count) {
  return L.divIcon({
    className: "",
    html: `<div style="
      background:#E91E8C;
      color:white;
      border:2px solid white;
      border-radius:9999px;
      box-shadow:0 2px 8px rgba(0,0,0,0.4);
      width:34px;height:34px;
      display:flex;align-items:center;justify-content:center;
      font-weight:700;font-size:13px;font-family:system-ui">
      ${count}
    </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

// Auto-fit the map to the bounds of all markers whenever the set of points
// changes (e.g. when the user picks a different date).
function FitToMarkers({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }, [points, map]);
  return null;
}

// Brighton sea-front fallback centre if there are no points to fit to.
const BRIGHTON_CENTRE = [50.8225, -0.1372];

export default function MapView({ shows, onSelectShow }) {
  // Group shows by venue so a venue showing 12 shows on the same day gets
  // a single pin labelled "12" rather than 12 stacked markers.
  const venues = useMemo(() => {
    const map = new Map();
    for (const s of shows) {
      if (s.venue_lat == null || s.venue_lng == null) continue;
      const key = s.venue_slug || `${s.venue_lat},${s.venue_lng}`;
      if (!map.has(key)) {
        map.set(key, {
          slug: s.venue_slug,
          name: s.venue_name,
          lat: s.venue_lat,
          lng: s.venue_lng,
          shows: [],
        });
      }
      map.get(key).shows.push(s);
    }
    return [...map.values()];
  }, [shows]);

  const missingCount = shows.filter((s) => s.venue_lat == null).length;

  return (
    <div className="relative">
      <div className="h-[calc(100vh-220px)] min-h-[400px] rounded-2xl overflow-hidden border border-gray-800">
        <MapContainer
          center={BRIGHTON_CENTRE}
          zoom={14}
          scrollWheelZoom
          className="h-full w-full"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitToMarkers points={venues} />

          {venues.map((v) => (
            <Marker
              key={v.slug || `${v.lat},${v.lng}`}
              position={[v.lat, v.lng]}
              icon={v.shows.length > 1 ? clusterIcon(v.shows.length) : DEFAULT_ICON}
            >
              <Popup minWidth={240} maxWidth={320}>
                <div className="text-gray-900">
                  <p className="font-bold text-sm mb-1 flex items-center gap-1">
                    <MapPin size={12} /> {v.name || "Venue"}
                  </p>
                  <ul className="space-y-1 max-h-60 overflow-y-auto pr-1">
                    {v.shows.map((s) => (
                      <li key={s.slug}>
                        <button
                          onClick={() => onSelectShow(s.slug)}
                          className="text-left w-full text-xs text-fringe-purple hover:underline leading-tight"
                        >
                          {s.next_time ? `${s.next_time} · ` : ""}
                          <span className="font-semibold">{s.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {missingCount > 0 && (
        <p className="text-xs text-gray-500 mt-2">
          {missingCount} show{missingCount === 1 ? "" : "s"} not shown — venue
          not yet geocoded. Run "Geocode venues" in settings.
        </p>
      )}
    </div>
  );
}
