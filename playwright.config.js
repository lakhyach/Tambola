import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-tests",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  outputDir: "./artifacts/browser-qa",
  use: {
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "node scripts/browser-qa-server.mjs",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
