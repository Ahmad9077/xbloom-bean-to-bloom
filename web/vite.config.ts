import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// GitHub Pages base path: set VITE_BASE_PATH=/repo-name/ at build time.
// Defaults to "/" for local dev.
export default defineConfig({
  base: process.env["VITE_BASE_PATH"] ?? "/",
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
