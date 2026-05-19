// Shared Leaflet setup.
//
// Leaflet's default-marker icons are loaded via webpack-style relative URLs
// that Vite mangles, leaving the markers invisible. Configure them once
// against the CDN copies. Importing this module from anywhere that uses
// Leaflet ensures the default icon is ready before the first <Marker>.
//
// Also: react-leaflet 4 crashes if a Marker receives `icon={undefined}` --
// it calls undefined.createIcon(). Always use the exported DEFAULT_ICON
// instance instead of leaving the prop unset.
import L from "leaflet";
import "leaflet/dist/leaflet.css";

L.Icon.Default.mergeOptions({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export const DEFAULT_ICON = new L.Icon.Default();

// Returns true if the venue is a virtual/streaming/online "venue" with no
// physical location. Kept here so frontend code can branch on it the same
// way the backend geocoder does (skipping the location lookup).
export function isVirtualVenue(venue) {
  return !!(venue?.name && /\b(streaming|online|virtual|digital)\b/i.test(venue.name));
}

export { L };
