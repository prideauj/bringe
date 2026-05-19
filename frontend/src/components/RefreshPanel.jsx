import { useEffect, useState } from "react";
import { RefreshCw, Star, MapPin, CheckCircle, AlertCircle } from "lucide-react";
import {
  triggerRefresh,
  triggerReviewRefresh,
  triggerGeocode,
  getRefreshStatus,
  getGeocodeStatus,
  getReviewRefreshStatus,
} from "../lib/api";

export default function RefreshPanel({ onRefreshDone }) {
  const [status, setStatus] = useState(null);
  const [geoStatus, setGeoStatus] = useState(null);
  const [revStatus, setRevStatus] = useState(null);
  const [polling, setPolling] = useState(false);
  const [geoPolling, setGeoPolling] = useState(false);
  const [revPolling, setRevPolling] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    getRefreshStatus().then(setStatus).catch(() => {});
    getGeocodeStatus().then(setGeoStatus).catch(() => {});
    getReviewRefreshStatus().then(setRevStatus).catch(() => {});
  }, []);

  // Poll scrape status
  useEffect(() => {
    if (!polling) return;
    const id = setInterval(async () => {
      try {
        const s = await getRefreshStatus();
        setStatus(s);
        if (!s.running) {
          setPolling(false);
          onRefreshDone?.();
        }
      } catch {}
    }, 2000);
    return () => clearInterval(id);
  }, [polling, onRefreshDone]);

  // Poll geocode status
  useEffect(() => {
    if (!geoPolling) return;
    const id = setInterval(async () => {
      try {
        const s = await getGeocodeStatus();
        setGeoStatus(s);
        if (!s.running) {
          setGeoPolling(false);
          onRefreshDone?.();
        }
      } catch {}
    }, 2000);
    return () => clearInterval(id);
  }, [geoPolling, onRefreshDone]);

  // Poll review-fetch status
  useEffect(() => {
    if (!revPolling) return;
    const id = setInterval(async () => {
      try {
        const s = await getReviewRefreshStatus();
        setRevStatus(s);
        if (!s.running) {
          setRevPolling(false);
          onRefreshDone?.();
        }
      } catch {}
    }, 2000);
    return () => clearInterval(id);
  }, [revPolling, onRefreshDone]);

  async function startRefresh(force = false) {
    try {
      const r = await triggerRefresh(force);
      setMsg(r.status === "already_running" ? "Already running." : "Scrape started.");
      setPolling(true);
      const s = await getRefreshStatus();
      setStatus(s);
    } catch {
      setMsg("Error starting refresh.");
    }
  }

  async function startReviews(force = false) {
    try {
      const r = await triggerReviewRefresh(force);
      setMsg(
        r.status === "already_running"
          ? "Review fetch already running."
          : force
          ? "Re-fetching reviews for all shows."
          : "Fetching reviews (skipping shows that already have reviews)."
      );
      setRevPolling(true);
      const s = await getReviewRefreshStatus();
      setRevStatus(s);
    } catch {
      setMsg("Error starting review fetch.");
    }
  }

  async function startGeocode(force = false) {
    try {
      const r = await triggerGeocode(force);
      setMsg(
        r.status === "already_running"
          ? "Geocoding already running."
          : "Geocoding started (1 venue/sec to respect Nominatim policy)."
      );
      setGeoPolling(true);
      const s = await getGeocodeStatus();
      setGeoStatus(s);
    } catch {
      setMsg("Error starting geocode.");
    }
  }

  const pct = status?.total ? Math.round((status.done / status.total) * 100) : 0;
  const geoPct = geoStatus?.total
    ? Math.round((geoStatus.done / geoStatus.total) * 100)
    : 0;
  const revPct = revStatus?.total
    ? Math.round((revStatus.done / revStatus.total) * 100)
    : 0;

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-300">Data Refresh</h3>

      {/* Scrape progress */}
      {status?.running && (
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Scraping shows…</span>
            <span>{status.done} / {status.total}</span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-fringe-pink rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {status?.last_stats && !status.running && (
        <div className="text-xs text-gray-400 flex items-center gap-1">
          <CheckCircle size={12} className="text-green-400" />
          Last scrape: {status.last_stats.scraped} scraped,{" "}
          {status.last_stats.skipped} skipped, {status.last_stats.errors} errors
        </div>
      )}

      {/* Review fetch progress */}
      {revStatus?.running && (
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Fetching reviews…</span>
            <span>{revStatus.done} / {revStatus.total}</span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-fringe-purple rounded-full transition-all duration-500"
              style={{ width: `${revPct}%` }}
            />
          </div>
        </div>
      )}

      {revStatus?.last_stats && !revStatus.running && (
        <div className="text-xs text-gray-400 flex items-center gap-1">
          <CheckCircle size={12} className="text-green-400" />
          Last review fetch: {revStatus.last_stats.checked} checked,{" "}
          {revStatus.last_stats.with_reviews} with reviews,{" "}
          {revStatus.last_stats.skipped} skipped,{" "}
          {revStatus.last_stats.errors} errors
        </div>
      )}

      {/* Geocode progress */}
      {geoStatus?.running && (
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Geocoding venues…</span>
            <span>{geoStatus.done} / {geoStatus.total}</span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-fringe-teal rounded-full transition-all duration-500"
              style={{ width: `${geoPct}%` }}
            />
          </div>
        </div>
      )}

      {geoStatus?.last_stats && !geoStatus.running && (
        <div className="text-xs text-gray-400 flex items-center gap-1">
          <CheckCircle size={12} className="text-green-400" />
          Last geocode: {geoStatus.last_stats.geocoded} geocoded,{" "}
          {geoStatus.last_stats.errors} errors
        </div>
      )}

      {msg && (
        <p className="text-xs text-fringe-pink flex items-center gap-1">
          <AlertCircle size={12} /> {msg}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => startRefresh(false)}
          disabled={status?.running}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fringe-pink text-white text-xs font-semibold
                     hover:bg-pink-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw size={13} className={status?.running ? "animate-spin" : ""} />
          Refresh new shows
        </button>
        <button
          onClick={() => startRefresh(true)}
          disabled={status?.running}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 text-white text-xs font-semibold
                     hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Force re-scrape all
        </button>
        <button
          onClick={() => startReviews(false)}
          disabled={revStatus?.running}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fringe-purple text-white text-xs font-semibold
                     hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Star size={13} className={revStatus?.running ? "animate-spin" : ""} />
          Fetch reviews
        </button>
        <button
          onClick={() => startReviews(true)}
          disabled={revStatus?.running}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 text-white text-xs font-semibold
                     hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Re-fetch all reviews
        </button>
        <button
          onClick={() => startGeocode(false)}
          disabled={geoStatus?.running}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fringe-teal text-white text-xs font-semibold
                     hover:bg-teal-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <MapPin size={13} className={geoStatus?.running ? "animate-spin" : ""} />
          Geocode venues
        </button>
      </div>
      <p className="text-xs text-gray-600">
        "Refresh" adds new shows only. "Fetch reviews" skips shows that
        already have reviews — use "Re-fetch all reviews" to refresh every
        show. Geocoding skips venues that already have coords.
      </p>
    </div>
  );
}
