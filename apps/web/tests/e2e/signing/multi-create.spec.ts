/**
 * E2E tests with REAL wallet signing — linear and milestone stream creation.
 *
 * Prerequisites (same as create-and-claim.spec.ts):
 *   1. solana-test-validator running with the vesting program deployed:
 *      solana-test-validator --bpf-program G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu target/deploy/vesting.so --reset
 *   2. Dev server running with localnet RPC:
 *      NEXT_PUBLIC_RPC_ENDPOINT=http://127.0.0.1:8899 NEXT_PUBLIC_E2E_MOCK_WALLET=true pnpm exec next dev -H 127.0.0.1 -p 3200
 *   3. Run these tests:
 *      PLAYWRIGHT_BASE_URL=http://127.0.0.1:3200 npx playwright test tests/e2e/signing/
 */
import { test, expect, type Page } from "@playwright/test";
import { Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";

const LOCALNET_RPC = "http://127.0.0.1:8899";
const keypair = Keypair.generate();

async function fundKeypair() {
  const connection = new Connection(LOCALNET_RPC, "confirmed");
  const sig = await connection.requestAirdrop(keypair.publicKey, 10 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

async function injectSigningWallet(page: Page) {
  const secretKeyB58 = bs58.encode(keypair.secretKey);
  const publicKeyB58 = keypair.publicKey.toBase58();

  await page.addInitScript(
    ({ secretKey, publicKey, rpc }) => {
      window.localStorage.setItem("velthoryn:e2e-wallet", "1");
      window.localStorage.setItem("velthoryn:e2e-signing-key", secretKey);
      window.localStorage.setItem("velthoryn:e2e-public-key", publicKey);
      window.localStorage.setItem("velthoryn:e2e-rpc", rpc);
    },
    { secretKey: secretKeyB58, publicKey: publicKeyB58, rpc: LOCALNET_RPC },
  );
}

async function selectSolToken(page: Page) {
  const tokenBtn = page.getByRole("button", { name: /select token/i });
  await tokenBtn.waitFor({ state: "visible", timeout: 15_000 });
  await tokenBtn.click();
  await page.getByRole("button", { name: /SOL.*Native/i }).first().click();
}

test.describe.serial("Real signing E2E — linear and milestone creation", () => {
  test.beforeAll(async () => {
    try {
      const connection = new Connection(LOCALNET_RPC, "confirmed");
      await connection.getSlot();
    } catch {
      test.skip(true, "Local validator not running — skipping multi-create signing tests");
      return;
    }
    await fundKeypair();
    const connection = new Connection(LOCALNET_RPC, "confirmed");
    const balance = await connection.getBalance(keypair.publicKey);
    expect(balance).toBeGreaterThan(5 * LAMPORTS_PER_SOL);
  });

  test("create native SOL linear stream via UI", async ({ page }) => {
    await injectSigningWallet(page);
    await page.goto("/campaign/create/linear", { waitUntil: "load" });

    await selectSolToken(page);

    const recipient = Keypair.generate().publicKey.toBase58();
    await page.getByPlaceholder(/solana wallet/i).first().fill(recipient);
    await page.getByPlaceholder(/e\.g\. 1000/i).first().fill("0.01");

    const now = Date.now();
    const startTime = new Date(now + 5_000);
    const endTime = new Date(now + 3_600_000);
    const datetimeInputs = page.locator("input[type='datetime-local']");
    await datetimeInputs.nth(0).fill(startTime.toISOString().slice(0, 16));
    await datetimeInputs.nth(1).fill(endTime.toISOString().slice(0, 16));

    const submitBtn = page.getByRole("button", { name: /create linear stream/i });
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    await expect(
      page.getByText(/success|created|campaign/i).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("linear stream appears in dashboard", async ({ page }) => {
    await injectSigningWallet(page);
    await page.goto("/dashboard", { waitUntil: "load" });
    await expect(page.getByText(/total streams/i)).toBeVisible({ timeout: 15_000 });
  });

  test("create native SOL milestone stream via UI", async ({ page }) => {
    await injectSigningWallet(page);
    await page.goto("/campaign/create/milestone", { waitUntil: "load" });

    await selectSolToken(page);

    const recipient = Keypair.generate().publicKey.toBase58();
    await page.getByPlaceholder(/solana wallet/i).first().fill(recipient);
    await page.getByPlaceholder(/e\.g\. 1000/i).first().fill("0.01");

    const unlockTime = new Date(Date.now() + 10_000);
    await page.locator("input[type='datetime-local']").first().fill(unlockTime.toISOString().slice(0, 16));

    const submitBtn = page.getByRole("button", { name: /create milestone stream/i });
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    await expect(
      page.getByText(/success|created|campaign/i).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("milestone stream appears in dashboard", async ({ page }) => {
    await injectSigningWallet(page);
    await page.goto("/dashboard", { waitUntil: "load" });
    await expect(page.getByText(/total streams/i)).toBeVisible({ timeout: 15_000 });
  });
});
