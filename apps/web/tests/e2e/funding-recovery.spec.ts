import { expect, test, type Page } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import { creatorWallet, enableE2eWallet, gotoWithRetry, nativeSolMint } from "./helpers";

const pendingTree = "8wu9j14MDXtkUPHC6EeG4AvfBSDZwVqqSqfNK1LLt1UY";

async function seedPendingFunding(page: Page) {
  await enableE2eWallet(page);
  await page.addInitScript(
    ({ treeAddress, creator, mint }) => {
      window.localStorage.setItem(
        `velthoryn:pending-fund:${treeAddress}`,
        JSON.stringify({
          treeAddress,
          creator,
          mint,
          totalSupply: "3000000",
          createSig: "e2eCreateSignature",
          createdAt: Date.now(),
        }),
      );
    },
    { treeAddress: pendingTree, creator: creatorWallet, mint: nativeSolMint },
  );
}

for (const createPage of [
  { path: "/campaign/create/cliff", title: "Cliff Vesting" },
  { path: "/campaign/create/linear", title: "Linear Vesting" },
  { path: "/campaign/create/milestone", title: "Milestone Vesting" },
]) {
  test(`${createPage.title} shows creator pending funding recovery`, async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    await seedPendingFunding(page);

    const response = await gotoWithRetry(page, createPage.path);

    expect(response?.ok()).toBe(true);
    await expect(page.getByRole("heading", { name: createPage.title })).toBeVisible();
    await expect(page.getByText("Unfunded Campaigns")).toBeVisible();
    await expect(page.getByText(pendingTree)).toBeVisible();
    await expect(page.getByText("Total to fund: 0.003 SOL")).toBeVisible();
    await expect(page.getByText(/raw units/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /resume funding/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /view campaign/i })).toHaveAttribute(
      "href",
      `/campaign/${pendingTree}`,
    );
    expect(pageErrors).toEqual([]);
  });
}
