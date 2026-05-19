// Great-circle distance between two lat/lng points in metres.
// Festival-scale (a few km), so straight-line is a good enough proxy
// for walking distance -- Brighton's grid is roughly straight anyway.

export function distanceMetres(lat1, lng1, lat2, lng2) {
  if (
    lat1 == null || lng1 == null ||
    lat2 == null || lng2 == null
  ) {
    return null;
  }
  const R = 6371000; // Earth's radius in m
  const toRad = (d) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lng2 - lng1);
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Human-friendly distance label. Under 1 km -> rounded to nearest 10 m;
// over -> one decimal place in km.
export function formatDistance(m) {
  if (m == null) return null;
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
}
