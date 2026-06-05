import { expect, type Page } from "@playwright/test";

export const creatorWallet = "28FQ5wVeihjGnZw93RctyAtUdtBdd6vGXWUkke49mEAw";
export const recipientWallet = "3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3";
export const secondWallet = "11111111111111111111111111111111";
export const nativeSolMint = "11111111111111111111111111111111";

export function buildMockCampaignDetail(
  treeAddress: string,
  overrides: Record<string, unknown> = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return {
    treeAddress,
    creator: creatorWallet,
    mint: nativeSolMint,
    campaignId: 999_999,
    merkleRoot: "a".repeat(64),
    leafCount: 1,
    totalSupply: "1000000000",
    totalClaimed: "0",
    cancellable: true,
    cancelAuthority: creatorWallet,
    pauseAuthority: creatorWallet,
    paused: false,
    cancelledAt: null,
    minCliffTime: null,
    instantRefunded: false,
    instantRefundEligible: false,
    createdAt: now - 86400 * 7,
    metadata: null,
    hasMilestoneLeaves: false,
    gracePeriod: null,
    analytics: { uniqueClaimers: 0, claimCount: 0, percentClaimed: 0, rootVersionCount: 1 },
    rootVersions: [{ id: 1, version: 1, merkleRoot: "a".repeat(64), leafCount: 1, createdAt: now, ipfsCid: null }],
    recipients: [{ beneficiary: creatorWallet, allocation: "1000000000", leafCount: 1, claimedAmount: "0" }],
    ...overrides,
  };
}

/** Mock /api/campaigns/:treeAddress and its sub-routes for E2E tests. */
export async function mockCampaignApi(
  page: Page,
  treeAddress: string,
  overrides: Record<string, unknown> = {},
) {
  const detail = buildMockCampaignDetail(treeAddress, overrides);
  await page.route(`/api/campaigns/${treeAddress}`, async (route) => {
    await route.fulfill({ json: detail, status: 200 });
  });
  await page.route(`/api/campaigns/${treeAddress}/timeline*`, async (route) => {
    await route.fulfill({ json: { events: [] }, status: 200 });
  });
  await page.route(`/api/campaigns/${treeAddress}/status*`, async (route) => {
    await route.fulfill({ json: { funded: true, remaining: "0" }, status: 200 });
  });
}

export async function enableE2eWallet(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("velthoryn:e2e-wallet", "1");
  });
}

export async function gotoWithRetry(page: Page, path: string, maxRetries = 3) {
  let lastError: Error | undefined;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await page.goto(path, { timeout: 30_000, waitUntil: "load" });
      if (response?.ok()) return response;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (i < maxRetries - 1) {
        await page.waitForTimeout(1000 * (i + 1));
      }
    }
  }
  throw lastError ?? new Error(`Failed to navigate to ${path}`);
}

export async function selectSolToken(page: Page) {
  const btn = page.getByRole("button", { name: /select token/i });
  await btn.waitFor({ state: "visible", timeout: 15_000 });
  await btn.click();
  await page.getByRole("button", { name: /SOL.*Native/i }).first().click();
  await expect(page.getByRole("button", { name: /SOL.*Native/i })).toBeVisible();
}

export async function openCsvMode(page: Page, label = /use csv|csv campaign/i) {
  await page.getByRole("button", { name: label }).click();
  await expect(page.getByRole("button", { name: /parse & validate/i })).toBeVisible();
}

export async function parseCsv(page: Page, csv: string) {
  await page.locator("textarea").fill(csv);
  await page.getByRole("button", { name: /parse & validate/i }).click();
}

export function csv(rows: string[]) {
  return [
    "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
    ...rows,
  ].join("\n");
}
