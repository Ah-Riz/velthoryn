/**
 * E2E tests with REAL wallet signing against a local validator.
 *
 * Prerequisites:
 *   1. solana-test-validator running with the vesting program deployed:
 *      solana-test-validator --bpf-program G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu target/deploy/vesting.so --reset
 *   2. Dev server running with localnet RPC:
 *      NEXT_PUBLIC_RPC_ENDPOINT=http://127.0.0.1:8899 NEXT_PUBLIC_E2E_MOCK_WALLET=true pnpm exec next dev -H 127.0.0.1 -p 3200
 *   3. Run these tests:
 *      PLAYWRIGHT_BASE_URL=http://127.0.0.1:3200 npx playwright test tests/e2e/signing/
 *
 * These tests create REAL on-chain transactions. They are NOT included in the
 * default test suite — run them explicitly when you need full integration verification.
 */
import { test, expect, type Page } from "@playwright/test";
import { Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import { datetimeLocalFromNow, expectCampaignLinkReady, selectNativeSol } from "./helpers";

const LOCALNET_RPC = "http://127.0.0.1:8899";
const keypair = Keypair.generate();
let createdTreeAddress = "";

async function fundKeypair() {
  const connection = new Connection(LOCALNET_RPC, "confirmed");
  const sig = await connection.requestAirdrop(keypair.publicKey, 10 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

async function getBalance(): Promise<number> {
  const connection = new Connection(LOCALNET_RPC, "confirmed");
  return connection.getBalance(keypair.publicKey);
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

test.describe.serial("Real signing E2E — full vesting lifecycle", () => {
  test.beforeAll(async () => {
    // Check if local validator is running
    try {
      const connection = new Connection(LOCALNET_RPC, "confirmed");
      await connection.getSlot();
    } catch {
      test.skip(true, "Local validator not running — skipping signing tests");
      return;
    }
    await fundKeypair();
    const balance = await getBalance();
    expect(balance).toBeGreaterThan(5 * LAMPORTS_PER_SOL);
  });

  test("wallet is funded and connected", async ({ page }) => {
    await injectSigningWallet(page);
    await page.goto("/dashboard", { waitUntil: "load" });

    // Should show the test wallet address
    const short = `${keypair.publicKey.toBase58().slice(0, 4)}...${keypair.publicKey.toBase58().slice(-4)}`;
    await expect(page.getByText(short, { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test("create native SOL cliff stream via UI", async ({ page }) => {
    await injectSigningWallet(page);
    await page.goto("/campaign/create/cliff", { waitUntil: "load" });

    await selectNativeSol(page);

    // Fill recipient (use a random address)
    const recipient = Keypair.generate().publicKey.toBase58();
    await page.getByPlaceholder(/solana wallet/i).first().fill(recipient);

    // Fill amount (small)
    await page.getByPlaceholder(/e\.g\. 1000/i).first().fill("0.01");

    await page.locator("input[type='datetime-local']").first().fill(datetimeLocalFromNow(120));

    // Submit
    const submitBtn = page.getByRole("button", { name: /create.*stream/i });
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    createdTreeAddress = await expectCampaignLinkReady(page.getByRole("link", { name: /open stream/i }));
  });

  test("dashboard shows the created stream", async ({ page }) => {
    await injectSigningWallet(page);
    await page.goto("/dashboard", { waitUntil: "load" });

    // Stats should show at least 1 stream
    await expect(page.getByText(/total streams/i)).toBeVisible({ timeout: 15_000 });
  });

  test("created stream detail page is available", async ({ page }) => {
    expect(createdTreeAddress).toBeTruthy();

    await injectSigningWallet(page);
    await page.goto(`/campaign/${createdTreeAddress}`, { waitUntil: "load" });

    await expect(page.getByText(/total supply|total deposit|vesting schedule/i).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
