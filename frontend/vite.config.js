import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The launch pad's src/ is a junction to <repo>/frontend/src on GDrive.
// Without preserveSymlinks, Node's fs.realpath() resolves files reached
// through the junction to their GDrive path, and Vite then walks up from
// there looking for node_modules -- which only exists at the launch pad.
// Setting preserveSymlinks: true keeps the junction path verbatim, so
// the walk-up finds the local node_modules right next to src/.
export default defineConfig({
  plugins: [react()],
  resolve: {
    preserveSymlinks: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
