import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import config from "../../../playwright.config";

// Native config loading keeps Vite from writing through the shared node_modules symlink.
export default defineConfig({
  ...config,
  testDir: resolve("tests/browser"),
  outputDir: resolve("test-results"),
  webServer: {
    ...config.webServer,
    cwd: process.cwd(),
    command: "npm run preview -- --port 4180 --strictPort --configLoader native",
  },
});
