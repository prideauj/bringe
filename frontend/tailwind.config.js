/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        fringe: {
          pink:   "#E91E8C",
          purple: "#7B2D8B",
          teal:   "#00A99D",
          orange: "#F7941D",
          dark:   "#1A1A2E",
        },
      },
    },
  },
  plugins: [],
};
