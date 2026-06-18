/**
 * E2E coverage for /campaign/[id]/allocations — Allocation Editor page.
 *
 * The page loads on-chain tree state and falls back to indexed API data when
 * the on-chain account doesn't exist (E2E mock scenario).
 *
 * Uses page.route() to mock /api/campaigns/:treeAddress and the proof API so
 * the editor renders with real-looking data without a live validator.
 */
import { expect, test } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import {
  enableE2eWallet,
  gotoWithRetry,
  mockCampaignApi,
  mockProofApi,
  mockSolanaRpcGetAccountInfoNull,
  creatorWallet,
  recipientWallet,
} from "./helpers";

const ADDR = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

test.beforeEach(async ({ page }) => {
  await mockSolanaRpcGetAccountInfoNull(page);
});
const now = () => Math.floor(Date.now() / 1000);
const pastCliff = () => now() - 86400 * 7;

async function setupAuthorizedEditor(page: Parameters<typeof mockCampaignApi>[0]) {
  await enableE2eWallet(page);
  await mockProofApi(page, ADDR, [{
    leafIndex: 0,
    beneficiary: creatorWallet,
    amount: 1000000000,
    releaseType: 0,
    startTime: 0,
    cliffTime: pastCliff(),
    endTime: pastCliff(),
    milestoneIdx: 0,
  }]);
  await mockCampaignApi(page, ADDR, {
    leafCount: 3,
    cancellable: true,
    cancelledAt: null,
    cancelAuthority: creatorWallet,
    pauseAuthority: creatorWallet,
    recipients: [
      { beneficiary: creatorWallet, allocation: "1000000000", leafCount: 1, claimedAmount: "0" },
    ],
  });
}

// ---------------------------------------------------------------------------
// Page structure
// ---------------------------------------------------------------------------

test.describe("Allocation Editor — page structure", () => {
  test("shows connect prompt when wallet not connected", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await mockCampaignApi(page, ADDR, { leafCount: 3, cancellable: true, cancelledAt: null });
    await gotoWithRetry(page, `/campaign/${ADDR}/allocations`);

    await expect(page.getByText(/connect your wallet to edit/i)).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });

  test("shows Allocation Editor heading when connected", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await setupAuthorizedEditor(page);
    await gotoWithRetry(page, `/campaign/${ADDR}/allocations`);

    await expect(page.getByRole("heading", { name: /allocation editor/i })).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });

  test("shows three step guide cards", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await setupAuthorizedEditor(page);
    await gotoWithRetry(page, `/campaign/${ADDR}/allocations`);

    await expect(page.getByText(/step 1/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/step 2/i).first()).toBeVisible();
    await expect(page.getByText(/step 3/i).first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("shows Back to campaign link", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await setupAuthorizedEditor(page);
    await gotoWithRetry(page, `/campaign/${ADDR}/allocations`);

    await expect(
      page.getByRole("link", { name: /back to campaign/i }),
    ).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });

  test("Back to campaign link points to campaign detail page", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await setupAuthorizedEditor(page);
    await gotoWithRetry(page, `/campaign/${ADDR}/allocations`);

    const link = page.getByRole("link", { name: /back to campaign/i });
    await expect(link).toBeVisible({ timeout: 20_000 });
    await expect(link).toHaveAttribute("href", `/campaign/${ADDR}`);
    expect(pageErrors).toEqual([]);
  });

  test("shows Active Root hash in header", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await setupAuthorizedEditor(page);
    await gotoWithRetry(page, `/campaign/${ADDR}/allocations`);

    await expect(page.getByText(/active root/i)).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Authorization states
// ---------------------------------------------------------------------------

test.describe("Allocation Editor — authorization", () => {
  test("shows Update Allocations button for cancel authority", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await setupAuthorizedEditor(page);
    await gotoWithRetry(page, `/campaign/${ADDR}/allocations`);

    await expect(
      page.getByRole("button", { name: /update allocations/i }),
    ).toBeVisible({ timeout: 25_000 });
    expect(pageErrors).toEqual([]);
  });

  test("shows 'Only cancel authority' message for non-authorized wallet", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, {
      leafCount: 3,
      cancellable: true,
      cancelledAt: null,
      cancelAuthority: recipientWallet,
      pauseAuthority: recipientWallet,
      creator: recipientWallet,
    });
    await gotoWithRetry(page, `/campaign/${ADDR}/allocations`);

    await expect(page.getByText(/wallet is not cancel authority/i).first()).toBeVisible({ timeout: 25_000 });
    expect(pageErrors).toEqual([]);
  });

  test("Update Allocations button NOT visible for non-authorized wallet", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, {
      leafCount: 3,
      cancellable: true,
      cancelledAt: null,
      cancelAuthority: recipientWallet,
      creator: recipientWallet,
    });
    await gotoWithRetry(page, `/campaign/${ADDR}/allocations`);

    await expect(
      page.getByRole("button", { name: /update allocations/i }),
    ).not.toBeVisible({ timeout: 25_000 });
    expect(pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Editor table functionality
// ---------------------------------------------------------------------------

test.describe("Allocation Editor — table interactions", () => {
  test("Update Allocations button disabled when rows have empty wallet address", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    // No proof mock → fullLeaves = [] → initialRows = [] → empty row starts
    await mockCampaignApi(page, ADDR, {
      leafCount: 3,
      cancellable: true,
      cancelledAt: null,
      cancelAuthority: creatorWallet,
    });
    await gotoWithRetry(page, `/campaign/${ADDR}/allocations`);

    // Empty initial row → valid = false → button disabled
    await expect(
      page.getByRole("button", { name: /update allocations/i }),
    ).toBeDisabled({ timeout: 25_000 });
    expect(pageErrors).toEqual([]);
  });

  test("can add a recipient row with + Add Recipient", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await setupAuthorizedEditor(page);
    await gotoWithRetry(page, `/campaign/${ADDR}/allocations`);

    // Wait for editor to fully render
    await expect(
      page.getByRole("button", { name: /update allocations/i }),
    ).toBeVisible({ timeout: 25_000 });

    // Count rows before
    const addBtn = page.getByRole("button", { name: /add recipient/i });
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // Row count indicator should update
    await expect(page.getByText(/2 recipients/i)).toBeVisible({ timeout: 5_000 });
    expect(pageErrors).toEqual([]);
  });

  test("editor populates initial rows from proof API data", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await setupAuthorizedEditor(page);
    await gotoWithRetry(page, `/campaign/${ADDR}/allocations`);

    // Wait for editor
    await expect(
      page.getByRole("button", { name: /update allocations/i }),
    ).toBeVisible({ timeout: 25_000 });

    // Beneficiary from proof data should pre-fill the wallet input
    const walletInput = page.locator("input[placeholder='Solana wallet address']").first();
    await expect(walletInput).toHaveValue(creatorWallet, { timeout: 10_000 });
    expect(pageErrors).toEqual([]);
  });

  test("editor shows recipient count in table footer", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await setupAuthorizedEditor(page);
    await gotoWithRetry(page, `/campaign/${ADDR}/allocations`);

    await expect(
      page.getByRole("button", { name: /update allocations/i }),
    ).toBeVisible({ timeout: 25_000 });

    await expect(page.getByText(/1 recipient/i)).toBeVisible({ timeout: 5_000 });
    expect(pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Submit journey — loading state
// ---------------------------------------------------------------------------

test.describe("Allocation Editor — submit journey", () => {
  test("submit shows Publishing Update loading state", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await setupAuthorizedEditor(page);

    // Mock the prepare API so submit proceeds to tx step
    await page.route("/api/campaigns/prepare", async (route) => {
      await route.fulfill({
        json: {
          merkleRoot: "a".repeat(64),
          leafCount: 1,
          leaves: [{
            leafIndex: 0,
            beneficiary: creatorWallet,
            amount: "1000000000",
            releaseType: 0,
            startTime: "0",
            cliffTime: String(pastCliff()),
            endTime: String(pastCliff()),
            milestoneIdx: 0,
            proof: [Array.from({ length: 32 }, () => 0)],
          }],
        },
        status: 200,
      });
    });
    await gotoWithRetry(page, `/campaign/${ADDR}/allocations`);

    // Wait for Update button to appear and be enabled
    const updateBtn = page.getByRole("button", { name: /update allocations/i });
    await expect(updateBtn).toBeVisible({ timeout: 25_000 });
    await expect(updateBtn).toBeEnabled({ timeout: 10_000 });

    // Click submit → loading state appears while tx is being prepared/sent
    await updateBtn.click();
    await expect(
      page.getByRole("button", { name: /publishing update/i }),
    ).toBeVisible({ timeout: 15_000 });
    // pageErrors may include tx failure (devnet, no real account) — that's expected
  });
});
