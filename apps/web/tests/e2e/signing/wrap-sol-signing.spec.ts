/**
 * E2E tests with REAL wallet signing — wrap and unwrap SOL via WrapSolModal.
 *
 * Prerequisites:
 *   1. solana-test-validator running with the vesting program deployed:
 *      solana-test-validator --bpf-program G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu target/deploy/vesting.so --reset
 *   2. Dev server running with localnet RPC:
 *      NEXT_PUBLIC_RPC_ENDPOINT=http://127.0.0.1:8899 NEXT_PUBLIC_E2E_MOCK_WALLET=true pnpm exec next dev -H 127.0.0.1 -p 3200
 *   3. Run these tests:
 *      PLAYWRIGHT_BASE_URL=http://127.0.0.1:3200 npx playwright test tests/e2e/signing/wrap-sol-signing.spec.ts
 *
 * These tests execute REAL on-chain wrap/unwrap transactions against localnet.
 * They are NOT included in the default test suite — run explicitly for integration verification.
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

/** Navigate to /campaign/create/cliff and open the WrapSolModal via TokenPickerModal */
async function openWrapSolModal(page: Page) {
  await page.goto("/campaign/create/cliff", { waitUntil: "load" });

  // Wait for the "Select Token" button to be ready
  const tokenBtn = page.getByRole("button", { name: /select token/i });
  await tokenBtn.waitFor({ state: "visible", timeout: 15_000 });
  await tokenBtn.click();

  // TokenPickerModal is now open — click "⇄ Wrap / Unwrap SOL" at the bottom
  const wrapTrigger = page.getByRole("button", { name: /wrap.*unwrap.*sol/i });
  await wrapTrigger.waitFor({ state: "visible", timeout: 10_000 });
  await wrapTrigger.click();

  // WrapSolModal should be open now
  await expect(page.getByRole("heading", { name: /wrap sol/i })).toBeVisible({ timeout: 10_000 });
}

test.describe.serial("Real signing E2E — wrap and unwrap SOL", () => {
  test.beforeAll(async () => {
    // Skip if local validator is not running
    try {
      const connection = new Connection(LOCALNET_RPC, "confirmed");
      await connection.getSlot();
    } catch {
      test.skip(true, "Local validator not running — skipping wrap/unwrap signing tests");
      return;
    }
    await fundKeypair();
    const balance = await getBalance();
    expect(balance).toBeGreaterThan(5 * LAMPORTS_PER_SOL);
  });

  test("wrap SOL to wSOL via WrapSolModal", async ({ page }) => {
    await injectSigningWallet(page);
    await openWrapSolModal(page);

    // Verify we are in wrap mode by default (Wrap tab active)
    const wrapTab = page.getByRole("button", { name: /^wrap$/i });
    await expect(wrapTab).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: /max:\s*[1-9]/i })).toBeVisible({
      timeout: 30_000,
    });

    // Type amount in the number input
    const amountInput = page.locator("input[type='number']");
    await amountInput.waitFor({ state: "visible", timeout: 5_000 });
    await amountInput.fill("0.01");

    // Click the Wrap submit button
    // The submit button is a standalone <button> below the amount input, not the tab
    // Use a more specific locator: the full-width submit button
    const wrapSubmitBtn = page.locator("button").filter({ hasText: /^Wrap$/ }).last();
    await expect(wrapSubmitBtn).toBeEnabled({ timeout: 5_000 });
    await wrapSubmitBtn.click();

    // Wait for the success state: "Successfully wrapped 0.01 SOL!"
    await expect(
      page.getByText(/successfully wrapped 0\.01 sol/i),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("unwrap wSOL back to SOL via WrapSolModal", async ({ page }) => {
    await injectSigningWallet(page);
    await openWrapSolModal(page);

    // Switch to the Unwrap tab
    const unwrapTab = page.getByRole("button", { name: /^unwrap$/i });
    await unwrapTab.waitFor({ state: "visible", timeout: 5_000 });
    await unwrapTab.click();

    // Verify mode label changed to "Convert wSOL → SOL"
    await expect(page.getByText(/convert wsol.*sol/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: /max:\s*[1-9]/i })).toBeVisible({
      timeout: 15_000,
    });

    // Click Max to use the full wSOL balance we just wrapped
    const maxBtn = page.getByRole("button", { name: /max:/i });
    await maxBtn.waitFor({ state: "visible", timeout: 5_000 });
    await maxBtn.click();

    // The amount input should now show the wSOL balance (non-zero after the wrap test)
    const amountInput = page.locator("input[type='number']");
    const filledAmount = await amountInput.inputValue();
    expect(Number(filledAmount)).toBeGreaterThan(0);

    // Click the Unwrap submit button
    const unwrapSubmitBtn = page.locator("button").filter({ hasText: /^Unwrap$/ }).last();
    await expect(unwrapSubmitBtn).toBeEnabled({ timeout: 5_000 });
    await unwrapSubmitBtn.click();

    // Wait for the success state: "Successfully unwrapped X.XXXX SOL!"
    await expect(
      page.getByText(/successfully unwrapped .+ sol/i),
    ).toBeVisible({ timeout: 30_000 });
  });
});
