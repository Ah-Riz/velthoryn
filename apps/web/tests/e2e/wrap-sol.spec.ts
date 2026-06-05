import { expect, test } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import { enableE2eWallet, gotoWithRetry } from "./helpers";

const CREATE_PATH = "/campaign/create/cliff";

async function openTokenPicker(page: Parameters<typeof gotoWithRetry>[0]) {
  await gotoWithRetry(page, CREATE_PATH);
  const tokenBtn = page.getByRole("button", { name: /select token/i });
  await tokenBtn.waitFor({ state: "visible", timeout: 15_000 });
  await tokenBtn.click();
  await expect(page.getByRole("dialog").first().or(page.locator("[class*='modal'], [class*='picker']").first())).toBeVisible({ timeout: 10_000 }).catch(() => {
    // TokenPickerModal may not use role=dialog; just wait for search input
  });
}

async function openWrapModal(page: Parameters<typeof gotoWithRetry>[0]) {
  await openTokenPicker(page);
  const wrapTrigger = page.getByRole("button", { name: /wrap.*unwrap.*sol/i });
  await wrapTrigger.waitFor({ state: "visible", timeout: 15_000 });
  await wrapTrigger.click();
  await expect(page.getByRole("heading", { name: /wrap sol/i })).toBeVisible({ timeout: 10_000 });
}

test.describe("WrapSolModal — opening trigger", () => {
  test("token picker shows Wrap / Unwrap SOL button", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await openTokenPicker(page);

    await expect(page.getByRole("button", { name: /wrap.*unwrap.*sol/i })).toBeVisible({ timeout: 15_000 });
    expect(pageErrors).toEqual([]);
  });

  test("clicking Wrap / Unwrap SOL opens WrapSolModal", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await openWrapModal(page);

    await expect(page.getByRole("heading", { name: /wrap sol/i })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});

test.describe("WrapSolModal — content", () => {
  test("shows SOL Balance and wSOL Balance rows", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await openWrapModal(page);

    await expect(page.getByText('SOL Balance', { exact: true })).toBeVisible();
    await expect(page.getByText('wSOL Balance', { exact: true })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("shows amount input with 0.0 placeholder", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await openWrapModal(page);

    await expect(page.getByPlaceholder("0.0")).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("amount input accepts numeric value", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await openWrapModal(page);

    await page.getByPlaceholder("0.0").fill("0.5");
    await expect(page.getByPlaceholder("0.0")).toHaveValue("0.5");
    expect(pageErrors).toEqual([]);
  });

  test("shows description text about wSOL", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await openWrapModal(page);

    await expect(page.getByText(/sol is automatically wrapped/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});

test.describe("WrapSolModal — Wrap/Unwrap tab toggle", () => {
  test("default mode shows Convert SOL → wSOL label", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await openWrapModal(page);

    await expect(page.getByText(/convert sol.*wsol/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("clicking Unwrap tab switches mode to Convert wSOL → SOL", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await openWrapModal(page);

    await page.getByRole("button", { name: /^unwrap$/i }).click();
    await expect(page.getByText(/convert wsol.*sol/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("switching back to Wrap restores Convert SOL → wSOL label", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await openWrapModal(page);

    await page.getByRole("button", { name: /^unwrap$/i }).click();
    await page.getByRole("button", { name: /^wrap$/i }).click();
    await expect(page.getByText(/convert sol.*wsol/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("switching mode clears amount input", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await openWrapModal(page);

    await page.getByPlaceholder("0.0").fill("1.0");
    await page.getByRole("button", { name: /^unwrap$/i }).click();
    await expect(page.getByPlaceholder("0.0")).toHaveValue("");
    expect(pageErrors).toEqual([]);
  });
});

test.describe("WrapSolModal — submit button", () => {
  test("submit button disabled when amount empty", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await openWrapModal(page);

    // Submit button is last button with text Wrap (tabs also say Wrap, so use last)
    const submitBtn = page.getByRole("button", { name: /^wrap$/i }).last();
    await expect(submitBtn).toBeDisabled();
    expect(pageErrors).toEqual([]);
  });

  test("submit button label matches Wrap mode", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await openWrapModal(page);

    const submitBtn = page.getByRole("button", { name: /^wrap$/i }).last();
    await expect(submitBtn).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("submit button label changes to Unwrap in unwrap mode", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await openWrapModal(page);

    await page.getByRole("button", { name: /^unwrap$/i }).first().click();
    const submitBtn = page.getByRole("button", { name: /^unwrap$/i }).last();
    await expect(submitBtn).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});

test.describe("WrapSolModal — Max button", () => {
  test("Max button is visible", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await openWrapModal(page);

    // Scope to WrapSolModal container (z-[60]) to avoid matching the form's Max button underneath
    const wrapModal = page.locator('div[class*="z-[60]"]');
    await expect(wrapModal.getByRole("button", { name: /max/i })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});

test.describe("WrapSolModal — close button", () => {
  test("X button dismisses the WrapSolModal", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await enableE2eWallet(page);
    await openWrapModal(page);

    // The close button is an SVG button in the modal header
    await page.locator("[class*='z-\\[60\\]'] button").first().click();
    await expect(page.getByRole("heading", { name: /wrap sol/i })).not.toBeVisible({ timeout: 5_000 });
    expect(pageErrors).toEqual([]);
  });
});
