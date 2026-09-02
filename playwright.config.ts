import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/visual",
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]] : "line",
  use: { baseURL: "http://127.0.0.1:3000", locale: "en-SG", timezoneId: "Asia/Singapore", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: { command: "pnpm dev", url: "http://127.0.0.1:3000", reuseExistingServer: !process.env.CI, timeout: 120_000 },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "chromium-mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "webkit-smoke", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } } },
    { name: "firefox-smoke", use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } } },
  ],
});
