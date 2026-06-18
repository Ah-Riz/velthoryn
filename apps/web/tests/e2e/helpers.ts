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

/** Mock wallet sendTransaction for cancel/withdraw E2E without a validator. */
export async function enableMockOnChainTransactions(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("velthoryn:e2e-mock-send-tx", "1");
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
  await expect(page.getByRole("button", { name: /validate csv/i })).toBeVisible();
}

export async function parseCsv(page: Page, csv: string) {
  await page.locator("textarea").fill(csv);
  await page.getByRole("button", { name: /validate csv/i }).click();
}

export function csv(rows: string[]) {
  return [
    "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
    ...rows,
  ].join("\n");
}

export async function injectStreamSchedule(
  page: Page,
  treeAddress: string,
  schedule: {
    releaseType: number;
    startTime: number;
    cliffTime: number;
    endTime: number;
    milestoneIdx?: number;
    beneficiary?: string;
    amount?: string;
  },
) {
  await page.addInitScript((data: { key: string; value: string }) => {
    window.localStorage.setItem(data.key, data.value);
  }, {
    key: `velthoryn:stream:${treeAddress}`,
    value: JSON.stringify({ schedule: { milestoneIdx: 0, ...schedule } }),
  });
}

function routePathname(url: string | URL): string {
  return typeof url === "string" ? new URL(url).pathname : url.pathname;
}

/** Mock sender + recipient campaign list APIs for /campaigns page E2E. */
export async function mockCampaignListApis(
  page: Page,
  options: {
    senderCampaigns?: Array<Record<string, unknown>>;
    recipientCampaigns?: Array<Record<string, unknown>>;
    walletAddress?: string;
  } = {},
) {
  const wallet = options.walletAddress ?? creatorWallet;
  const senderCampaigns = options.senderCampaigns ?? [];
  const recipientCampaigns = options.recipientCampaigns ?? [];

  await page.route("**/api/campaigns**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/campaigns") {
      await route.continue();
      return;
    }

    const creator = url.searchParams.get("creator");
    if (creator && creator !== wallet) {
      await route.fulfill({
        json: { campaigns: [], total: 0, page: 1, limit: 100 },
        status: 200,
      });
      return;
    }
    await route.fulfill({
      json: {
        campaigns: senderCampaigns,
        total: senderCampaigns.length,
        page: 1,
        limit: 100,
      },
      status: 200,
    });
  });

  await page.route(
    (url) => routePathname(url) === `/api/beneficiary/${wallet}/campaigns`,
    async (route) => {
      await route.fulfill({
        json: { campaigns: recipientCampaigns },
        status: 200,
      });
    },
  );
}

/** Wait until mocked campaign list APIs have been fetched for the E2E wallet. */
export async function waitForCampaignListMocks(page: Page, walletAddress = creatorWallet) {
  await Promise.all([
    page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/campaigns") &&
        resp.url().includes(`creator=${walletAddress}`) &&
        resp.ok(),
      { timeout: 20_000 },
    ),
    page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/beneficiary/${walletAddress}/campaigns`) && resp.ok(),
      { timeout: 20_000 },
    ),
  ]);
}

/**
 * Stub Solana JSON-RPC getAccountInfo to return null immediately.
 * E2E campaign/allocations pages try on-chain fetch first; without this,
 * CI can hang on slow public devnet until Playwright timeouts fire.
 */
export async function mockSolanaRpcGetAccountInfoNull(page: Page) {
  await page.route("**", async (route) => {
    const req = route.request();
    if (req.method() !== "POST") {
      await route.continue();
      return;
    }
    let body: { id?: number | string; method?: string } | null = null;
    try {
      body = req.postDataJSON();
    } catch {
      await route.continue();
      return;
    }
    if (body?.method !== "getAccountInfo") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        jsonrpc: "2.0",
        id: body?.id ?? 1,
        result: { context: { slot: 1 }, value: null },
      },
    });
  });
}

export async function mockProofApi(
  page: Page,
  treeAddress: string,
  leaves: Array<{
    leafIndex: number;
    beneficiary: string;
    amount: number;
    releaseType: number;
    startTime: number;
    cliffTime: number;
    endTime: number;
    milestoneIdx: number;
  }>,
) {
  await page.route(`/api/campaigns/${treeAddress}/proof*`, async (route) => {
    await route.fulfill({
      json: {
        leaves: leaves.map((leaf) => ({
          leaf,
          proof: [Array.from({ length: 32 }, () => 0)],
        })),
      },
      status: 200,
    });
  });
}
