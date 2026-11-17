import { defineConfig, devices } from "@playwright/test";
const nativeClock = /immersive highlights follow the real media clock without timeupdate$/;
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
    { name: "chromium", grepInvert: nativeClock, use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    // The native-clock measurement must not compete with other browser workloads.
    { name: "chromium-native-clock", testMatch: "speaker-review.spec.ts", grep: nativeClock,
      dependencies: ["chromium", "webkit"], use: { ...devices["Desktop Chrome"] } },
  ],
});
