import { expect, type Locator, type Page } from "@playwright/test";

function toDatetimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function datetimeLocalFromNow(offsetSeconds: number): string {
  return toDatetimeLocal(new Date(Date.now() + offsetSeconds * 1000));
}

export function alreadyUnlockedDatetimeLocal(): string {
  return datetimeLocalFromNow(-120);
}

export async function selectNativeSol(page: Page) {
  const tokenBtn = page.getByRole("button", { name: /select token/i });
  await tokenBtn.waitFor({ state: "visible", timeout: 20_000 });
  await tokenBtn.click();
  await page.getByRole("button", { name: /SOL.*Native/i }).first().click();
  await expect(page.getByRole("button", { name: /SOL.*Native/i })).toBeVisible();
}

export function treeAddressFromCampaignHref(href: string | null): string {
  if (!href) throw new Error("Campaign link has no href");
  const treeAddress = href.split("/campaign/")[1]?.split("?")[0];
  if (!treeAddress) throw new Error(`Could not parse treeAddress from href: ${href}`);
  return treeAddress;
}

export async function expectCampaignLinkReady(link: Locator) {
  await expect(link).toBeVisible({ timeout: 90_000 });
  const href = await link.getAttribute("href");
  const treeAddress = treeAddressFromCampaignHref(href);
  expect(treeAddress.length).toBeGreaterThan(30);
  return treeAddress;
}

export async function expectClaimActionReady(page: Page) {
  const claimBtn = page.getByRole("button", { name: /^claim\s+\d/i });
  await expect(claimBtn).toBeVisible({ timeout: 30_000 });
  await expect(claimBtn).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /wait for cliff/i })).not.toBeVisible();
  return claimBtn;
}
