/**
 * E2E tests with REAL wallet signing — campaign management actions.
 *
 * Prerequisites (same as create-and-claim.spec.ts):
 *   1. solana-test-validator running with the vesting program deployed:
 *      solana-test-validator --bpf-program G6iaigUdi2btFwUc2N65twf9wA8Ew5uKKhKJ5RJa8wvu target/deploy/vesting.so --reset
 *   2. Dev server running with localnet RPC:
 *      NEXT_PUBLIC_RPC_ENDPOINT=http://127.0.0.1:8899 NEXT_PUBLIC_E2E_MOCK_WALLET=true pnpm exec next dev -H 127.0.0.1 -p 3200
 *   3. Run these tests:
 *      PLAYWRIGHT_BASE_URL=http://127.0.0.1:3200 npx playwright test tests/e2e/signing/
 *
 * Each describe.serial block is self-contained:
 *   - "Pause / Unpause / Cancel" — creates one cancellable campaign (cliff 1hr out),
 *     then pauses it, unpauses it, and finally cancels it.
 *   - "Instant Refund" — creates one cancellable campaign (cliff 30 days out) and
 *     exercises the Instant Refund path in the cancel dialog.
 *
 * Skipped: Withdraw Unvested (requires 7-day on-chain grace period to elapse).
 */

import { test, expect, type Page } from "@playwright/test";
import { Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import { datetimeLocalFromNow, expectCampaignLinkReady, selectNativeSol } from "./helpers";

const LOCALNET_RPC = "http://127.0.0.1:8899";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function checkValidator(): Promise<boolean> {
  try {
    const connection = new Connection(LOCALNET_RPC, "confirmed");
    await connection.getSlot();
    return true;
  } catch {
    return false;
  }
}

async function fundKeypair(keypair: Keypair): Promise<void> {
  const connection = new Connection(LOCALNET_RPC, "confirmed");
  const sig = await connection.requestAirdrop(keypair.publicKey, 10 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

async function injectSigningWallet(page: Page, keypair: Keypair): Promise<void> {
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

/**
 * Navigate to /campaign/create/cliff, fill in a 2-recipient SOL cliff campaign
 * with cancellable = true, submit, wait for the "View campaign" link, click it,
 * and return the treeAddress extracted from the resulting URL.
 *
 * cliffOffsetSeconds — how far in the future to set the cliff (seconds from now).
 */
async function createCancellableSolCampaign(
  page: Page,
  keypair: Keypair,
  cliffOffsetSeconds: number,
): Promise<string> {
  await injectSigningWallet(page, keypair);
  await page.goto("/campaign/create/cliff", { waitUntil: "load" });

  await selectNativeSol(page);

  const cancellableToggle = page.getByText(/allow cancellation/i);
  await cancellableToggle.click();

  // Add a second recipient so the form creates a multi-recipient campaign
  // (bulk-funded path → gives us a treeAddress to navigate to)
  const addRecipientBtn = page.getByRole("button", { name: /add recipient/i }).first();
  await addRecipientBtn.waitFor({ state: "visible", timeout: 10_000 });
  await addRecipientBtn.click();

  // Fill recipient 1
  const recipientInputs = page.getByPlaceholder(/solana wallet address/i);
  const amountInputs = page.getByPlaceholder(/e\.g\. 1000/i);
  const cliffInputs = page.locator("input[type='datetime-local']");

  const cliffValue = datetimeLocalFromNow(cliffOffsetSeconds);

  // Recipient 1
  const rec1 = Keypair.generate().publicKey.toBase58();
  await recipientInputs.nth(0).fill(rec1);
  await amountInputs.nth(0).fill("0.005");
  await cliffInputs.nth(0).fill(cliffValue);

  // Recipient 2
  const rec2 = Keypair.generate().publicKey.toBase58();
  await recipientInputs.nth(1).fill(rec2);
  await amountInputs.nth(1).fill("0.005");
  await cliffInputs.nth(1).fill(cliffValue);

  // Submit — button reads "Create Campaign (2 Recipients)"
  const submitBtn = page.getByRole("button", { name: /create campaign/i });
  await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
  await submitBtn.click();

  // Wait for the "View campaign" link to appear (indicates bulk-funded state)
  return expectCampaignLinkReady(page.getByRole("link", { name: /view campaign/i }));
}

// ---------------------------------------------------------------------------
// Suite 1: Pause → Unpause → Cancel
// ---------------------------------------------------------------------------

test.describe.serial("Real signing E2E — pause, unpause, cancel campaign", () => {
  const keypair = Keypair.generate();
  let treeAddress = "";

  test.beforeAll(async () => {
    const running = await checkValidator();
    if (!running) {
      test.skip(true, "Local validator not running — skipping signing tests");
      return;
    }
    await fundKeypair(keypair);
    const connection = new Connection(LOCALNET_RPC, "confirmed");
    const balance = await connection.getBalance(keypair.publicKey);
    expect(balance).toBeGreaterThan(5 * LAMPORTS_PER_SOL);
  });

  // ------------------------------------------------------------------
  // Step 1: Create campaign
  // ------------------------------------------------------------------
  test("create SOL cliff campaign for action testing (cliff = now + 1hr)", async ({ page }) => {
    // Cliff 1 hour out — still cancellable before cliff
    treeAddress = await createCancellableSolCampaign(page, keypair, 3600);
    expect(treeAddress).toBeTruthy();
    expect(treeAddress.length).toBeGreaterThan(30);
  });

  // ------------------------------------------------------------------
  // Step 2: Pause
  // ------------------------------------------------------------------
  test("pause the campaign", async ({ page }) => {
    expect(treeAddress, "treeAddress must be set by previous test").toBeTruthy();

    await injectSigningWallet(page, keypair);
    await page.goto(`/campaign/${treeAddress}`, { waitUntil: "load" });

    // Campaign should be Active initially
    const pauseBtn = page.getByRole("button", { name: /pause campaign/i });
    await pauseBtn.waitFor({ state: "visible", timeout: 30_000 });

    await pauseBtn.click();

    // Button should go to loading state and then switch to "Unpause Campaign"
    await expect(page.getByRole("button", { name: /unpause campaign/i })).toBeVisible({ timeout: 30_000 });

    // Status badge should show "Paused"
    await expect(page.getByText(/paused/i).first()).toBeVisible({ timeout: 15_000 });
  });

  // ------------------------------------------------------------------
  // Step 3: Unpause
  // ------------------------------------------------------------------
  test("unpause the campaign", async ({ page }) => {
    expect(treeAddress, "treeAddress must be set by previous test").toBeTruthy();

    await injectSigningWallet(page, keypair);
    await page.goto(`/campaign/${treeAddress}`, { waitUntil: "load" });

    // Campaign should be Paused — Unpause button visible
    const unpauseBtn = page.getByRole("button", { name: /unpause campaign/i });
    await unpauseBtn.waitFor({ state: "visible", timeout: 30_000 });

    await unpauseBtn.click();

    // After unpause the button flips back to "Pause Campaign"
    await expect(page.getByRole("button", { name: /pause campaign/i })).toBeVisible({ timeout: 30_000 });

    // Status badge should show "Active"
    await expect(page.getByText(/active/i).first()).toBeVisible({ timeout: 15_000 });
  });

  // ------------------------------------------------------------------
  // Step 4: Cancel the campaign
  // ------------------------------------------------------------------
  test("cancel the campaign", async ({ page }) => {
    expect(treeAddress, "treeAddress must be set by previous test").toBeTruthy();

    await injectSigningWallet(page, keypair);
    await page.goto(`/campaign/${treeAddress}`, { waitUntil: "load" });

    // "Cancel Campaign" button should be visible (multi-leaf, cancellable)
    const cancelBtn = page.getByRole("button", { name: /cancel campaign/i });
    await cancelBtn.waitFor({ state: "visible", timeout: 30_000 });

    await cancelBtn.click();

    // Cancel dialog appears — it shows "Cancel this vesting stream?" heading
    await expect(page.getByText(/cancel this vesting/i)).toBeVisible({ timeout: 10_000 });

    // Dialog defaults to "Grace Period" mode for a multi-leaf campaign not yet refund eligible
    // Confirm button label: "Cancel Stream" (grace mode)
    const confirmBtn = page.getByRole("button", { name: /cancel stream/i });
    await confirmBtn.waitFor({ state: "visible", timeout: 10_000 });
    await confirmBtn.click();

    // Wait for the Cancelled badge
    await expect(page.getByText(/cancelled/i).first()).toBeVisible({ timeout: 45_000 });

    // Cancel Campaign button should be gone
    await expect(page.getByRole("button", { name: /cancel campaign/i })).not.toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Instant Refund (cliff far in future → eligible for refund before cliff)
// ---------------------------------------------------------------------------

test.describe.serial("Real signing E2E — instant refund campaign", () => {
  const keypair = Keypair.generate();
  let treeAddress = "";

  test.beforeAll(async () => {
    const running = await checkValidator();
    if (!running) {
      test.skip(true, "Local validator not running — skipping signing tests");
      return;
    }
    await fundKeypair(keypair);
    const connection = new Connection(LOCALNET_RPC, "confirmed");
    const balance = await connection.getBalance(keypair.publicKey);
    expect(balance).toBeGreaterThan(5 * LAMPORTS_PER_SOL);
  });

  // ------------------------------------------------------------------
  // Step 1: Create campaign with cliff 30 days out (eligible for instant refund)
  // ------------------------------------------------------------------
  test("create SOL cliff campaign for instant refund (cliff = now + 30 days)", async ({ page }) => {
    // Cliff 30 days out — instant refund eligible (not started yet)
    treeAddress = await createCancellableSolCampaign(page, keypair, 86400 * 30);
    expect(treeAddress).toBeTruthy();
    expect(treeAddress.length).toBeGreaterThan(30);
  });

  // ------------------------------------------------------------------
  // Step 2: Instant Refund
  // ------------------------------------------------------------------
  test("instant refund the campaign before cliff", async ({ page }) => {
    expect(treeAddress, "treeAddress must be set by previous test").toBeTruthy();

    await injectSigningWallet(page, keypair);
    await page.goto(`/campaign/${treeAddress}`, { waitUntil: "load" });

    // "Instant Refund" button should be visible (pre-cliff, cancellable multi-leaf)
    const instantRefundBtn = page.getByRole("button", { name: /instant refund/i });
    await instantRefundBtn.waitFor({ state: "visible", timeout: 30_000 });

    await instantRefundBtn.click();

    // Dialog opens — heading says "Instant refund this campaign?"
    await expect(page.getByText(/instant refund this campaign/i)).toBeVisible({ timeout: 10_000 });

    // Confirm button label: "Instant Refund" (amber button)
    const confirmBtn = page.getByRole("button", { name: /^instant refund$/i });
    await confirmBtn.waitFor({ state: "visible", timeout: 10_000 });
    await confirmBtn.click();

    // Wait for success — toast says "Campaign instantly refunded" and badge shows "Refunded"
    await expect(page.getByText(/refunded/i).first()).toBeVisible({ timeout: 45_000 });

    // "Instant Refund" action button should be gone after refund
    await expect(page.getByRole("button", { name: /instant refund/i })).not.toBeVisible({ timeout: 10_000 });
  });
});
