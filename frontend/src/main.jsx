import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

// StrictMode is intentionally OMITTED here. react-leaflet@4's marker
// cleanup is not idempotent against the double mount→unmount→mount cycle
// that StrictMode runs in dev — it crashes in Marker._removeIcon when the
// icon has already been torn down. StrictMode is a dev-only check, so
// dropping it only affects the dev server and not production builds.
ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
