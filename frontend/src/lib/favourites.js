// localStorage-backed Set of show slugs. Single source of truth used by
// every star button and by the My Picks tab.

import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "bringe:favourites";

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((s) => typeof s === "string");
  } catch {}
  return [];
}

function persist(arr) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {}
}

export function useFavourites() {
  // Array form for serialisation; Set derived for O(1) membership checks.
  const [list, setList] = useState(loadInitial);

  // Cross-tab sync: if the user has Bringe open in two tabs, starring in
  // one should reflect in the other after a focus/visibility change.
  useEffect(() => {
    function onStorage(e) {
      if (e.key === STORAGE_KEY) setList(loadInitial());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const has = useCallback((slug) => list.includes(slug), [list]);

  const toggle = useCallback((slug) => {
    setList((prev) => {
      const next = prev.includes(slug)
        ? prev.filter((s) => s !== slug)
        : [...prev, slug];
      persist(next);
      return next;
    });
  }, []);

  const addMany = useCallback((slugs) => {
    if (!slugs || !slugs.length) return 0;
    let addedCount = 0;
    setList((prev) => {
      const set = new Set(prev);
      const before = set.size;
      for (const s of slugs) set.add(s);
      addedCount = set.size - before;
      const next = [...set];
      persist(next);
      return next;
    });
    return addedCount;
  }, []);

  const clear = useCallback(() => {
    setList([]);
    persist([]);
  }, []);

  return { favourites: list, has, toggle, addMany, clear };
}
