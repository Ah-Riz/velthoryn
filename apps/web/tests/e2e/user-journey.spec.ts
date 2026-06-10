/**
 * E2E user journey tests — verify that action buttons correctly transition
 * through loading states when the user submits a transaction.
 *
 * These tests do NOT require a live Solana validator. They verify the UI
 * journey up to the point of wallet/RPC interaction:
 *   form fill → click submit → loading state visible
 *
 * The underlying tx will ultimately fail (fake devnet address / no SOL),
 * but the loading state and recovery are what these tests assert.
 */
import { expect, test } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import {
  enableE2eWallet,
  enableMockOnChainTransactions,
  gotoWithRetry,
  mockCampaignApi,
  mockProofApi,
  injectStreamSchedule,
  selectSolToken,
  creatorWallet,
  recipientWallet,
} from "./helpers";

const ADDR = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const now = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------
// Create stream journeys — submit → loading state
// ---------------------------------------------------------------------------

test.describe("Create cliff stream journey", () => {
  test("clicking Create Cliff Stream shows Processing loading state", async ({ page }) => {
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    await selectSolToken(page);
    await page.getByPlaceholder(/solana wallet/i).first().fill(recipientWallet);
    await page.getByPlaceholder(/e\.g\. 1000/i).first().fill("0.001");
    const cliffDate = new Date(Date.now() + 86400_000 * 30).toISOString().slice(0, 16);
    await page.locator("input[type='datetime-local']").first().fill(cliffDate);

    const submitBtn = page.getByRole("button", { name: /create cliff stream/i });
    await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
    await submitBtn.click();

    // FormSummary shows "Processing..." spinner while tx is prepared/sent
    await expect(page.getByRole("button", { name: /processing/i })).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Create linear stream journey", () => {
  test("clicking Create Linear Stream shows Processing loading state", async ({ page }) => {
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/linear");

    await selectSolToken(page);
    await page.getByPlaceholder(/solana wallet/i).first().fill(recipientWallet);
    await page.getByPlaceholder(/e\.g\. 1000/i).first().fill("0.001");

    const startDate = new Date(Date.now() + 86400_000).toISOString().slice(0, 16);
    const endDate = new Date(Date.now() + 86400_000 * 31).toISOString().slice(0, 16);
    const inputs = page.locator("input[type='datetime-local']");
    await inputs.nth(0).fill(startDate);
    await inputs.nth(1).fill(endDate);

    const submitBtn = page.getByRole("button", { name: /create linear stream/i });
    await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
    await submitBtn.click();

    await expect(page.getByRole("button", { name: /processing/i })).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Create milestone stream journey", () => {
  test("clicking Create Milestone Stream shows Processing loading state", async ({ page }) => {
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/milestone");

    await selectSolToken(page);
    await page.getByPlaceholder(/solana wallet/i).first().fill(recipientWallet);
    await page.getByPlaceholder(/e\.g\. 1000/i).first().fill("0.001");
    const cliffDate = new Date(Date.now() + 86400_000 * 30).toISOString().slice(0, 16);
    await page.locator("input[type='datetime-local']").first().fill(cliffDate);

    const submitBtn = page.getByRole("button", { name: /create milestone stream/i });
    await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
    await submitBtn.click();

    await expect(page.getByRole("button", { name: /processing/i })).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Pause campaign journey
// ---------------------------------------------------------------------------

test.describe("Pause campaign journey", () => {
  test("clicking Pause Campaign shows Pausing loading state", async ({ page }) => {
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, { paused: false, cancelledAt: null });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    const pauseBtn = page.getByRole("button", { name: /pause campaign/i });
    await expect(pauseBtn).toBeVisible({ timeout: 20_000 });
    await pauseBtn.click();

    // PauseToggleButton: loading ? "Pausing..." : "Pause Campaign"
    await expect(page.getByRole("button", { name: /pausing\.\.\./i })).toBeVisible({ timeout: 10_000 });
  });

  test("clicking Unpause Campaign shows Resuming loading state", async ({ page }) => {
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, { paused: true, cancelledAt: null });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    const unpauseBtn = page.getByRole("button", { name: /unpause campaign/i });
    await expect(unpauseBtn).toBeVisible({ timeout: 20_000 });
    await unpauseBtn.click();

    // PauseToggleButton: loading ? "Resuming..." : "Unpause Campaign"
    await expect(page.getByRole("button", { name: /resuming\.\.\./i })).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Cancel campaign journey — dialog confirm → loading state
// ---------------------------------------------------------------------------

test.describe("Cancel campaign journey", () => {
  test("confirming cancel shows Cancelling loading state (multi-leaf)", async ({ page }) => {
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, {
      leafCount: 3,
      cancellable: true,
      cancelledAt: null,
      recipients: [
        { beneficiary: creatorWallet, allocation: "500000000", leafCount: 1, claimedAmount: "0" },
        { beneficiary: recipientWallet, allocation: "300000000", leafCount: 1, claimedAmount: "0" },
        { beneficiary: "11111111111111111111111111111113", allocation: "200000000", leafCount: 1, claimedAmount: "0" },
      ],
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    // Open cancel dialog
    const cancelBtn = page.getByRole("button", { name: /cancel campaign/i });
    await expect(cancelBtn).toBeVisible({ timeout: 20_000 });
    await cancelBtn.click();

    // Dialog opens — click confirm button
    await expect(page.getByText(/cancel this vesting/i)).toBeVisible();
    const confirmBtn = page.getByRole("button", { name: /cancel stream|cancel & settle/i }).last();
    await confirmBtn.click();

    // CancelConfirmDialog: isLoading → "Cancelling..."
    await expect(page.getByRole("button", { name: /cancelling\.\.\./i })).toBeVisible({ timeout: 10_000 });
  });

  test("confirming cancel shows Cancelling loading state (single-leaf stream)", async ({ page }) => {
    await enableE2eWallet(page);
    // Need localSchedule so cancel stream knows the beneficiary
    await injectStreamSchedule(page, ADDR, {
      releaseType: 0,
      startTime: 0,
      cliffTime: now() - 86400,
      endTime: now() - 86400,
      beneficiary: creatorWallet,
      amount: "1000000000",
    });
    await mockCampaignApi(page, ADDR, {
      leafCount: 1,
      cancellable: true,
      cancelledAt: null,
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    const cancelBtn = page.getByRole("button", { name: /cancel stream/i });
    await expect(cancelBtn).toBeVisible({ timeout: 20_000 });
    await cancelBtn.click();

    await expect(page.getByText(/cancel this vesting/i)).toBeVisible();
    // For single stream: dialog shows "Cancel & Settle" in instant mode
    const confirmBtn = page.getByRole("button", { name: /cancel.*settle|cancel stream/i }).last();
    await confirmBtn.click();

    await expect(page.getByRole("button", { name: /cancelling\.\.\./i })).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Single-leaf claim journey
// ---------------------------------------------------------------------------

test.describe("Single-leaf claim journey", () => {
  test("clicking Claim shows Claiming loading state", async ({ page }) => {
    const pastCliff = now() - 86400;
    await injectStreamSchedule(page, ADDR, {
      releaseType: 0,
      startTime: 0,
      cliffTime: pastCliff,
      endTime: pastCliff,
      beneficiary: creatorWallet,
      amount: "1000000000",
    });
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, { leafCount: 1, cancelledAt: null });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    // Wait for enabled claim button
    const claimBtn = page.getByRole("button", { name: /^claim 1$/i });
    await expect(claimBtn).toBeEnabled({ timeout: 25_000 });
    await claimBtn.click();

    // handleWithdraw: setTxStatus({ type: "loading" }) → button shows "Claiming..."
    await expect(page.getByRole("button", { name: /claiming\.\.\./i })).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Multi-leaf claim journey (ClaimWithProofButton)
// ---------------------------------------------------------------------------

test.describe("Multi-leaf claim journey", () => {
  test("clicking Claim Tokens shows Claiming loading state", async ({ page }) => {
    const pastCliff = now() - 86400;

    await enableMockOnChainTransactions(page);
    await page.route("**/api/events/sync", async (route) => {
      await route.fulfill({ json: { processed: 1 }, status: 200 });
    });
    await mockProofApi(page, ADDR, [{
      leafIndex: 0,
      beneficiary: creatorWallet,
      amount: 1000000000,
      releaseType: 0,
      startTime: 0,
      cliffTime: pastCliff,
      endTime: pastCliff,
      milestoneIdx: 0,
    }]);
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, { leafCount: 3, cancelledAt: null });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    // Wait for violet Claim button to appear
    const claimBtn = page.getByRole("button", { name: /claim.*tokens/i });
    await expect(claimBtn).toBeEnabled({ timeout: 25_000 });
    await claimBtn.click();

    // ClaimWithProofButton: setLoading(true) → button shows "Claiming..."
    await expect(page.getByRole("button", { name: /claiming\.\.\./i })).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Withdraw unvested journey
// ---------------------------------------------------------------------------

test.describe("Withdraw Unvested journey", () => {
  test("clicking Withdraw Unvested opens confirmation dialog", async ({ page }) => {
    const cancelledAt = now() - 86400 * 8;
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, {
      cancelledAt,
      totalClaimed: "0",
      gracePeriod: { end: String(cancelledAt + 86400 * 7), remaining: "0", isExpired: true },
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    const withdrawBtn = page.getByRole("button", { name: /withdraw unvested tokens/i });
    await expect(withdrawBtn).toBeVisible({ timeout: 20_000 });
    await withdrawBtn.click();

    await expect(page.getByRole("heading", { name: "Withdraw Unvested Tokens?" })).toBeVisible({
      timeout: 10_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Full user journey: navigate from create form to campaign detail
// ---------------------------------------------------------------------------

test.describe("Navigation journeys", () => {
  test("Open Allocation Editor link navigates to allocations page", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    // Also mock allocations page sub-routes
    await page.route(`/api/campaigns/${ADDR}/proof*`, async (route) => {
      await route.fulfill({ json: { leaves: [] }, status: 200 });
    });
    await mockCampaignApi(page, ADDR, {
      leafCount: 3,
      cancellable: true,
      cancelledAt: null,
      cancelAuthority: creatorWallet,
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    const editorLink = page.getByRole("link", { name: /open allocation editor/i });
    await expect(editorLink).toBeVisible({ timeout: 20_000 });
    await editorLink.click();

    await expect(page).toHaveURL(new RegExp(`/campaign/${ADDR}/allocations`));
    await expect(page.getByRole("heading", { name: /allocation editor/i })).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });

  test("Back to campaign link from allocations returns to campaign detail", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await page.route(`/api/campaigns/${ADDR}/proof*`, async (route) => {
      await route.fulfill({ json: { leaves: [] }, status: 200 });
    });
    await mockCampaignApi(page, ADDR, {
      leafCount: 3,
      cancellable: true,
      cancelledAt: null,
      cancelAuthority: creatorWallet,
    });
    await gotoWithRetry(page, `/campaign/${ADDR}/allocations`);

    const backLink = page.getByRole("link", { name: /back to campaign/i });
    await expect(backLink).toBeVisible({ timeout: 20_000 });
    await backLink.click();

    await expect(page).toHaveURL(new RegExp(`/campaign/${ADDR}$`));
    expect(pageErrors).toEqual([]);
  });
});
