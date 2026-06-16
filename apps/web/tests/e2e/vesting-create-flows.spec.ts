/**
 * E2E coverage for create flows:
 * - Cliff stream (single recipient)
 * - Linear stream (single recipient)
 * - Milestone stream
 * - Multi-recipient (campaign) via CSV
 *
 * Tests validate form fields, validation rules, and button states.
 * No real tx is submitted — tests verify UI gating logic.
 */
import { expect, test } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import {
  enableE2eWallet,
  gotoWithRetry,
  selectSolToken,
  fillCliffSchedule,
  fillLinearSchedule,
  openCsvMode,
  parseCsv,
  csv,
} from "./helpers";

// ---------------------------------------------------------------------------
// Cliff vesting — create stream
// ---------------------------------------------------------------------------

test.describe("Cliff vesting — create stream", () => {
  test("cliff form shows Recipient, Amount, Cliff Date fields", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    await expect(page.getByPlaceholder(/solana wallet/i).first()).toBeVisible();
    await expect(page.getByPlaceholder(/e\.g\. 1000/i).first()).toBeVisible();
    await expect(page.locator("input[type='datetime-local']").first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("cliff Create Stream button disabled until all fields filled", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    await expect(page.getByRole("button", { name: /create.*stream/i })).toBeDisabled();
    expect(pageErrors).toEqual([]);
  });

  test("cliff Create Stream button enabled after valid single-recipient form", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    await selectSolToken(page);
    await fillCliffSchedule(page);

    await page.getByPlaceholder(/solana wallet/i).first().fill("3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3");
    await page.getByPlaceholder(/e\.g\. 1000/i).first().fill("0.001");

    await expect(page.getByRole("button", { name: /create.*stream/i })).toBeEnabled({ timeout: 5_000 });
    expect(pageErrors).toEqual([]);
  });

  test("cliff CSV mode: valid CSV enables Create & Fund Campaign button", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    await selectSolToken(page);
    await fillCliffSchedule(page);
    await openCsvMode(page);
    await parseCsv(
      page,
      csv([`3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3,0.001,Cliff`]),
    );

    await expect(page.getByRole("button", { name: /create & fund campaign/i })).toBeEnabled({ timeout: 10_000 });
    expect(pageErrors).toEqual([]);
  });

  test("cliff CSV rejects rows with wrong release type", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    await selectSolToken(page);
    await fillCliffSchedule(page);
    await openCsvMode(page);
    // releaseType=Linear on cliff page should fail
    await parseCsv(
      page,
      csv([`3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3,0.001,Linear`]),
    );

    await expect(page.getByRole("button", { name: /create & fund campaign/i })).toBeDisabled({ timeout: 10_000 });
    expect(pageErrors).toEqual([]);
  });

  test("cliff form shows Cancellable toggle", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    // Cancellable toggle should be present
    const toggle = page.locator("input[type='checkbox']").first();
    await expect(toggle).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Linear vesting — create stream
// ---------------------------------------------------------------------------

test.describe("Linear vesting — create stream", () => {
  test("linear form shows Recipient, Amount, Start Date, End Date fields", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/linear");

    await expect(page.getByPlaceholder(/solana wallet/i).first()).toBeVisible();
    await expect(page.getByPlaceholder(/e\.g\. 1000/i).first()).toBeVisible();
    // Linear has start + end time
    const datetimeInputs = page.locator("input[type='datetime-local']");
    await expect(datetimeInputs.nth(0)).toBeVisible();
    await expect(datetimeInputs.nth(1)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("linear Create Stream button disabled until all fields filled", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/linear");

    await expect(page.getByRole("button", { name: /create.*stream/i })).toBeDisabled();
    expect(pageErrors).toEqual([]);
  });

  test("linear Create Stream button enabled after valid single-recipient form", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/linear");

    await selectSolToken(page);
    await fillLinearSchedule(page);
    await page.getByPlaceholder(/solana wallet/i).first().fill("3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3");
    await page.getByPlaceholder(/e\.g\. 1000/i).first().fill("0.001");

    await expect(page.getByRole("button", { name: /create.*stream/i })).toBeEnabled({ timeout: 5_000 });
    expect(pageErrors).toEqual([]);
  });

  test("linear CSV mode: valid CSV enables Create & Fund Campaign button", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/linear");

    await selectSolToken(page);
    await fillLinearSchedule(page);
    await openCsvMode(page);
    await parseCsv(
      page,
      csv([`3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3,0.001,Linear`]),
    );
    await expect(page.getByRole("button", { name: /create & fund campaign/i })).toBeEnabled({ timeout: 10_000 });
    expect(pageErrors).toEqual([]);
  });

  test("linear CSV rejects duplicate recipients", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/linear");

    await selectSolToken(page);
    await fillLinearSchedule(page);
    await openCsvMode(page);
    const row = `3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3,0.001,Linear`;
    await parseCsv(page, csv([row, row])); // same wallet twice

    await expect(page.getByRole("button", { name: /create & fund campaign/i })).toBeDisabled({ timeout: 10_000 });
    expect(pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Milestone vesting — create stream
// ---------------------------------------------------------------------------

test.describe("Milestone vesting — create stream", () => {
  test("milestone form shows milestone-specific fields", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/milestone");

    // Milestone form has a cliff date field (unlock date per milestone)
    await expect(page.getByPlaceholder(/solana wallet/i).first()).toBeVisible();
    await expect(page.getByPlaceholder(/e\.g\. 1000/i).first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("milestone Create Stream button disabled until all fields filled", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/milestone");

    await expect(page.getByRole("button", { name: /create.*stream/i })).toBeDisabled();
    expect(pageErrors).toEqual([]);
  });

  test("milestone CSV allows same wallet with different milestone indexes", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/milestone");

    await openCsvMode(page, /csv campaign/i);
    const cliffTs = String(Math.floor(Date.now() / 1000) + 86400 * 30);
    // Same wallet, different milestoneIdx (0 and 1) — should be valid
    const row0 = `3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3,500000,2,0,${cliffTs},${cliffTs},0`;
    const row1 = `3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3,500000,2,0,${cliffTs},${cliffTs},1`;
    await parseCsv(page, csv([row0, row1]));

    await selectSolToken(page);
    await expect(page.getByRole("button", { name: /create & fund campaign/i })).toBeEnabled({ timeout: 10_000 });
    expect(pageErrors).toEqual([]);
  });

  test("milestone CSV rejects duplicate milestone index for same wallet", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/milestone");

    await openCsvMode(page, /csv campaign/i);
    const cliffTs = String(Math.floor(Date.now() / 1000) + 86400 * 30);
    // Same wallet, SAME milestoneIdx — should fail
    const row = `3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3,500000,2,0,${cliffTs},${cliffTs},0`;
    await parseCsv(page, csv([row, row]));

    await expect(page.getByRole("button", { name: /create & fund campaign/i })).toBeDisabled({ timeout: 10_000 });
    expect(pageErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Create type selection page
// ---------------------------------------------------------------------------

test.describe("Create type selection", () => {
  test("shows all three vesting types: Cliff, Linear, Milestone", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create");

    await expect(page.getByText(/cliff/i).first()).toBeVisible();
    await expect(page.getByText(/linear/i).first()).toBeVisible();
    await expect(page.getByText(/milestone/i).first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("clicking Cliff navigates to cliff create page", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create");

    await page.getByRole("link", { name: /cliff/i }).first().click();
    await expect(page).toHaveURL(/\/campaign\/create\/cliff/);
    expect(pageErrors).toEqual([]);
  });

  test("clicking Linear navigates to linear create page", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create");

    await page.getByRole("link", { name: /linear/i }).first().click();
    await expect(page).toHaveURL(/\/campaign\/create\/linear/);
    expect(pageErrors).toEqual([]);
  });

  test("clicking Milestone navigates to milestone create page", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create");

    await page.getByRole("link", { name: /milestone/i }).first().click();
    await expect(page).toHaveURL(/\/campaign\/create\/milestone/);
    expect(pageErrors).toEqual([]);
  });
});
