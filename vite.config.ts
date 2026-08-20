/// <reference types="vitest" />
import path from "path";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: path.resolve(import.meta.dirname, "src/index.ts"),
      formats: ["es", "cjs"],
      fileName: format => (format === "es" ? "index.js" : "index.cjs"),
    },
    sourcemap: true,
  },
  test: {
    watch: false,
    coverage: {
      include: ["src/**/*.ts"],
    },
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["test/**/*.spec.ts"],
        },
      },
      {
        test: {
          name: "browser",
          include: ["test/**/*.spec.ts"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
            screenshotFailures: false,
          },
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
