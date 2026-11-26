import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/health": "http://localhost:8787",
      "/languages": "http://localhost:8787",
      "/profiles": "http://localhost:8787",
      "/materials": "http://localhost:8787",
      "/storage": "http://localhost:8787",
      "/api": "http://localhost:8787",
    },
  },
});
