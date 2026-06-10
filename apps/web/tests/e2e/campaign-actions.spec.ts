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
import {
  enableE2eWallet,
  enableMockOnChainTransactions,
  gotoWithRetry,
  mockCampaignApi,
  mockCampaignListApis,
  waitForCampaignListMocks,
  mockProofApi,
  injectStreamSchedule,
  creatorWallet,
  recipientWallet,
  nativeSolMint,
} from "./helpers";

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
      milestoneIndices: [0, 1, 2],
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
      milestoneIndices: [0, 1, 2],
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

// ---------------------------------------------------------------------------
// ClaimWithProofButton (multi-leaf beneficiary claim)
// ---------------------------------------------------------------------------

test.describe("ClaimWithProofButton (multi-leaf claim)", () => {
  test("Claim Tokens button visible when proof data available for wallet", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    const pastCliff = now() - 86400;

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
    await mockCampaignApi(page, ADDR, { leafCount: 3, cancelledAt: null });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByRole("button", { name: /claim.*tokens/i })).toBeVisible({ timeout: 25_000 });
    expect(pageErrors).toEqual([]);
  });

  test("No allocation panel shown for non-creator with no proof data", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);

    await page.route(`/api/campaigns/${ADDR}/proof*`, async (route) => {
      await route.fulfill({ json: { leaves: [] }, status: 200 });
    });
    // Make creator not the cancel authority so isCreator = false in ClaimWithProofButton
    await mockCampaignApi(page, ADDR, {
      leafCount: 3,
      cancelledAt: null,
      creator: "3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3",
      cancelAuthority: "3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3",
      pauseAuthority: "3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3",
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByText(/no allocation found/i)).toBeVisible({ timeout: 25_000 });
    expect(pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Single-leaf claim button (handleWithdraw) — via localStorage schedule
// ---------------------------------------------------------------------------

test.describe("Single-leaf claim button", () => {
  test("Claim button enabled when cliff passed (localSchedule injected)", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
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

    // Cliff passed → full 1 SOL claimable → button shows "Claim 1"
    await expect(page.getByRole("button", { name: /^claim 1$/i })).toBeEnabled({ timeout: 25_000 });
    expect(pageErrors).toEqual([]);
  });

  test("Claim button shows cliff countdown when cliff not yet reached", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    const futureCliff = now() + 86400 * 30;

    await injectStreamSchedule(page, ADDR, {
      releaseType: 0,
      startTime: 0,
      cliffTime: futureCliff,
      endTime: futureCliff,
      beneficiary: creatorWallet,
      amount: "1000000000",
    });
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, { leafCount: 1, cancelledAt: null });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByRole("button", { name: /wait for cliff/i })).toBeVisible({ timeout: 25_000 });
    expect(pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TriggerMilestoneButton (single-leaf milestone stream — creator releases)
// ---------------------------------------------------------------------------

test.describe("TriggerMilestoneButton (single-leaf milestone)", () => {
  test("Release Milestone #0 button visible for creator on milestone stream", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    const pastCliff = now() - 86400;

    await injectStreamSchedule(page, ADDR, {
      releaseType: 2,
      startTime: 0,
      cliffTime: pastCliff,
      endTime: pastCliff,
      milestoneIdx: 0,
      beneficiary: creatorWallet,
      amount: "1000000000",
    });
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, {
      leafCount: 1,
      hasMilestoneLeaves: true,
      cancelledAt: null,
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByRole("button", { name: /release milestone #0/i })).toBeVisible({ timeout: 25_000 });
    expect(pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Root Rotation — Allocation Editor link
// ---------------------------------------------------------------------------

test.describe("Root Rotation (Allocation Editor)", () => {
  test("Open Allocation Editor link visible for cancel authority on multi-leaf", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, {
      leafCount: 3,
      cancellable: true,
      cancelledAt: null,
      cancelAuthority: creatorWallet,
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByRole("link", { name: /open allocation editor/i })).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });

  test("Open Allocation Editor link NOT visible when campaign is cancelled", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    const cancelledAt = now() - 86400;
    await mockCampaignApi(page, ADDR, {
      leafCount: 3,
      cancellable: true,
      cancelledAt,
      cancelAuthority: creatorWallet,
      gracePeriod: { end: String(cancelledAt + 86400 * 7), remaining: String(86400 * 6), isExpired: false },
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByRole("link", { name: /open allocation editor/i })).not.toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });

  test("Open Allocation Editor link NOT visible for single-leaf stream", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, {
      leafCount: 1,
      cancellable: true,
      cancelledAt: null,
      cancelAuthority: creatorWallet,
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByRole("link", { name: /open allocation editor/i })).not.toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Clawback UI — grace period banners (US-1)
// ---------------------------------------------------------------------------

const multiLeafRecipients = [
  { beneficiary: creatorWallet, allocation: "500000000", leafCount: 1, claimedAmount: "0" },
  { beneficiary: "3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3", allocation: "300000000", leafCount: 1, claimedAmount: "0" },
  { beneficiary: "11111111111111111111111111111113", allocation: "200000000", leafCount: 1, claimedAmount: "0" },
];

test.describe("Clawback UI", () => {
  test("cancel campaign shows amber grace banner", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await enableMockOnChainTransactions(page);
    await mockCampaignApi(page, ADDR, {
      leafCount: 3,
      cancellable: true,
      cancelledAt: null,
      recipients: multiLeafRecipients,
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    const cancelBtn = page.getByRole("button", { name: /cancel campaign/i });
    await expect(cancelBtn).toBeVisible({ timeout: 20_000 });
    await cancelBtn.click();

    await expect(page.getByText(/cancel this vesting/i)).toBeVisible();
    await page.getByRole("button", { name: /cancel stream/i }).click();

    const banner = page
      .locator('[class*="border-amber-500"]')
      .filter({ hasText: /Grace period expires in/i });
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner.getByText(/remaining/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("grace period countdown updates", async ({ page }) => {
    const frozenNow = new Date("2026-06-09T12:00:00Z");
    await page.clock.install({ time: frozenNow });

    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);

    const cancelledAt = Math.floor(frozenNow.getTime() / 1000) - 86400;
    const graceEnd = cancelledAt + 86400 * 7;
    const nowSec = Math.floor(frozenNow.getTime() / 1000);

    await mockCampaignApi(page, ADDR, {
      cancelledAt,
      gracePeriod: {
        end: String(graceEnd),
        remaining: String(graceEnd - nowSec),
        isExpired: false,
      },
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    const banner = page
      .locator('[class*="border-amber-500"]')
      .filter({ hasText: /Grace period expires in/i });
    const countdown = banner.getByText(/remaining/i);
    await expect(countdown).toBeVisible({ timeout: 20_000 });

    const initialText = await countdown.textContent();
    expect(initialText).toBeTruthy();

    await page.clock.fastForward(61_000);

    await expect(countdown).not.toHaveText(initialText!);
    expect(pageErrors).toEqual([]);
  });

  test("grace expired shows red withdraw banner", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);

    const cancelledAt = now() - 86400 * 8; // 8 days ago, grace (7 days) expired
    await mockCampaignApi(page, ADDR, {
      cancelledAt,
      totalClaimed: "0",
      gracePeriod: { end: String(cancelledAt + 86400 * 7), remaining: "0", isExpired: true },
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    const banner = page
      .locator('[class*="border-red-500"]')
      .filter({ hasText: /Grace period has expired/i });
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner.getByRole("button", { name: /withdraw unvested/i })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("after withdrawal shows green settled banner", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);

    const cancelledAt = now() - 86400 * 8; // cancelled + grace expired
    await page.addInitScript((data: { key: string }) => {
      window.localStorage.setItem(data.key, "1");
    }, { key: `velthoryn:stream-settled:${ADDR}` });
    await mockCampaignApi(page, ADDR, {
      cancelledAt,
      totalClaimed: "0",
      gracePeriod: { end: String(cancelledAt + 86400 * 7), remaining: "0", isExpired: true },
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    const banner = page
      .locator('[class*="border-emerald-500"]')
      .filter({ hasText: /Campaign settled/i });
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner.getByText(/withdrawn/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("non-creator sees no clawback banners", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await page.addInitScript((publicKey: string) => {
      window.localStorage.setItem("velthoryn:e2e-wallet", "1");
      window.localStorage.setItem("velthoryn:e2e-public-key", publicKey);
    }, recipientWallet);

    const cancelledAt = now() - 86400; // grace still active — creator would see amber banner
    await mockCampaignApi(page, ADDR, {
      cancelledAt,
      leafCount: 3,
      recipients: multiLeafRecipients,
      gracePeriod: {
        end: String(cancelledAt + 86400 * 7),
        remaining: String(86400 * 6),
        isExpired: false,
      },
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(
      page.locator('[class*="border-amber-500"]').filter({ hasText: /Grace period expires in/i }),
    ).not.toBeVisible({ timeout: 20_000 });
    await expect(
      page.locator('[class*="border-red-500"]').filter({ hasText: /Grace period has expired/i }),
    ).not.toBeVisible();
    await expect(
      page.locator('[class*="border-emerald-500"]').filter({ hasText: /Campaign settled/i }),
    ).not.toBeVisible();
    await expect(page.getByRole("button", { name: /cancel campaign/i })).not.toBeVisible();
    await expect(page.getByRole("button", { name: /cancel stream/i })).not.toBeVisible();
    await expect(page.getByRole("button", { name: /withdraw unvested/i })).not.toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("needs action tab shows correct campaigns", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    const pastCliff = now() - 86400;
    const futureCliff = now() + 86400 * 30;
    const cancelledAt = now() - 86400;

    const cancelledSenderAddr = "SendCancel11111111111111111111111111111111";
    const activeSenderAddr = "SendActive111111111111111111111111111111111";
    const claimableRecipientAddr = "RecvClaim1111111111111111111111111111111";
    const scheduledRecipientAddr = "RecvSched11111111111111111111111111111111";

    await enableE2eWallet(page);
    await mockCampaignListApis(page, {
      senderCampaigns: [
        {
          treeAddress: cancelledSenderAddr,
          creator: creatorWallet,
          mint: nativeSolMint,
          campaignId: 101,
          leafCount: 2,
          totalSupply: 1_000_000_000,
          totalClaimed: 0,
          cancellable: true,
          paused: false,
          cancelledAt,
          createdAt: now() - 86400 * 10,
          metadata: { name: "Cancelled Sender Campaign" },
        },
        {
          treeAddress: activeSenderAddr,
          creator: creatorWallet,
          mint: nativeSolMint,
          campaignId: 102,
          leafCount: 1,
          totalSupply: 500_000_000,
          totalClaimed: 0,
          cancellable: true,
          paused: false,
          cancelledAt: null,
          createdAt: now() - 86400 * 5,
          metadata: { name: "Active Sender Campaign" },
        },
      ],
      recipientCampaigns: [
        {
          treeAddress: claimableRecipientAddr,
          creator: recipientWallet,
          mint: nativeSolMint,
          campaignId: 201,
          totalSupply: "1000000000",
          leafCount: 1,
          paused: false,
          cancelledAt: null,
          createdAt: now() - 86400 * 3,
          metadata: { name: "Claimable Recipient Stream" },
          myClaimed: "0",
          myLeaf: {
            leafIndex: 0,
            amount: "1000000000",
            releaseType: 0,
            startTime: 0,
            cliffTime: pastCliff,
            endTime: pastCliff,
            milestoneIdx: 0,
          },
        },
        {
          treeAddress: scheduledRecipientAddr,
          creator: recipientWallet,
          mint: nativeSolMint,
          campaignId: 202,
          totalSupply: "1000000000",
          leafCount: 1,
          paused: false,
          cancelledAt: null,
          createdAt: now() - 86400 * 2,
          metadata: { name: "Scheduled Recipient Stream" },
          myClaimed: "0",
          myLeaf: {
            leafIndex: 0,
            amount: "1000000000",
            releaseType: 0,
            startTime: 0,
            cliffTime: futureCliff,
            endTime: futureCliff,
            milestoneIdx: 0,
          },
        },
      ],
    });
    await gotoWithRetry(page, "/campaigns");
    await waitForCampaignListMocks(page);

    await expect(page.getByRole("button", { name: /^all\b/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/loading streams/i)).not.toBeVisible({ timeout: 20_000 });

    const needsActionTab = page.getByRole("button", { name: /needs action/i });
    await expect(needsActionTab).toContainText("(2)");
    await needsActionTab.click();

    await expect(page.getByText("Cancelled Sender Campaign")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Claimable Recipient Stream")).toBeVisible();
    await expect(page.getByText(cancelledSenderAddr)).toBeVisible();
    await expect(page.getByText(claimableRecipientAddr)).toBeVisible();
    await expect(page.getByText("Active Sender Campaign")).not.toBeVisible();
    await expect(page.getByText("Scheduled Recipient Stream")).not.toBeVisible();
    await expect(page.getByText(activeSenderAddr)).not.toBeVisible();
    await expect(page.getByText(scheduledRecipientAddr)).not.toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("sidebar shows amber dot when action needed", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    const cancelledAt = now() - 86400;
    const cancelledSenderAddr = "SendCancel11111111111111111111111111111111";

    await enableE2eWallet(page);
    await mockCampaignListApis(page, {
      senderCampaigns: [
        {
          treeAddress: cancelledSenderAddr,
          creator: creatorWallet,
          mint: nativeSolMint,
          campaignId: 101,
          leafCount: 2,
          totalSupply: 1_000_000_000,
          totalClaimed: 0,
          cancellable: true,
          paused: false,
          cancelledAt,
          createdAt: now() - 86400 * 10,
          metadata: { name: "Cancelled Sender Campaign" },
        },
      ],
      recipientCampaigns: [],
    });
    await gotoWithRetry(page, "/dashboard");
    await waitForCampaignListMocks(page);

    const campaignsLink = page.getByRole("link", { name: "My Campaigns", exact: true });
    await expect(campaignsLink).toBeVisible({ timeout: 20_000 });
    await expect(
      campaignsLink.locator("span.ml-auto.h-2.w-2.rounded-full.bg-amber-400"),
    ).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Non-cancellable campaign
// ---------------------------------------------------------------------------

test.describe("Non-cancellable campaign", () => {
  test("Cancel button not visible when cancellable is false", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, {
      cancellable: false,
      cancelAuthority: null,
      leafCount: 1,
      cancelledAt: null,
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByRole("button", { name: /cancel stream/i })).not.toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /cancel campaign/i })).not.toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });

  test("Allocation Editor NOT visible when cancellable is false", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, {
      cancellable: false,
      cancelAuthority: null,
      leafCount: 3,
      cancelledAt: null,
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByRole("link", { name: /open allocation editor/i })).not.toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });
});
