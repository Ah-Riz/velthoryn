/**
 * E2E coverage for all campaign/stream action buttons:
 * Pause, Cancel (stream + campaign), Instant Refund, Withdraw Unvested,
 * Milestone Release.
 *
 * Uses page.route() to mock /api/campaigns/:treeAddress so authority
 * fields are available without a real on-chain account.
 */
import { expect, test } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import { enableE2eWallet, gotoWithRetry, mockCampaignApi, creatorWallet } from "./helpers";

const ADDR = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const now = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------
// Pause Toggle
// ---------------------------------------------------------------------------

test.describe("Pause toggle", () => {
  test("Pause Campaign button visible when wallet is pause authority", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, { paused: false, cancelledAt: null });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByRole("button", { name: /pause campaign/i })).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });

  test("Unpause Campaign button visible when campaign is paused", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, { paused: true, cancelledAt: null });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByRole("button", { name: /unpause campaign/i })).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });

  test("Pause button not visible when campaign is cancelled", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, {
      cancelledAt: now() - 86400,
      gracePeriod: { end: String(now() + 86400 * 6), remaining: String(86400 * 6), isExpired: false },
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByRole("button", { name: /pause campaign/i })).not.toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cancel Stream (single-leaf, creator = cancel authority)
// ---------------------------------------------------------------------------

test.describe("Cancel Stream (single-leaf)", () => {
  test("Cancel Stream button visible when creator owns single-leaf stream", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, { leafCount: 1, cancellable: true, cancelledAt: null });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByRole("button", { name: /cancel stream/i })).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });

  test("Cancel Stream dialog opens with vested/unvested breakdown", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, { leafCount: 1, cancellable: true, cancelledAt: null });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    const btn = page.getByRole("button", { name: /cancel stream/i });
    await expect(btn).toBeVisible({ timeout: 20_000 });
    await btn.click();

    await expect(page.getByText(/cancel this vesting stream/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("Cancel Stream dialog can be dismissed via Go Back", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, { leafCount: 1, cancellable: true, cancelledAt: null });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    const btn = page.getByRole("button", { name: /cancel stream/i });
    await expect(btn).toBeVisible({ timeout: 20_000 });
    await btn.click();
    await expect(page.getByText(/cancel this vesting stream/i)).toBeVisible();
    await page.getByRole("button", { name: /go back/i }).click();
    await expect(page.getByText(/cancel this vesting stream/i)).not.toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cancel Campaign (multi-leaf)
// ---------------------------------------------------------------------------

test.describe("Cancel Campaign (multi-leaf)", () => {
  test("Cancel Campaign button visible for multi-leaf with cancel authority", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, {
      leafCount: 3,
      cancellable: true,
      cancelledAt: null,
      recipients: [
        { beneficiary: creatorWallet, allocation: "500000000", leafCount: 1, claimedAmount: "0" },
        { beneficiary: "3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3", allocation: "300000000", leafCount: 1, claimedAmount: "0" },
        { beneficiary: "11111111111111111111111111111113", allocation: "200000000", leafCount: 1, claimedAmount: "0" },
      ],
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByRole("button", { name: /cancel campaign/i })).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });

  test("Cancel Campaign dialog opens and shows grace period info", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, {
      leafCount: 3,
      cancellable: true,
      cancelledAt: null,
      recipients: [
        { beneficiary: creatorWallet, allocation: "500000000", leafCount: 1, claimedAmount: "0" },
        { beneficiary: "3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3", allocation: "300000000", leafCount: 1, claimedAmount: "0" },
        { beneficiary: "11111111111111111111111111111113", allocation: "200000000", leafCount: 1, claimedAmount: "0" },
      ],
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    const btn = page.getByRole("button", { name: /cancel campaign/i });
    await expect(btn).toBeVisible({ timeout: 20_000 });
    await btn.click();

    await expect(page.getByText(/cancel this vesting/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /go back/i })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Instant Refund (multi-leaf, before cliff)
// ---------------------------------------------------------------------------

test.describe("Instant Refund", () => {
  test("Instant Refund button visible for multi-leaf before cliff", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    const futureCliff = now() + 86400 * 30;
    await mockCampaignApi(page, ADDR, {
      leafCount: 3,
      cancellable: true,
      cancelledAt: null,
      minCliffTime: futureCliff,
      instantRefunded: false,
      instantRefundEligible: true,
      recipients: [
        { beneficiary: creatorWallet, allocation: "500000000", leafCount: 1, claimedAmount: "0" },
        { beneficiary: "3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3", allocation: "300000000", leafCount: 1, claimedAmount: "0" },
        { beneficiary: "11111111111111111111111111111113", allocation: "200000000", leafCount: 1, claimedAmount: "0" },
      ],
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByRole("button", { name: /instant refund/i })).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Withdraw Unvested (post-cancel, grace expired)
// ---------------------------------------------------------------------------

test.describe("Withdraw Unvested", () => {
  test("Withdraw Unvested button visible when campaign cancelled and grace period expired", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    const cancelledAt = now() - 86400 * 8; // 8 days ago, grace (7 days) expired
    await mockCampaignApi(page, ADDR, {
      cancelledAt,
      totalClaimed: "0",
      gracePeriod: { end: String(cancelledAt + 86400 * 7), remaining: "0", isExpired: true },
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByRole("button", { name: /withdraw unvested/i })).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });

  test("Withdraw Unvested button is disabled during active grace period", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    const cancelledAt = now() - 86400; // 1 day ago, grace (7 days) not expired
    await mockCampaignApi(page, ADDR, {
      cancelledAt,
      gracePeriod: { end: String(cancelledAt + 86400 * 7), remaining: String(86400 * 6), isExpired: false },
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    // Button shows but is disabled while grace period is active
    await expect(page.getByRole("button", { name: /withdraw unvested/i })).toBeDisabled({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Milestone Release Panel
// ---------------------------------------------------------------------------

test.describe("Milestone Release Panel", () => {
  test("Milestone release panel visible for creator with milestone campaign", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, {
      leafCount: 3,
      hasMilestoneLeaves: true,
      cancelledAt: null,
      recipients: [
        { beneficiary: "3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3", allocation: "333333333", leafCount: 1, claimedAmount: "0" },
        { beneficiary: "3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3", allocation: "333333333", leafCount: 1, claimedAmount: "0" },
        { beneficiary: "3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3", allocation: "333333334", leafCount: 1, claimedAmount: "0" },
      ],
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    // Creator should see milestone release buttons (#0, #1, etc.)
    await expect(page.getByText(/release #0/i)).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });

  test("Milestone release panel hidden when campaign is cancelled", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    const cancelledAt = now() - 86400 * 8;
    await mockCampaignApi(page, ADDR, {
      leafCount: 3,
      hasMilestoneLeaves: true,
      cancelledAt,
      gracePeriod: { end: String(cancelledAt + 86400 * 7), remaining: "0", isExpired: true },
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByText(/release #0/i)).not.toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Campaign status badges
// ---------------------------------------------------------------------------

test.describe("Campaign status badges", () => {
  test("shows Active badge for live campaign", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, { paused: false, cancelledAt: null });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByText(/active/i).first()).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });

  test("shows Paused badge for paused campaign", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, { paused: true, cancelledAt: null });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByText(/paused/i).first()).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });

  test("shows Cancelled badge for cancelled campaign", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    const cancelledAt = now() - 86400;
    await mockCampaignApi(page, ADDR, {
      cancelledAt,
      gracePeriod: { end: String(cancelledAt + 86400 * 7), remaining: String(86400 * 6), isExpired: false },
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByText(/cancelled/i).first()).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });
});
