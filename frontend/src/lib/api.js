// Two-mode API client.
//
// Live mode (default in dev): calls the local FastAPI server at /api/...
// Static mode (production build for Render Static): all reads come from
// snapshot JSON files under /data/*; write endpoints are no-ops. Toggled
// by VITE_STATIC_MODE=1 at build time.

import axios from "axios";
import * as staticApi from "./api-static";

export const STATIC_MODE =
  String(import.meta.env.VITE_STATIC_MODE || "").toLowerCase() === "1" ||
  String(import.meta.env.VITE_STATIC_MODE || "").toLowerCase() === "true";

// `indexes: null` makes axios serialise array params as repeated keys
// (?dates=A&dates=B) which is what FastAPI's list[str] = Query() expects.
const liveApi = axios.create({
  baseURL: "/api",
  paramsSerializer: { indexes: null },
});

// In static mode every function is delegated to the in-memory shim.
// In live mode we keep the existing HTTP behaviour.
function wire(name, liveFn) {
  return STATIC_MODE ? staticApi[name] : liveFn;
}

export const fetchShows = wire("fetchShows", (params = {}) =>
  liveApi.get("/shows", { params }).then((r) => r.data)
);

export const fetchShow = wire("fetchShow", (slug) =>
  liveApi.get(`/shows/${slug}`).then((r) => r.data)
);

export const fetchGenres = wire("fetchGenres", () =>
  liveApi.get("/genres").then((r) => r.data)
);

export const fetchVenues = wire("fetchVenues", () =>
  liveApi.get("/venues").then((r) => r.data)
);

export const fetchDates = wire("fetchDates", () =>
  liveApi.get("/dates").then((r) => r.data)
);

export const fetchStats = wire("fetchStats", () =>
  liveApi.get("/stats").then((r) => r.data)
);

export const fetchReviews = wire("fetchReviews", (params = {}) =>
  liveApi.get("/reviews", { params }).then((r) => r.data)
);

export const triggerRefresh = wire("triggerRefresh", (force = false) =>
  liveApi.post("/refresh", null, { params: { force } }).then((r) => r.data)
);

export const getRefreshStatus = wire("getRefreshStatus", () =>
  liveApi.get("/refresh/status").then((r) => r.data)
);

export const triggerReviewRefresh = wire("triggerReviewRefresh", (force = false) =>
  liveApi
    .post("/refresh/reviews", null, { params: { force } })
    .then((r) => r.data)
);

export const getReviewRefreshStatus = wire("getReviewRefreshStatus", () =>
  liveApi.get("/refresh/reviews/status").then((r) => r.data)
);

export const triggerGeocode = wire("triggerGeocode", (force = false) =>
  liveApi
    .post("/refresh/geocode", null, { params: { force } })
    .then((r) => r.data)
);

export const getGeocodeStatus = wire("getGeocodeStatus", () =>
  liveApi.get("/refresh/geocode/status").then((r) => r.data)
);

export const geocodeVenue = wire("geocodeVenue", (slug) =>
  liveApi.post(`/venues/${slug}/geocode`).then((r) => r.data)
);
