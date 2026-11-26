import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

// API paths share prefixes with page routes (/profiles/…, /team/flows), so page navigations
// (Accept: text/html) stay with Vite and only API calls go to the Worker.
const api: ProxyOptions = {
  target: "http://localhost:8787",
  bypass: (req) => (req.headers.accept?.includes("text/html") ? req.url : undefined),
};

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(
      [
        "/health",
        "/api",
        "/languages",
        "/profiles",
        "/materials",
        "/storage",
        "/team",
        "/topics",
        "/sources",
      ].map((p) => [p, api]),
    ),
  },
});
