import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// In development the browser talks only to the Vite server (http://localhost:5173); requests to
// /api are proxied to the main backend. The browser therefore sees a single origin, so the
// backend's httpOnly cookies are first-party. The Origin header is kept unchanged so the
// backend's CORS allow-list still applies.
//
// API_PROXY_TARGET (optional, frontend/.env or environment) changes where /api is proxied;
// the default is the backend's default address.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: env["API_PROXY_TARGET"] || "http://localhost:3000",
          changeOrigin: false,
        },
      },
    },
  };
});
