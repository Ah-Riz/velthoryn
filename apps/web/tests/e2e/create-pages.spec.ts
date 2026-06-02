import { expect, test } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import { gotoWithRetry } from "./helpers";

const createPages = [
  {
    path: "/campaign/create/cliff",
    title: "Cliff Vesting",
    prompt: /connect your wallet to create a cliff vesting stream/i,
  },
  {
    path: "/campaign/create/linear",
    title: "Linear Vesting",
    prompt: /connect your wallet to create a linear vesting stream/i,
  },
  {
    path: "/campaign/create/milestone",
    title: "Milestone Vesting",
    prompt: /connect your wallet to create milestone vesting streams/i,
  },
];

for (const createPage of createPages) {
  test(`${createPage.title} page renders disconnected state`, async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);

    const response = await gotoWithRetry(page, createPage.path);

    expect(response?.ok()).toBe(true);
    await expect(page.getByRole("heading", { name: createPage.title })).toBeVisible();
    await expect(page.getByText(createPage.prompt)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
}
