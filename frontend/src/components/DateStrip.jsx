import { useEffect, useRef } from "react";
import { Calendar } from "lucide-react";
import { format, parseISO, isToday } from "date-fns";

// Renders a horizontal strip of date buttons. Clicking toggles a date in/out
// of the selection set. Shift-click selects an inclusive range from the
// last-clicked anchor — useful for picking a weekend.
//
// Props:
//   dates       - string[] of ISO dates with at least one performance
//   selected    - string[] of currently-selected ISO dates ([] = "All")
//   onChange    - fn(string[])  caller receives the new selection list
export default function DateStrip({ dates, selected, onChange }) {
  const selectedRef = useRef(null);
  const lastAnchor = useRef(null);
  const selectedSet = new Set(selected);

  // Bring the most recent selection into view when it changes.
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [selected.join("|")]); // run when set membership changes

  function handleClick(e, d) {
    if (e.shiftKey && lastAnchor.current && lastAnchor.current !== d) {
      // Range selection: every date between anchor and d (inclusive) gets
      // added to the existing selection.
      const a = dates.indexOf(lastAnchor.current);
      const b = dates.indexOf(d);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = dates.slice(lo, hi + 1);
        const next = new Set([...selected, ...range]);
        onChange([...next].sort());
        return;
      }
    }
    // Plain click: toggle this date.
    const next = new Set(selected);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    onChange([...next].sort());
    lastAnchor.current = d;
  }

  return (
    <div className="bg-gray-900 border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-2">
        {/* All-upcoming pill clears the selection */}
        <button
          onClick={() => {
            onChange([]);
            lastAnchor.current = null;
          }}
          className={`flex-shrink-0 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors
            ${
              selected.length === 0
                ? "border-fringe-pink bg-fringe-pink/10 text-fringe-pink"
                : "border-gray-700 text-gray-400 hover:border-gray-500"
            }`}
        >
          All
        </button>

        {/* Horizontal scrolling date list */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide flex-1">
          {dates.map((d) => {
            const isSelected = selectedSet.has(d);
            let weekday = d;
            let day = "";
            let month = "";
            let today = false;
            try {
              const parsed = parseISO(d);
              weekday = format(parsed, "EEE");
              day = format(parsed, "d");
              month = format(parsed, "MMM");
              today = isToday(parsed);
            } catch {}

            return (
              <button
                key={d}
                ref={isSelected ? selectedRef : null}
                onClick={(e) => handleClick(e, d)}
                title="Click to toggle · Shift-click to select range"
                className={`flex-shrink-0 flex flex-col items-center justify-center min-w-[3.5rem] px-2 py-1.5 rounded-lg border transition-colors
                  ${
                    isSelected
                      ? "border-fringe-pink bg-fringe-pink text-white"
                      : today
                      ? "border-fringe-teal text-fringe-teal hover:bg-fringe-teal/10"
                      : "border-gray-700 text-gray-300 hover:border-gray-500"
                  }`}
              >
                <span className="text-[10px] uppercase tracking-wider opacity-80">
                  {weekday}
                </span>
                <span className="text-base font-bold leading-tight">{day}</span>
                <span className="text-[10px] uppercase opacity-80">{month}</span>
              </button>
            );
          })}
        </div>

        {/* Native date picker: jump to a date by adding it to the selection */}
        <label
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-700 text-gray-400 hover:border-gray-500 cursor-pointer text-xs"
          title="Pick a date"
        >
          <Calendar size={14} />
          <input
            type="date"
            value=""
            min={dates[0] || undefined}
            max={dates[dates.length - 1] || undefined}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const next = new Set(selected);
              next.add(v);
              onChange([...next].sort());
              lastAnchor.current = v;
            }}
            className="bg-transparent border-none outline-none text-xs text-gray-300 w-0 sm:w-28"
          />
        </label>
      </div>

      {/* Selection summary line (shown when something is selected) */}
      {selected.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 pb-2 text-[11px] text-gray-500">
          {selected.length === 1
            ? "Showing 1 day"
            : `Showing ${selected.length} days`}
          {" · "}
          <button
            onClick={() => {
              onChange([]);
              lastAnchor.current = null;
            }}
            className="underline hover:text-fringe-pink"
          >
            clear
          </button>
        </div>
      )}
    </div>
  );
}
