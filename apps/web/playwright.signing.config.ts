import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for real signing E2E tests.
 * 
 * These tests require:
 *   1. solana-test-validator running with the vesting program
 *   2. Dev server on port 3200 with NEXT_PUBLIC_RPC_ENDPOINT=http://127.0.0.1:8899
 * 
 * Run:
 *   pnpm exec playwright test --config playwright.signing.config.ts
 */

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3200";

export default defineConfig({
  testDir: "./tests/e2e/signing",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
