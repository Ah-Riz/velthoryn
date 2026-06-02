import { expect, test, type Page } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import { enableE2eWallet, gotoWithRetry, selectSolToken, openCsvMode, recipientWallet } from "./helpers";

async function openConnectedCreatePage(page: Page, path: string) {
  const pageErrors = collectRelevantPageErrors(page);
  await enableE2eWallet(page);
  await gotoWithRetry(page, path);
  await selectSolToken(page);
  return pageErrors;
}

test.describe("Error messages and validation", () => {
  test("shows insufficient balance warning when amount exceeds wallet balance", async ({ page }) => {
    const pageErrors = await openConnectedCreatePage(page, "/campaign/create/cliff");

    // Fill a very large amount that exceeds the mock wallet balance
    await page.getByPlaceholder(/solana wallet/i).first().fill(recipientWallet);
    await page.getByPlaceholder(/e\.g\. 1000/i).first().fill("999999999");

    // Fill cliff date
    const futureDate = new Date(Date.now() + 86400000 * 30);
    await page.locator("input[type='datetime-local']").first().fill(futureDate.toISOString().slice(0, 16));

    // Should show insufficient balance warning
    await expect(page.getByText(/insufficient balance/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("submit button disabled when balance insufficient", async ({ page }) => {
    const pageErrors = await openConnectedCreatePage(page, "/campaign/create/cliff");

    await page.getByPlaceholder(/solana wallet/i).first().fill(recipientWallet);
    await page.getByPlaceholder(/e\.g\. 1000/i).first().fill("999999999");

    const futureDate = new Date(Date.now() + 86400000 * 30);
    await page.locator("input[type='datetime-local']").first().fill(futureDate.toISOString().slice(0, 16));

    // Button should be disabled due to insufficient balance
    await expect(page.getByRole("button", { name: /create.*stream/i })).toBeDisabled();
    expect(pageErrors).toEqual([]);
  });

  test("CSV parse shows row-level validation errors", async ({ page }) => {
    const pageErrors = await openConnectedCreatePage(page, "/campaign/create/cliff");
    await openCsvMode(page);

    // Invalid CSV with wrong release type
    await page.locator("textarea").fill(
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx\n" +
      `${recipientWallet},0.001,Linear,1779899400,1779899700,1779899700,0`
    );
    await page.getByRole("button", { name: /parse & validate/i }).click();

    await expect(page.getByText(/this page only accepts cliff rows/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("CSV parse shows error for invalid wallet address", async ({ page }) => {
    const pageErrors = await openConnectedCreatePage(page, "/campaign/create/cliff");
    await openCsvMode(page);

    await page.locator("textarea").fill(
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx\n" +
      "INVALID_ADDRESS,0.001,Cliff,1779899400,1779899700,1779899700,0"
    );
    await page.getByRole("button", { name: /parse & validate/i }).click();

    // Should show some validation error
    await expect(page.getByText(/invalid|error|failed/i).first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("empty form shows disabled submit button", async ({ page }) => {
    const pageErrors = await openConnectedCreatePage(page, "/campaign/create/linear");

    await expect(page.getByRole("button", { name: /create.*stream/i })).toBeDisabled();
    expect(pageErrors).toEqual([]);
  });
});
