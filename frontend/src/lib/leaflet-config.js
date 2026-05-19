// Shared Leaflet setup.
//
// Single-venue markers use a custom inline-SVG pin (classic teardrop,
// fringe-pink). This replaces Leaflet's default PNG marker, which pulls
// from unpkg.com and was occasionally rendering broken / corrupted --
// either because unpkg blocked the request or because Vite + leaflet's
// webpack-style icon URLs disagreed on the path. Inline SVG removes the
// network dependency entirely.
//
// Also: react-leaflet 4 crashes if a Marker receives `icon={undefined}`
// (it calls undefined.createIcon()), so always pass DEFAULT_ICON
// explicitly rather than leaving the prop unset.
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// 24x36 teardrop. White-bordered pink body, white centre dot.
const PIN_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="24" height="36" style="display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.35))">
  <path d="M12 0.75C5.92 0.75 1 5.67 1 11.75c0 8.5 11 23.5 11 23.5s11-15 11-23.5c0-6.08-4.92-11-11-11z" fill="#E91E8C" stroke="white" stroke-width="1.5"/>
  <circle cx="12" cy="11.75" r="4" fill="white"/>
</svg>
`.trim();

export const DEFAULT_ICON = L.divIcon({
  className: "",
  html: PIN_SVG,
  iconSize: [24, 36],
  iconAnchor: [12, 36], // tip touches the geographic point
  popupAnchor: [0, -32], // popup opens just above the pin head
});

// Returns true if the venue is a virtual/streaming/online "venue" with no
// physical location. Kept here so frontend code can branch on it the same
// way the backend geocoder does (skipping the location lookup).
export function isVirtualVenue(venue) {
  return !!(venue?.name && /\b(streaming|online|virtual|digital)\b/i.test(venue.name));
}

export { L };
