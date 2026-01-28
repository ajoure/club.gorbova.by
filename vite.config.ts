import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Force a fresh dependency prebundle if the previous Vite deps chunk got corrupted
  // (fixes rare "Unexpected end of script" from /node_modules/.vite/deps/chunk-*.js)
  cacheDir: ".vite-cache",
  server: {
    host: "::",
    port: 8080,
    // Avoid caching partially downloaded chunks
    headers: {
      "Cache-Control": "no-store",
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
