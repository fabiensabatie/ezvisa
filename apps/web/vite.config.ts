import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

const api = "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Read workspace packages from their TypeScript source.
    conditions: ["@ezvisa/source", ...defaultClientConditions],
  },
  server: {
    port: 5173,
    proxy: {
      "/trpc": api,
      "/auth": api,
      "/mcp": api,
      "/health": api,
    },
  },
});
