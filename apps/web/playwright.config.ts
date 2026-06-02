import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const webServer = process.env.PLAYWRIGHT_BASE_URL
  ? undefined
  : {
      command: "NEXT_PUBLIC_E2E_MOCK_WALLET=true pnpm exec next dev -H 127.0.0.1 -p 3100",
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    };

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
