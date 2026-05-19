import { format, parseISO } from "date-fns";
import { MapPin, Clock, Ticket, Users, ExternalLink } from "lucide-react";
import GenreBadge from "./GenreBadge";
import StarRating from "./StarRating";

function formatDate(dateStr, timeStr) {
  if (!dateStr) return null;
  try {
    const d = parseISO(dateStr);
    const dayPart = format(d, "EEE d MMM");
    return timeStr ? `${dayPart} · ${timeStr}` : dayPart;
  } catch {
    return dateStr;
  }
}

// Pill label for a single performance in the times row. Single-day mode
// shows just the time; multi-day mode prefixes the weekday so the user
// can tell which day each slot is on.
function timePillLabel(item, multiDay) {
  if (!multiDay) return item.time;
  try {
    return `${format(parseISO(item.date), "EEE")} ${item.time}`;
  } catch {
    return item.time;
  }
}

export default function ShowCard({ show, onClick }) {
  // When the user has selected one or more dates, the backend populates
  // `times` with every {date, time} for those days; we render those
  // instead of the single "next date · time" line.
  const hasDayTimes = Array.isArray(show.times) && show.times.length > 0;
  const distinctDays = hasDayTimes
    ? new Set(show.times.map((t) => t.date)).size
    : 0;
  const multiDay = distinctDays > 1;
  const nextDate = !hasDayTimes ? formatDate(show.next_date, show.next_time) : null;

  const price =
    show.min_price === 0
      ? "Free"
      : show.min_price
      ? `From £${show.min_price}`
      : null;

  // Stop the card's onClick from firing when the user clicks the review
  // link, so the modal doesn't open over the review they wanted to read.
  const stopProp = (e) => e.stopPropagation();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(show.slug)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick(show.slug)}
      className="group text-left bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden
                 hover:border-fringe-pink/50 hover:shadow-lg hover:shadow-fringe-pink/10
                 transition-all duration-200 flex flex-col cursor-pointer focus:outline-none focus:ring-2 focus:ring-fringe-pink/50"
    >
      {/* Image */}
      <div className="relative aspect-[16/9] bg-gray-800 overflow-hidden flex-shrink-0">
        {show.image_url ? (
          <img
            src={show.image_url}
            alt={show.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl opacity-20">
            🎭
          </div>
        )}
        <div className="absolute top-2 left-2">
          <GenreBadge genre={show.genre} />
        </div>
        {show.min_price === 0 && (
          <div className="absolute top-2 right-2 bg-green-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
            FREE
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col gap-2 flex-1">
        <h3 className="font-bold text-white text-sm leading-snug line-clamp-2 group-hover:text-fringe-pink transition-colors">
          {show.title}
        </h3>

        {show.company && (
          <p className="text-gray-400 text-xs flex items-center gap-1">
            <Users size={11} />
            {show.company}
          </p>
        )}

        {/* Body summary -- word-boundary-trimmed extract of the full
            description. Falls back to nothing if the scraper couldn't
            find a description for this show. Line-clamped to 6 lines
            so card heights stay reasonable; the full text is in the
            modal. */}
        {show.summary && (
          <p className="text-gray-300 text-xs leading-snug line-clamp-6">
            {show.summary}
          </p>
        )}

        {/* Times for the selected day(s) */}
        {hasDayTimes && (
          <div className="flex flex-wrap gap-1">
            {show.times.map((t) => (
              <span
                key={`${t.date}-${t.time}`}
                className="px-1.5 py-0.5 rounded bg-fringe-pink/15 border border-fringe-pink/40 text-fringe-pink text-[11px] font-semibold tabular-nums"
              >
                {timePillLabel(t, multiDay)}
              </span>
            ))}
          </div>
        )}

        <div className="mt-auto pt-2 flex flex-col gap-1.5 border-t border-gray-800">
          {show.venue_name && (
            <p className="text-gray-400 text-xs flex items-center gap-1 truncate">
              <MapPin size={11} className="flex-shrink-0" />
              {show.venue_name}
            </p>
          )}

          {nextDate && (
            <p className="text-gray-300 text-xs flex items-center gap-1">
              <Clock size={11} className="flex-shrink-0" />
              {nextDate}
            </p>
          )}

          <div className="flex items-center justify-between mt-1 gap-2">
            {price && (
              <span className="flex items-center gap-1 text-fringe-pink font-semibold text-xs">
                <Ticket size={11} />
                {price}
              </span>
            )}

            {show.top_review_url ? (
              <a
                href={show.top_review_url}
                target="_blank"
                rel="noreferrer"
                onClick={stopProp}
                title={`Read review on ${show.top_review_source || "external site"}`}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-fringe-pink transition-colors"
              >
                {show.top_review_rating ? (
                  <StarRating
                    rating={show.top_review_rating}
                    count={show.review_count}
                  />
                ) : (
                  <span className="underline">Review</span>
                )}
                <ExternalLink size={10} className="flex-shrink-0" />
              </a>
            ) : (
              show.avg_rating && (
                <StarRating rating={show.avg_rating} count={show.review_count} />
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
