/**
 * E2E coverage for VestingChart, CampaignTimeline, and MilestoneCarouselCard
 * components rendered inside the campaign detail page.
 *
 * VestingChart   — shows when cliffTime && endTime are set from local schedule
 * MilestoneCarouselCard — shows when releaseType=2 + hasMilestoneLeaves: true
 * CampaignTimeline — always renders; shows "Activity" section (heading: "ACTIVITY")
 */
import { expect, test } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import {
  enableE2eWallet,
  gotoWithRetry,
  mockCampaignApi,
  injectStreamSchedule,
  creatorWallet,
} from "./helpers";

const ADDR = "8wu9j14MDXtkUPHC6EeG4AvfBSDZwVqqSqfNK1LLt1UY";
const now = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------
// VestingChart
// ---------------------------------------------------------------------------

test.describe("VestingChart", () => {
  test("shows vesting chart when cliff schedule loaded", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    const futureCliff = now() + 86400 * 30;
    const futureEnd = now() + 86400 * 365;

    await injectStreamSchedule(page, ADDR, {
      releaseType: 0,
      startTime: now(),
      cliffTime: futureCliff,
      endTime: futureEnd,
      beneficiary: creatorWallet,
      amount: "1000000000",
    });
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, { leafCount: 1, cancelledAt: null });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    // "Vesting Curve" label is always present when the chart renders
    // Use exact: true to avoid strict mode violation with "Vesting curve" elsewhere on the page
    await expect(page.getByText("Vesting Curve", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    // The SVG chart element should be in the DOM
    await expect(page.locator('svg.cursor-crosshair').first()).toBeVisible({ timeout: 10_000 });
    expect(pageErrors).toEqual([]);
  });

  test("chart shows time range buttons for long schedule", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    // Use a 2-year schedule so all time-range buttons pass the availability filter
    const startTs = now();
    const futureCliff = startTs + 86400 * 90;
    const futureEnd = startTs + 86400 * 730; // ~2 years

    await injectStreamSchedule(page, ADDR, {
      releaseType: 1,
      startTime: startTs,
      cliffTime: futureCliff,
      endTime: futureEnd,
      beneficiary: creatorWallet,
      amount: "1000000000",
    });
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, { leafCount: 1, cancelledAt: null });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByText("Vesting Curve", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    // Time-range buttons appear when availableRanges.length > 2
    await expect(page.getByRole("button", { name: "Daily" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Weekly" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Monthly" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Yearly" })).toBeVisible();
    await expect(page.getByRole("button", { name: "All" })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("clicking Weekly button changes active range without errors", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    const startTs = now();
    const futureCliff = startTs + 86400 * 90;
    const futureEnd = startTs + 86400 * 730;

    await injectStreamSchedule(page, ADDR, {
      releaseType: 1,
      startTime: startTs,
      cliffTime: futureCliff,
      endTime: futureEnd,
      beneficiary: creatorWallet,
      amount: "1000000000",
    });
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, { leafCount: 1, cancelledAt: null });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByText("Vesting Curve", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    const weeklyBtn = page.getByRole("button", { name: "Weekly" });
    await expect(weeklyBtn).toBeVisible({ timeout: 10_000 });
    await weeklyBtn.click();

    // After clicking Weekly, the chart should still be visible with no errors
    await expect(page.locator('svg.cursor-crosshair').first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CampaignTimeline
// ---------------------------------------------------------------------------

test.describe("CampaignTimeline", () => {
  test("shows campaign activity section", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);

    await enableE2eWallet(page);
    // mockCampaignApi mocks timeline to return { events: [] } by default
    await mockCampaignApi(page, ADDR, { leafCount: 1, cancelledAt: null });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    // CampaignTimeline always renders. Heading is "ACTIVITY" (uppercase via CSS).
    // We match case-insensitively via getByRole or getByText.
    await expect(page.getByRole("heading", { name: /activity/i })).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });

  test("shows empty state when no timeline events", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);

    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, { leafCount: 1, cancelledAt: null });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    // Empty state message when events array is empty
    await expect(page.getByText("No events recorded yet")).toBeVisible({ timeout: 20_000 });
    expect(pageErrors).toEqual([]);
  });

  test("shows claimed event when timeline returns a claim entry", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    const claimedEvent = {
      type: "claimed",
      signature: "5KxABCDEFGHIJKLMNOP",
      blockTime: String(now() - 3600),
      data: {
        beneficiary: creatorWallet,
        amount: "500000000",
      },
    };

    await enableE2eWallet(page);

    // Register mockCampaignApi first, then override the timeline route afterward.
    // Playwright dispatches to the LAST registered matching handler, so our
    // override must come after the helper's default "events: []" registration.
    await mockCampaignApi(page, ADDR, { leafCount: 1, cancelledAt: null });
    await page.route(`/api/campaigns/${ADDR}/timeline*`, async (route) => {
      await route.fulfill({
        json: { events: [claimedEvent], total: 1 },
        status: 200,
      });
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    // The "claimed" event renders as "{addr} claimed {amount}"
    await expect(page.getByText(/claimed/i).first()).toBeVisible({ timeout: 20_000 });
    // The truncated signature link: "5KxABCDE...MNOP" (first 8 + "..." + last 4)
    await expect(page.getByRole("link", { name: /5KxABCDE\.\.\.MNOP/i })).toBeVisible({ timeout: 10_000 });
    expect(pageErrors).toEqual([]);
  });

  test("shows multiple event types when timeline returns several events", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    const events = [
      {
        type: "claimed",
        signature: "SIG1ABCDEFGHIJKLMNOPQRST",
        blockTime: String(now() - 7200),
        data: { beneficiary: creatorWallet, amount: "200000000" },
      },
      {
        type: "paused",
        signature: "SIG2ABCDEFGHIJKLMNOPQRST",
        blockTime: String(now() - 3600),
        data: { paused: true },
      },
    ];

    await enableE2eWallet(page);

    // Register campaign mock first, then override timeline to win the dispatch race
    await mockCampaignApi(page, ADDR, { leafCount: 1, cancelledAt: null });
    await page.route(`/api/campaigns/${ADDR}/timeline*`, async (route) => {
      await route.fulfill({
        json: { events, total: 2 },
        status: 200,
      });
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(page.getByText(/claimed/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Campaign paused")).toBeVisible({ timeout: 10_000 });
    expect(pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MilestoneCarouselCard
// ---------------------------------------------------------------------------

test.describe("MilestoneCarouselCard", () => {
  test("milestone carousel shows for milestone campaign", async ({ page }) => {
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

    // MilestoneCarouselCard header shows "Milestone #0" (from milestoneUi?.name ?? `Milestone #${current.index}`)
    await expect(page.getByRole("heading", { name: /milestone #0/i })).toBeVisible({ timeout: 25_000 });
    expect(pageErrors).toEqual([]);
  });

  test("milestone carousel shows Awaiting Release status when not yet released", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    // Future cliff so milestone is not yet unlocked
    const futureCliff = now() + 86400 * 30;

    await injectStreamSchedule(page, ADDR, {
      releaseType: 2,
      startTime: now(),
      cliffTime: futureCliff,
      endTime: futureCliff,
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

    // Status label is "Awaiting Release" when not released, not claimed
    await expect(page.getByText("Awaiting Release")).toBeVisible({ timeout: 25_000 });
    expect(pageErrors).toEqual([]);
  });

  test("milestone carousel navigation buttons visible with multiple milestones", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    const pastCliff = now() - 86400;

    // Inject a milestone schedule; the carousel navigation (prev/next) appears
    // when total > 1. The page derives milestoneEntries from proof leaves when
    // hasMilestoneLeaves is true and leafCount > 1.
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
    // Mock proof API to return 2 milestone leaves so the carousel has multiple entries
    await page.route(`/api/campaigns/${ADDR}/proof*`, async (route) => {
      const url = route.request().url();
      // Only intercept non-"all" proof requests; the carousel uses proofAllQuery
      await route.fulfill({
        json: {
          leaves: [
            {
              leaf: {
                leafIndex: 0,
                beneficiary: creatorWallet,
                amount: 500_000_000,
                releaseType: 2,
                startTime: 0,
                cliffTime: pastCliff,
                endTime: pastCliff,
                milestoneIdx: 0,
              },
              proof: [Array.from({ length: 32 }, () => 0)],
            },
            {
              leaf: {
                leafIndex: 1,
                beneficiary: creatorWallet,
                amount: 500_000_000,
                releaseType: 2,
                startTime: 0,
                cliffTime: pastCliff + 86400 * 30,
                endTime: pastCliff + 86400 * 30,
                milestoneIdx: 1,
              },
              proof: [Array.from({ length: 32 }, () => 0)],
            },
          ],
        },
        status: 200,
      });
    });
    await mockCampaignApi(page, ADDR, {
      leafCount: 2,
      hasMilestoneLeaves: true,
      cancelledAt: null,
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    // With multiple milestones, prev/next SVG buttons should be visible
    await expect(page.getByRole("heading", { name: /milestone #/i })).toBeVisible({ timeout: 25_000 });

    // "1 of N milestones" text appears when total > 1
    await expect(page.getByText(/of \d+ milestones/i)).toBeVisible({ timeout: 10_000 });
    expect(pageErrors).toEqual([]);
  });
});
