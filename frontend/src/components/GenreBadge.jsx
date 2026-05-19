const GENRE_COLORS = {
  comedy:    "bg-amber-500/20 text-amber-300 border-amber-500/30",
  theatre:   "bg-purple-500/20 text-purple-300 border-purple-500/30",
  music:     "bg-pink-500/20 text-pink-300 border-pink-500/30",
  circus:    "bg-orange-500/20 text-orange-300 border-orange-500/30",
  dance:     "bg-teal-500/20 text-teal-300 border-teal-500/30",
  children:  "bg-green-500/20 text-green-300 border-green-500/30",
  family:    "bg-green-500/20 text-green-300 border-green-500/30",
  cabaret:   "bg-rose-500/20 text-rose-300 border-rose-500/30",
  spoken:    "bg-blue-500/20 text-blue-300 border-blue-500/30",
  visual:    "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
};

function colorFor(genre) {
  if (!genre) return "bg-gray-500/20 text-gray-300 border-gray-500/30";
  const key = genre.toLowerCase().split(/[\s&]/)[0];
  return GENRE_COLORS[key] || "bg-gray-500/20 text-gray-300 border-gray-500/30";
}

export default function GenreBadge({ genre, small }) {
  if (!genre) return null;
  return (
    <span
      className={`inline-block border rounded-full px-2 py-0.5 font-medium ${
        small ? "text-xs" : "text-xs"
      } ${colorFor(genre)}`}
    >
      {genre}
    </span>
  );
}
