import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/catalogue",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 8000 },
  reporter: "list",
  outputDir: "./test-results/catalogue",
  use: {
    baseURL: "http://127.0.0.1:4183/",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js preview --config vite.catalogue.config.ts --host 127.0.0.1 --port 4183 --strictPort",
    url: "http://127.0.0.1:4183/",
    reuseExistingServer: false,
    timeout: 30000,
  },
  projects: [
    { name: "chromium-catalogue", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit-catalogue", grepInvert: /captures/, use: { ...devices["Desktop Safari"] } },
  ],
});
