// Encode/decode the current My-Picks state in a URL the user can share.
//   ?picks=slug-a,slug-b,slug-c&dates=2026-05-22,2026-05-23&view=picks
//
// Read-once on app mount: we adopt the picks into the user's local
// favourites (returning how many were new), then strip the params from
// the URL so refreshes don't re-add. The user gets a single toast
// "Added N shows to your picks".

export function buildSharePlanUrl({ picks, dates, view }) {
  const url = new URL(window.location.href);
  // Always start from the bare host -- we don't want to inherit other
  // params from whatever page the sharer was on.
  url.search = "";
  if (picks && picks.length) url.searchParams.set("picks", picks.join(","));
  if (dates && dates.length) url.searchParams.set("dates", dates.join(","));
  if (view) url.searchParams.set("view", view);
  return url.toString();
}

// Parses params from window.location.search. Doesn't mutate anything.
export function readSharePlan() {
  const params = new URLSearchParams(window.location.search);
  const picks = (params.get("picks") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const dates = (params.get("dates") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  const view = params.get("view") || "";
  return { picks, dates, view };
}

// Strip the share-plan params from the URL bar without reloading the
// page, so a refresh after adopting them doesn't re-apply.
export function clearSharePlanParams() {
  const url = new URL(window.location.href);
  for (const k of ["picks", "dates", "view"]) url.searchParams.delete(k);
  window.history.replaceState({}, "", url.pathname + (url.search || ""));
}
