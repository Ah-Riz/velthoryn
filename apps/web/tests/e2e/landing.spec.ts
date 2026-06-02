import { expect, test } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import { gotoWithRetry } from "./helpers";

test("landing page renders", async ({ page }) => {
  const pageErrors = collectRelevantPageErrors(page);

  const response = await gotoWithRetry(page, "/");

  expect(response?.ok()).toBe(true);
  await expect(page.getByText("Velthoryn").first()).toBeVisible();
  await expect(page.getByText(/token vesting/i).first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});
