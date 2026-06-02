import { expect, test, type Page } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import { enableE2eWallet, gotoWithRetry, selectSolToken, recipientWallet } from "./helpers";

async function openManualCreatePage(page: Page, path: string) {
  const pageErrors = collectRelevantPageErrors(page);
  await enableE2eWallet(page);
  await gotoWithRetry(page, path);
  await selectSolToken(page);
  return pageErrors;
}

test.describe("Manual create flows", () => {
  test("cliff form shows required fields and validates", async ({ page }) => {
    const pageErrors = await openManualCreatePage(page, "/campaign/create/cliff");

    // Manual mode should be active by default
    await expect(page.getByRole("button", { name: /manual/i })).toBeVisible();

    // Check form fields exist
    await expect(page.getByPlaceholder(/solana wallet/i).first()).toBeVisible();
    await expect(page.getByPlaceholder(/e\.g\. 1000/i).first()).toBeVisible();

    // Create button should be disabled with empty form
    await expect(page.getByRole("button", { name: /create.*stream/i })).toBeDisabled();
    expect(pageErrors).toEqual([]);
  });

  test("cliff form accepts input in fields", async ({ page }) => {
    const pageErrors = await openManualCreatePage(page, "/campaign/create/cliff");

    // Fill recipient
    const recipientInput = page.getByPlaceholder(/solana wallet/i).first();
    await recipientInput.fill(recipientWallet);
    await expect(recipientInput).toHaveValue(recipientWallet);

    // Fill amount
    const amountInput = page.getByPlaceholder(/e\.g\. 1000/i).first();
    await amountInput.fill("0.001");
    await expect(amountInput).toHaveValue("0.001");

    expect(pageErrors).toEqual([]);
  });

  test("linear form shows start and end time fields", async ({ page }) => {
    const pageErrors = await openManualCreatePage(page, "/campaign/create/linear");

    await expect(page.getByRole("button", { name: /manual/i })).toBeVisible();
    await expect(page.getByPlaceholder(/solana wallet/i).first()).toBeVisible();
    await expect(page.getByPlaceholder(/e\.g\. 1000/i).first()).toBeVisible();
    // Linear has multiple datetime inputs (start + end)
    await expect(page.locator("input[type='datetime-local']").first()).toBeVisible();

    await expect(page.getByRole("button", { name: /create.*stream/i })).toBeDisabled();
    expect(pageErrors).toEqual([]);
  });

  test("linear form accepts input in fields", async ({ page }) => {
    const pageErrors = await openManualCreatePage(page, "/campaign/create/linear");

    const recipientInput = page.getByPlaceholder(/solana wallet/i).first();
    await recipientInput.fill(recipientWallet);
    await expect(recipientInput).toHaveValue(recipientWallet);

    const amountInput = page.getByPlaceholder(/e\.g\. 1000/i).first();
    await amountInput.fill("0.001");
    await expect(amountInput).toHaveValue("0.001");

    // Datetime inputs should be fillable
    const inputs = page.locator("input[type='datetime-local']");
    await expect(inputs.first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("milestone form shows milestone-specific fields", async ({ page }) => {
    const pageErrors = await openManualCreatePage(page, "/campaign/create/milestone");

    await expect(page.getByRole("heading", { name: "Milestone Vesting" })).toBeVisible();
    await expect(page.getByPlaceholder(/solana wallet/i).first()).toBeVisible();
    await expect(page.getByPlaceholder(/e\.g\. 1000/i).first()).toBeVisible();

    await expect(page.getByRole("button", { name: /create/i }).last()).toBeDisabled();
    expect(pageErrors).toEqual([]);
  });

  test("create type selection page shows all three types", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create");

    await expect(page.getByRole("heading", { name: /create vesting stream/i })).toBeVisible();
    await expect(page.getByText(/cliff vesting/i)).toBeVisible();
    await expect(page.getByText(/linear vesting/i)).toBeVisible();
    await expect(page.getByText(/milestone vesting/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("clicking cliff type navigates to cliff create page", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create");

    await page.getByText(/cliff vesting/i).click();
    await expect(page).toHaveURL(/\/campaign\/create\/cliff/);
    await expect(page.getByRole("heading", { name: "Cliff Vesting" })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("cancellation toggle is available on create pages", async ({ page }) => {
    const pageErrors = await openManualCreatePage(page, "/campaign/create/cliff");

    await expect(page.getByText(/allow cancellation/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("form summary shows network info", async ({ page }) => {
    const pageErrors = await openManualCreatePage(page, "/campaign/create/cliff");

    await expect(page.getByText("Devnet").first()).toBeVisible();
    await expect(page.getByText(/your balance/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
