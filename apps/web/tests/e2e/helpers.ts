import { expect, type Page } from "@playwright/test";

export const creatorWallet = "28FQ5wVeihjGnZw93RctyAtUdtBdd6vGXWUkke49mEAw";
export const recipientWallet = "3coyVxLQYHdQ6MNQRRdm2KuCABJopxPfo9XuQeosUmf3";
export const secondWallet = "11111111111111111111111111111111";
export const nativeSolMint = "11111111111111111111111111111111";

export async function enableE2eWallet(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("velthoryn:e2e-wallet", "1");
  });
}

export async function gotoWithRetry(page: Page, path: string, maxRetries = 3) {
  let lastError: Error | undefined;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await page.goto(path, { timeout: 30_000, waitUntil: "load" });
      if (response?.ok()) return response;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (i < maxRetries - 1) {
        await page.waitForTimeout(1000 * (i + 1));
      }
    }
  }
  throw lastError ?? new Error(`Failed to navigate to ${path}`);
}

export async function selectSolToken(page: Page) {
  const btn = page.getByRole("button", { name: /select token/i });
  await btn.waitFor({ state: "visible", timeout: 15_000 });
  await btn.click();
  await page.getByRole("button", { name: /SOL.*Native/i }).first().click();
  await expect(page.getByRole("button", { name: /SOL.*Native/i })).toBeVisible();
}

export async function openCsvMode(page: Page, label = /use csv|csv campaign/i) {
  await page.getByRole("button", { name: label }).click();
  await expect(page.getByRole("button", { name: /parse & validate/i })).toBeVisible();
}

export async function parseCsv(page: Page, csv: string) {
  await page.locator("textarea").fill(csv);
  await page.getByRole("button", { name: /parse & validate/i }).click();
}

export function csv(rows: string[]) {
  return [
    "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
    ...rows,
  ].join("\n");
}
