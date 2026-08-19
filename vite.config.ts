/// <reference types="vitest" />
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      formats: ["es", "cjs"],
      fileName: format => (format === "es" ? "index.js" : "index.cjs"),
    },
    sourcemap: true,
  },
  test: {
    environment: "node",
    watch: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
