import { expect, test, type Page } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import {
  csv,
  enableE2eWallet,
  gotoWithRetry,
  openCsvMode,
  parseCsv,
  recipientWallet,
  secondWallet,
  selectSolToken,
} from "./helpers";

const schedules = {
  start: 1779899400,
  cliff: 1779899700,
  end: 1779900000,
};

async function openCsvCreatePage(page: Page, path: string, csvButton?: RegExp) {
  const pageErrors = collectRelevantPageErrors(page);
  await enableE2eWallet(page);
  const response = await gotoWithRetry(page, path);
  expect(response?.ok()).toBe(true);
  await selectSolToken(page);
  await openCsvMode(page, csvButton);
  return pageErrors;
}

test("cliff CSV rejects milestone rows on cliff page", async ({ page }) => {
  const pageErrors = await openCsvCreatePage(page, "/campaign/create/cliff");

  await parseCsv(
    page,
    csv([
      `${recipientWallet},0.001,Milestone,${schedules.start},${schedules.cliff},${schedules.cliff},0`,
    ]),
  );

  await expect(page.getByText(/this page only accepts cliff rows/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /create & fund campaign/i })).toBeDisabled();
  expect(pageErrors).toEqual([]);
});

test("linear CSV rejects cliff rows on linear page", async ({ page }) => {
  const pageErrors = await openCsvCreatePage(page, "/campaign/create/linear");

  await parseCsv(
    page,
    csv([
      `${recipientWallet},0.001,Cliff,${schedules.start},${schedules.cliff},${schedules.cliff},0`,
    ]),
  );

  await expect(page.getByText(/this page only accepts linear rows/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /create & fund campaign/i })).toBeDisabled();
  expect(pageErrors).toEqual([]);
});

test("milestone CSV rejects linear rows on milestone page", async ({ page }) => {
  const pageErrors = await openCsvCreatePage(page, "/campaign/create/milestone", /csv campaign/i);

  await parseCsv(
    page,
    csv([
      `${recipientWallet},0.001,Linear,${schedules.start},${schedules.cliff},${schedules.end},0`,
    ]),
  );

  await expect(page.getByText(/this page only accepts milestone rows/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /create & fund campaign/i })).toBeDisabled();
  expect(pageErrors).toEqual([]);
});

test("cliff and linear CSV reject duplicate recipient wallets", async ({ page }) => {
  let pageErrors = await openCsvCreatePage(page, "/campaign/create/cliff");
  await parseCsv(
    page,
    csv([
      `${recipientWallet},0.001,Cliff,${schedules.start},${schedules.cliff},${schedules.cliff},0`,
      `${recipientWallet},0.002,Cliff,${schedules.start},${schedules.end},${schedules.end},0`,
    ]),
  );

  await expect(page.getByText(/appears more than once/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /create & fund campaign/i })).toBeDisabled();
  expect(pageErrors).toEqual([]);

  pageErrors = await openCsvCreatePage(page, "/campaign/create/linear");
  await parseCsv(
    page,
    csv([
      `${recipientWallet},0.001,Linear,${schedules.start},${schedules.cliff},${schedules.end},0`,
      `${recipientWallet},0.002,Linear,${schedules.start},${schedules.cliff},${schedules.end + 300},0`,
    ]),
  );

  await expect(page.getByText(/appears more than once/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /create & fund campaign/i })).toBeDisabled();
  expect(pageErrors).toEqual([]);
});

test("milestone CSV allows same wallet with different milestone indexes", async ({ page }) => {
  const pageErrors = await openCsvCreatePage(page, "/campaign/create/milestone", /csv campaign/i);

  await parseCsv(
    page,
    csv([
      `${recipientWallet},0.001,Milestone,${schedules.start},${schedules.cliff},${schedules.cliff},0`,
      `${recipientWallet},0.001,Milestone,${schedules.start},${schedules.end},${schedules.end},1`,
      `${secondWallet},0.001,Milestone,${schedules.start},${schedules.end + 300},${schedules.end + 300},2`,
    ]),
  );

  await expect(page.getByText(/this page only accepts/i)).toHaveCount(0);
  await expect(page.getByText("Recipients", { exact: true })).toBeVisible();
  await expect(page.getByText(/milestone leaves/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /create & fund campaign/i })).toBeEnabled();
  expect(pageErrors).toEqual([]);
});

test("milestone CSV rejects duplicate milestone index for same wallet", async ({ page }) => {
  const pageErrors = await openCsvCreatePage(page, "/campaign/create/milestone", /csv campaign/i);

  await parseCsv(
    page,
    csv([
      `${recipientWallet},0.001,Milestone,${schedules.start},${schedules.cliff},${schedules.cliff},0`,
      `${recipientWallet},0.001,Milestone,${schedules.start},${schedules.end},${schedules.end},0`,
    ]),
  );

  await expect(page.getByText(/already uses milestone #0/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /create & fund campaign/i })).toBeDisabled();
  expect(pageErrors).toEqual([]);
});
