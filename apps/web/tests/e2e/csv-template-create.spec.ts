import { expect, test, type Page } from "@playwright/test";
import { collectRelevantPageErrors } from "./pageErrors";
import { enableE2eWallet, gotoWithRetry, selectSolToken, openCsvMode, csv, parseCsv, recipientWallet, secondWallet } from "./helpers";

const schedules = {
  start: 1779899400,
  cliff: 1779899700,
  end: 1779900000,
};

async function openCsvCreatePage(page: Page, path: string, csvButton?: RegExp) {
  const pageErrors = collectRelevantPageErrors(page);
  await enableE2eWallet(page);
  await gotoWithRetry(page, path);
  await selectSolToken(page);
  await openCsvMode(page, csvButton);
  return pageErrors;
}

test.describe("CSV template and create ready state", () => {
  test("cliff CSV mode shows download template button", async ({ page }) => {
    const pageErrors = await openCsvCreatePage(page, "/campaign/create/cliff");

    await expect(page.getByRole("button", { name: /download.*cliff.*csv.*template/i })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("linear CSV mode shows download template button", async ({ page }) => {
    const pageErrors = await openCsvCreatePage(page, "/campaign/create/linear");

    await expect(page.getByRole("button", { name: /download.*linear.*csv.*template/i })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("milestone CSV mode shows download template button", async ({ page }) => {
    const pageErrors = await openCsvCreatePage(page, "/campaign/create/milestone", /csv campaign/i);

    await expect(page.getByRole("button", { name: /download.*milestone.*csv.*template/i })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("valid cliff CSV enables Create & Fund Campaign button", async ({ page }) => {
    const pageErrors = await openCsvCreatePage(page, "/campaign/create/cliff");

    await parseCsv(
      page,
      csv([
        `${recipientWallet},0.001,Cliff,${schedules.start},${schedules.cliff},${schedules.cliff},0`,
        `${secondWallet},0.002,Cliff,${schedules.start},${schedules.end},${schedules.end},0`,
      ]),
    );

    await expect(page.getByText(/this page only accepts/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /create & fund campaign/i })).toBeEnabled();
    expect(pageErrors).toEqual([]);
  });

  test("valid linear CSV enables Create & Fund Campaign button", async ({ page }) => {
    const pageErrors = await openCsvCreatePage(page, "/campaign/create/linear");

    await parseCsv(
      page,
      csv([
        `${recipientWallet},0.001,Linear,${schedules.start},${schedules.cliff},${schedules.end},0`,
        `${secondWallet},0.002,Linear,${schedules.start},${schedules.cliff},${schedules.end + 300},0`,
      ]),
    );

    await expect(page.getByText(/this page only accepts/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /create & fund campaign/i })).toBeEnabled();
    expect(pageErrors).toEqual([]);
  });

  test("CSV mode shows textarea and parse button", async ({ page }) => {
    const pageErrors = await openCsvCreatePage(page, "/campaign/create/cliff");

    await expect(page.locator("textarea")).toBeVisible();
    await expect(page.getByRole("button", { name: /parse & validate/i })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("CSV mode shows file upload area", async ({ page }) => {
    const pageErrors = await openCsvCreatePage(page, "/campaign/create/cliff");

    await expect(page.getByText(/drop csv file|click to upload/i)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
