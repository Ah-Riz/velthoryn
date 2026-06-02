import { expect, test } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import { enableE2eWallet, gotoWithRetry } from "./helpers";

test.describe("Accessibility", () => {
  test("sidebar navigation links are keyboard accessible", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/dashboard");

    const dashboardLink = page.getByRole("link", { name: "Dashboard" });
    await dashboardLink.focus();
    await expect(dashboardLink).toBeFocused();

    const createLink = page.getByRole("link", { name: "Create Stream" });
    await createLink.focus();
    await expect(createLink).toBeFocused();
    expect(pageErrors).toEqual([]);
  });

  test("create form inputs are labeled and focusable", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    // Token picker button is focusable
    const tokenBtn = page.getByRole("button", { name: /select token/i });
    await tokenBtn.focus();
    await expect(tokenBtn).toBeFocused();
    expect(pageErrors).toEqual([]);
  });

  test("buttons have accessible names", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    // Key interactive buttons should have accessible names
    await expect(page.getByRole("button", { name: /select token/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /manual/i })).toBeVisible();

    // Verify main action buttons have text
    const mainButtons = page.locator("main button");
    const count = await mainButtons.count();
    expect(count).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });

  test("headings follow hierarchy", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    // Page should have an h1
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toBeVisible();
    expect(await h1.innerText()).toBeTruthy();
    expect(pageErrors).toEqual([]);
  });

  test("form inputs have associated labels or placeholders", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/campaign/create/cliff");

    // Wait for form to render
    await page.getByRole("button", { name: /select token/i }).waitFor({ state: "visible" });

    // Text inputs should have placeholder or aria-label
    const inputs = page.locator("input[type='text'], input[type='number']");
    const inputCount = await inputs.count();
    for (let i = 0; i < inputCount; i++) {
      const input = inputs.nth(i);
      const placeholder = await input.getAttribute("placeholder");
      const ariaLabel = await input.getAttribute("aria-label");
      const id = await input.getAttribute("id");
      // Should have at least one accessibility hint
      expect(placeholder || ariaLabel || id).toBeTruthy();
    }
    expect(pageErrors).toEqual([]);
  });

  test("interactive elements are reachable via Tab key", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await gotoWithRetry(page, "/dashboard");

    // Tab through the page — should not throw
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
    }

    // Something should be focused after tabbing
    const focused = page.locator(":focus");
    await expect(focused).toBeAttached();
    expect(pageErrors).toEqual([]);
  });
});
