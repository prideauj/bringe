export default function StarRating({ rating, count }) {
  if (!rating) return null;
  const full = Math.floor(rating);
  const half = rating - full >= 0.4;

  return (
    <span className="flex items-center gap-1 text-amber-400 text-sm">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= full ? "opacity-100" : i === full + 1 && half ? "opacity-60" : "opacity-20"}>
          ★
        </span>
      ))}
      <span className="text-gray-400 text-xs ml-0.5">
        {rating.toFixed(1)}
        {count !== undefined && ` (${count})`}
      </span>
    </span>
  );
}
