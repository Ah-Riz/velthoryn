/**
 * E2E tests with REAL wallet signing — CloseClaimRecordButton flow.
 *
 * Prerequisites:
 *   1. solana-test-validator running with the vesting program deployed:
 *      solana-test-validator --bpf-program G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu target/deploy/vesting.so --reset
 *   2. Dev server running with localnet RPC:
 *      NEXT_PUBLIC_RPC_ENDPOINT=http://127.0.0.1:8899 NEXT_PUBLIC_E2E_MOCK_WALLET=true pnpm exec next dev -H 127.0.0.1 -p 3200
 *   3. Run this test:
 *      PLAYWRIGHT_BASE_URL=http://127.0.0.1:3200 npx playwright test tests/e2e/signing/close-claim-record.spec.ts
 *
 * Strategy:
 *   - Create a cliff stream where the signing keypair is both creator AND beneficiary
 *   - Set cliff = now + 10 s, wait 15 s so the cliff passes on-chain
 *   - Claim all vested tokens
 *   - After claiming, navigate back to the campaign and verify that
 *     "Close Record & Reclaim Rent (~0.002 SOL)" is visible
 *   - Click the button and verify the success toast "Claim record closed. Rent reclaimed."
 *   - Verify the button disappears (the component returns null once onSuccess fires)
 *
 * These tests create REAL on-chain transactions. They are NOT included in the
 * default test suite — run them explicitly when you need full integration verification.
 */
import { test, expect, type Page } from "@playwright/test";
import { Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import { alreadyUnlockedDatetimeLocal, expectCampaignLinkReady, expectClaimActionReady, selectNativeSol } from "./helpers";

const LOCALNET_RPC = "http://127.0.0.1:8899";

// Fresh keypair — both creator and beneficiary so the claim / close buttons are visible.
const keypair = Keypair.generate();

// Shared state populated during the create step and consumed by later steps.
let createdTreeAddress: string = "";

// ---------------------------------------------------------------------------
// Helpers (mirrors claim-flow.spec.ts)
// ---------------------------------------------------------------------------

async function fundKeypair() {
  const connection = new Connection(LOCALNET_RPC, "confirmed");
  const sig = await connection.requestAirdrop(keypair.publicKey, 10 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

async function getBalance(): Promise<number> {
  const connection = new Connection(LOCALNET_RPC, "confirmed");
  return connection.getBalance(keypair.publicKey);
}

/**
 * Inject the test keypair into localStorage so the app's mock wallet adapter
 * picks it up and uses it for signing real transactions.
 */
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

// ---------------------------------------------------------------------------
// Test suite — serial because tests share createdTreeAddress
// ---------------------------------------------------------------------------

test.describe.serial("Real signing E2E — CloseClaimRecordButton flow", () => {
  test.beforeAll(async () => {
    // Skip gracefully if the local validator is not running
    try {
      const connection = new Connection(LOCALNET_RPC, "confirmed");
      await connection.getSlot();
    } catch {
      test.skip(true, "Local validator not running — skipping close-claim-record signing tests");
      return;
    }

    await fundKeypair();

    const balance = await getBalance();
    expect(balance).toBeGreaterThan(5 * LAMPORTS_PER_SOL);
  });

  // -------------------------------------------------------------------------
  // Test 1: wallet is connected and funded
  // -------------------------------------------------------------------------

  test("wallet is funded and connected", async ({ page }) => {
    await injectSigningWallet(page);
    await page.goto("/dashboard", { waitUntil: "load" });

    const short = `${keypair.publicKey.toBase58().slice(0, 4)}...${keypair.publicKey.toBase58().slice(-4)}`;
    await expect(page.getByText(short, { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  // -------------------------------------------------------------------------
  // Test 2: create cliff stream with self as beneficiary
  //
  // Cliff = now + 10 s so form validation passes, but we only wait 15 s.
  // -------------------------------------------------------------------------

  test("create cliff stream with self as beneficiary", async ({ page }) => {
    await injectSigningWallet(page);
    await page.goto("/campaign/create/cliff", { waitUntil: "load" });

    await selectNativeSol(page);

    // --- Amount ---
    await page.getByPlaceholder(/e\.g\. 1000/i).first().fill("0.01");

    // --- Recipient = this keypair (self) ---
    const recipientPubkey = keypair.publicKey.toBase58();
    await page.getByPlaceholder(/Solana wallet address/i).first().fill(recipientPubkey);

    await page.locator("input[type='datetime-local']").first().fill(alreadyUnlockedDatetimeLocal());

    // --- Submit ---
    const submitBtn = page.getByRole("button", { name: /create cliff stream/i });
    await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
    await submitBtn.click();

    // --- Capture tree address from the post-create link ---
    createdTreeAddress = await expectCampaignLinkReady(page.getByRole("link", { name: /open stream/i }));

    expect(createdTreeAddress).toHaveLength(44);
  });

  // -------------------------------------------------------------------------
  // Test 3: wait for cliff, then claim all vested tokens
  // -------------------------------------------------------------------------

  test("claim all vested tokens after cliff passes", async ({ page }) => {
    expect(createdTreeAddress).toBeTruthy();

    await injectSigningWallet(page);

    await page.goto(`/campaign/${createdTreeAddress}`, { waitUntil: "load" });

    const claimBtn = await expectClaimActionReady(page);
    await claimBtn.click();

    // Wait for the success signal: toast or UI update mentioning claim/SOL
    await expect(
      page.getByText(/claimed.*SOL|SOL.*claimed|successfully/i).first()
    ).toBeVisible({ timeout: 45_000 });
  });

  // -------------------------------------------------------------------------
  // Test 4: Close Record & Reclaim Rent button is visible after full claim
  //
  // CloseClaimRecordButton only renders when claimedAmount >= totalEntitled.
  // After the claim above, the button should appear with the exact text:
  //   "Close Record & Reclaim Rent (~0.002 SOL)"
  // -------------------------------------------------------------------------

  test("CloseClaimRecordButton is visible after full claim", async ({ page }) => {
    expect(createdTreeAddress).toBeTruthy();

    await injectSigningWallet(page);

    // Re-navigate to pick up the post-claim UI state
    await page.goto(`/campaign/${createdTreeAddress}`, { waitUntil: "load" });

    const closeBtn = page.getByRole("button", { name: /close record & reclaim rent/i });
    await expect(closeBtn).toBeVisible({ timeout: 30_000 });
    await expect(closeBtn).toBeEnabled();
  });

  // -------------------------------------------------------------------------
  // Test 5: clicking the button sends closeClaimRecord tx and shows success
  //
  // Success toast text (from CloseClaimRecordButton.tsx):
  //   "Claim record closed. Rent reclaimed."
  // After onSuccess() fires the component re-renders (parent refreshes state)
  // and the button disappears because fullyClaimed check re-runs.
  // -------------------------------------------------------------------------

  test("closeClaimRecord succeeds and button disappears", async ({ page }) => {
    expect(createdTreeAddress).toBeTruthy();

    await injectSigningWallet(page);
    await page.goto(`/campaign/${createdTreeAddress}`, { waitUntil: "load" });

    const closeBtn = page.getByRole("button", { name: /close record & reclaim rent/i });
    await expect(closeBtn).toBeVisible({ timeout: 15_000 });
    await expect(closeBtn).toBeEnabled();

    await closeBtn.click();

    // Button enters "Closing..." loading state while the tx is in-flight
    await expect(
      page.getByRole("button", { name: /closing\.\.\./i })
    ).toBeVisible({ timeout: 5_000 }).catch(() => {
      // Loading flash is very short; not a hard failure if we miss it
    });

    // Primary success signal: the toast message from CloseClaimRecordButton
    await expect(
      page.getByText("Claim record closed. Rent reclaimed.")
    ).toBeVisible({ timeout: 30_000 });

    // After onSuccess() the parent re-fetches chain state; the button should
    // no longer be rendered (claimRecord PDA is closed, so claimedAmount is
    // reset / the PDA no longer exists and the component returns null).
    await expect(
      page.getByRole("button", { name: /close record & reclaim rent/i })
    ).not.toBeVisible({ timeout: 15_000 });
  });

  // -------------------------------------------------------------------------
  // Test 6: closed record state persists after refresh
  // -------------------------------------------------------------------------

  test("closed claim record state persists after refresh", async ({ page }) => {
    expect(createdTreeAddress).toBeTruthy();

    await injectSigningWallet(page);
    await page.goto(`/campaign/${createdTreeAddress}`, { waitUntil: "load" });

    await expect(page.getByText(/^claimed$/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /close record & reclaim rent/i })).not.toBeVisible();
  });
});
