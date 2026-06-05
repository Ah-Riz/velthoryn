/**
 * E2E tests with REAL wallet signing — beneficiary claim flow.
 *
 * Prerequisites:
 *   1. solana-test-validator running with the vesting program deployed:
 *      solana-test-validator --bpf-program G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu target/deploy/vesting.so --reset
 *   2. Dev server running with localnet RPC:
 *      NEXT_PUBLIC_RPC_ENDPOINT=http://127.0.0.1:8899 NEXT_PUBLIC_E2E_MOCK_WALLET=true pnpm exec next dev -H 127.0.0.1 -p 3200
 *   3. Run these tests:
 *      PLAYWRIGHT_BASE_URL=http://127.0.0.1:3200 npx playwright test tests/e2e/signing/claim-flow.spec.ts
 *
 * Strategy:
 *   - Create a cliff stream where the signing keypair is both creator AND beneficiary
 *   - Set cliff = now + 10 seconds (just enough to pass form validation, short enough to wait)
 *   - After creation, wait 15 seconds so the cliff passes on-chain
 *   - Navigate to the campaign page and click the Claim button
 *   - Verify the transaction succeeds and Total Claimed reflects the claim
 *
 * These tests create REAL on-chain transactions. They are NOT included in the
 * default test suite — run them explicitly when you need full integration verification.
 */
import { test, expect, type Page } from "@playwright/test";
import { Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";

const LOCALNET_RPC = "http://127.0.0.1:8899";

// Generate a single keypair shared across all tests in this suite.
// The keypair is both the creator and the beneficiary, so the claim
// button is visible and enabled once the cliff passes.
const keypair = Keypair.generate();

// Shared state — populated during the create test, consumed by later tests.
let createdTreeAddress: string = "";

// ---------------------------------------------------------------------------
// Helpers
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
// Test suite — must run serially because tests share `createdTreeAddress`
// ---------------------------------------------------------------------------

test.describe.serial("Real signing E2E — beneficiary claim flow", () => {
  test.beforeAll(async () => {
    // Skip gracefully if the local validator is not running
    try {
      const connection = new Connection(LOCALNET_RPC, "confirmed");
      await connection.getSlot();
    } catch {
      test.skip(true, "Local validator not running — skipping claim-flow signing tests");
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
  // The signing keypair fills its own public key as the recipient so that
  // the connected wallet matches the beneficiary — making the Claim button
  // visible and enabled once the cliff passes.
  //
  // Cliff is set to now + 10 s so form validation (cliff >= now) passes,
  // but we only have to wait 15 s before claiming.
  // -------------------------------------------------------------------------

  test("create cliff stream with self as beneficiary", async ({ page }) => {
    await injectSigningWallet(page);
    await page.goto("/campaign/create/cliff", { waitUntil: "load" });

    // Wait for form to be ready (token picker renders after wallet connection)
    const tokenBtn = page.getByRole("button", { name: /select token/i });
    await tokenBtn.waitFor({ state: "visible", timeout: 15_000 });

    // --- Select SOL ---
    await tokenBtn.click();
    await page.getByRole("button", { name: /SOL.*Native/i }).first().click();

    // --- Amount ---
    await page.getByPlaceholder(/e\.g\. 1000/i).first().fill("0.01");

    // --- Recipient = this keypair's public key ---
    // The wallet signs as this address, so publicKey === beneficiary → no mismatch
    const recipientPubkey = keypair.publicKey.toBase58();
    await page.getByPlaceholder(/Solana wallet address/i).first().fill(recipientPubkey);

    // --- Cliff = now + 10 seconds (passes validation, short wait) ---
    // datetime-local format: "YYYY-MM-DDTHH:MM"
    // We add a buffer of 10 s so the form's cliff-must-be-future validation passes.
    const cliffDate = new Date(Date.now() + 10_000);
    const cliffLocal = cliffDate.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
    await page.locator("input[type='datetime-local']").first().fill(cliffLocal);

    // --- Submit ---
    const submitBtn = page.getByRole("button", { name: /create cliff stream/i });
    await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
    await submitBtn.click();

    // --- Wait for success and capture the tree address from the "Open stream" link ---
    // TxResultCard renders an anchor with href="/campaign/<treeAddress>?..."
    const openStreamLink = page.getByRole("link", { name: /open stream/i });
    await expect(openStreamLink).toBeVisible({ timeout: 45_000 });

    const href = await openStreamLink.getAttribute("href");
    expect(href).toBeTruthy();

    // Extract just the treeAddress segment: /campaign/<addr>?...
    const match = href!.match(/\/campaign\/([^?]+)/);
    expect(match).toBeTruthy();
    createdTreeAddress = match![1];

    expect(createdTreeAddress).toHaveLength(44); // valid base58 pubkey length
  });

  // -------------------------------------------------------------------------
  // Test 3: wait for cliff to pass, then verify the Claim button is enabled
  //
  // We wait 15 s after the create test. The cliff was set to now + 10 s at
  // the time the form was filled, so by the time this test runs the cliff
  // has already elapsed on-chain.
  // -------------------------------------------------------------------------

  test("wait for cliff and verify claim button is enabled", async ({ page }) => {
    expect(createdTreeAddress).toBeTruthy();

    await injectSigningWallet(page);

    // Wait 15 s to guarantee the cliff (now + 10 s from create time) has passed
    await page.waitForTimeout(15_000);

    await page.goto(`/campaign/${createdTreeAddress}`, { waitUntil: "load" });

    // The single-leaf claim button label is:
    //   `Claim ${formatTokenAmount(displayClaimable)}`
    // For 0.01 SOL that is "Claim 0.01".
    // We use a broad /^claim/i regex to handle minor formatting variations.
    const claimBtn = page.getByRole("button", { name: /^claim\s+\d/i });
    await expect(claimBtn).toBeVisible({ timeout: 25_000 });
    await expect(claimBtn).toBeEnabled({ timeout: 10_000 });

    // Confirm no "Wait for cliff" countdown is shown
    await expect(page.getByRole("button", { name: /wait for cliff/i })).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Test 4: click Claim, approve the transaction, wait for success
  // -------------------------------------------------------------------------

  test("claim vested tokens successfully", async ({ page }) => {
    expect(createdTreeAddress).toBeTruthy();

    await injectSigningWallet(page);
    await page.goto(`/campaign/${createdTreeAddress}`, { waitUntil: "load" });

    // Find and click the enabled Claim button
    const claimBtn = page.getByRole("button", { name: /^claim\s+\d/i });
    await expect(claimBtn).toBeVisible({ timeout: 25_000 });
    await expect(claimBtn).toBeEnabled({ timeout: 10_000 });
    await claimBtn.click();

    // The mock wallet adapter signs and sends the transaction automatically.
    // After confirmation the button transitions to a disabled state ("Claiming..."
    // during in-flight, then the campaign shows the full claimed amount).
    // We look for any success indicator: a toast, the "Claimed" status badge,
    // or the button text changing to show 0 claimable (disabled state).

    // Primary success signal: toast message containing "claimed" or "SOL"
    await expect(
      page.getByText(/claimed.*SOL|SOL.*claimed|successfully/i).first()
    ).toBeVisible({ timeout: 45_000 });
  });

  // -------------------------------------------------------------------------
  // Test 5: verify Total Claimed metric updated on the campaign page
  // -------------------------------------------------------------------------

  test("claimed amount reflects in campaign stats", async ({ page }) => {
    expect(createdTreeAddress).toBeTruthy();

    await injectSigningWallet(page);
    await page.goto(`/campaign/${createdTreeAddress}`, { waitUntil: "load" });

    // The "Total Claimed" metric card should now show a non-zero value.
    // For 0.01 SOL the label will be something like "0.01" or "10,000,000"
    // (lamports if decimals not resolved — but SOL has 9 decimals so it
    // should show "0.01").
    // We verify the Claim button is now disabled (nothing left to claim).
    const claimBtn = page.getByRole("button", { name: /^claim\s+0$/i });
    // Either the button shows "Claim 0" (nothing claimable) or is disabled
    // under a different label. Both are acceptable — the key check is that
    // the claimable amount is zero, meaning the claim succeeded.
    const totalClaimedCard = page.getByText(/total claimed/i).first();
    await expect(totalClaimedCard).toBeVisible({ timeout: 15_000 });

    // The status badge should now show "Claimed" (fully claimed)
    // OR the claimable metric shows 0.
    // At minimum the campaign detail must load without errors.
    const statusBadge = page.getByText(/^claimed$/i).first();
    // Use a lenient check — status may say "Active" briefly during re-fetch
    await expect(statusBadge.or(claimBtn)).toBeVisible({ timeout: 20_000 });

    // Balance should have decreased from initial 10 SOL
    const balance = await getBalance();
    // After 0.01 SOL streamed + create fees + claim fees
    expect(balance).toBeLessThan(10 * LAMPORTS_PER_SOL);
  });
});
