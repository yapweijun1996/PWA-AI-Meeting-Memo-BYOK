import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 2,
  timeout: 45000,
  expect: { timeout: 8000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4180/PWA-AI-Meeting-Memo-BYOK/",
    trace: "retain-on-failure",
    acceptDownloads: true,
  },
  webServer: {
    command: "npm run preview -- --port 4180 --strictPort",
    url: "http://127.0.0.1:4180/PWA-AI-Meeting-Memo-BYOK/",
    reuseExistingServer: false,
    timeout: 30000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
