import { expect, test } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import { enableE2eWallet, gotoWithRetry } from "./helpers";

test.describe("Navigation and layout", () => {
  test("sidebar shows all navigation links", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/dashboard");

    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create Stream" })).toBeVisible();
    await expect(page.getByRole("link", { name: "My Campaigns", exact: true })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("sidebar links navigate correctly", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/dashboard");

    await page.getByRole("link", { name: /create stream/i }).click();
    await expect(page).toHaveURL(/\/campaign\/create/);
    await expect(page.getByRole("heading", { name: /create vesting stream/i })).toBeVisible();

    await page.getByRole("link", { name: /my campaigns/i }).click();
    await expect(page).toHaveURL(/\/campaigns/);

    await page.getByRole("link", { name: /dashboard/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    expect(pageErrors).toEqual([]);
  });

  test("header shows network badge", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/dashboard");

    await expect(page.getByText("Devnet").first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("sidebar shows Velthoryn branding", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await gotoWithRetry(page, "/dashboard");

    await expect(page.getByText("Velthoryn").first()).toBeVisible();
    await expect(page.getByText("devnet").first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("create type page links to all vesting types", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create");

    const cliffLink = page.locator("a[href='/campaign/create/cliff']");
    const linearLink = page.locator("a[href='/campaign/create/linear']");
    const milestoneLink = page.locator("a[href='/campaign/create/milestone']");

    await expect(cliffLink).toBeVisible();
    await expect(linearLink).toBeVisible();
    await expect(milestoneLink).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("back to types link works on create pages", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    await page.getByRole("link", { name: /back to types/i }).click();
    await expect(page).toHaveURL(/\/campaign\/create$/);
    expect(pageErrors).toEqual([]);
  });
});
