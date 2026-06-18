/**
 * E2E tests with REAL wallet signing — single-leaf cancel stream.
 *
 * Prerequisites (same as create-and-claim.spec.ts):
 *   1. solana-test-validator running with the vesting program deployed:
 *      solana-test-validator --bpf-program G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu target/deploy/vesting.so --reset
 *   2. Dev server running with localnet RPC:
 *      NEXT_PUBLIC_RPC_ENDPOINT=http://127.0.0.1:8899 NEXT_PUBLIC_E2E_MOCK_WALLET=true pnpm exec next dev -H 127.0.0.1 -p 3200
 *   3. Run these tests:
 *      PLAYWRIGHT_BASE_URL=http://127.0.0.1:3200 npx playwright test tests/e2e/signing/cancel-stream.spec.ts
 *
 * Single-leaf cancel stream is DIFFERENT from cancel campaign:
 *   - 1 recipient (the creator themselves), so leafCount === 1 → isSingleLeaf = true
 *   - Cancel dialog shows in "stream" mode with an "Instant Settle" / "Grace Period" toggle
 *   - The trigger button on the campaign detail page reads "Cancel Stream" (not "Cancel Campaign")
 *   - Dialog confirm button: "Cancel & Settle" (instant mode, schedule loaded) or
 *     "Cancel Stream" (grace period fallback when schedule params not loaded)
 *   - This exercises the cancelStream instruction (distinct from cancelCampaign on multi-leaf)
 */

import { test, expect, type Page } from "@playwright/test";
import { Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";

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
 * Navigate to /campaign/create/cliff, fill a single-recipient SOL cliff campaign
 * with the creator as the sole beneficiary (self-vesting) and cancellable = true.
 * Returns the treeAddress extracted from the "Open stream" link href.
 *
 * cliffOffsetSeconds — how far in the future to set the cliff (seconds from now).
 */
async function createSingleLeafCancellableCampaign(
  page: Page,
  keypair: Keypair,
  cliffOffsetSeconds: number,
): Promise<string> {
  await injectSigningWallet(page, keypair);
  await page.goto("/campaign/create/cliff", { waitUntil: "load" });

  // Wait for the form to be ready
  const tokenBtn = page.getByRole("button", { name: /select token/i });
  await tokenBtn.waitFor({ state: "visible", timeout: 20_000 });

  // Select native SOL
  await tokenBtn.click();
  await page.getByRole("button", { name: /SOL.*Native/i }).first().click();

  // Fill recipient with creator's own public key (self = single-leaf)
  const recipientInput = page.getByPlaceholder(/solana wallet/i).first();
  await recipientInput.waitFor({ state: "visible", timeout: 10_000 });
  await recipientInput.fill(keypair.publicKey.toBase58());

  // Fill amount — small enough to not drain funds
  await page.getByPlaceholder(/e\.g\. 1000/i).first().fill("0.05");

  // Fill cliff datetime (offset from now)
  const cliff = new Date(Date.now() + cliffOffsetSeconds * 1000);
  const cliffValue = cliff.toISOString().slice(0, 16);
  await page.locator("input[type='datetime-local']").first().fill(cliffValue);

  // Enable cancellable toggle — label reads "Allow cancellation"
  const cancellableToggle = page.getByText(/allow cancellation/i);
  await cancellableToggle.waitFor({ state: "visible", timeout: 10_000 });
  await cancellableToggle.click();

  // Submit — single recipient → button reads "Create Cliff Stream"
  const submitBtn = page.getByRole("button", { name: /create cliff stream/i });
  await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
  await submitBtn.click();

  // Wait for the "Open stream" link to appear (single-stream success state)
  const openStreamLink = page.getByRole("link", { name: /open stream/i }).first();
  await openStreamLink.waitFor({ state: "visible", timeout: 60_000 });

  // Extract treeAddress from the href — format: /campaign/<treeAddress>?<params>
  const href = await openStreamLink.getAttribute("href");
  if (!href) throw new Error("Open stream link has no href");
  const treeAddress = href.split("/campaign/")[1]?.split("?")[0];
  if (!treeAddress) throw new Error(`Could not parse treeAddress from href: ${href}`);

  return treeAddress;
}

// ---------------------------------------------------------------------------
// Suite: Create single-leaf stream → Cancel Stream (Instant Settle)
// ---------------------------------------------------------------------------

test.describe.serial("Real signing E2E — single-leaf cancel stream", () => {
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
  // Step 1: Create a single-leaf cancellable cliff stream (creator = beneficiary)
  // ------------------------------------------------------------------
  test("create single-leaf SOL cliff stream (self-vesting, cliff = now + 1hr)", async ({ page }) => {
    // Cliff 1 hour out — not yet started → cancellable before cliff
    treeAddress = await createSingleLeafCancellableCampaign(page, keypair, 3600);
    expect(treeAddress).toBeTruthy();
    expect(treeAddress.length).toBeGreaterThan(30);
  });

  // ------------------------------------------------------------------
  // Step 2: Verify campaign detail shows "Cancel Stream" trigger button
  // ------------------------------------------------------------------
  test("campaign detail page shows 'Cancel Stream' button for single-leaf", async ({ page }) => {
    expect(treeAddress, "treeAddress must be set by previous test").toBeTruthy();

    await injectSigningWallet(page, keypair);
    await page.goto(`/campaign/${treeAddress}`, { waitUntil: "load" });

    // Single-leaf campaigns show "Cancel Stream" (not "Cancel Campaign")
    const cancelStreamBtn = page.getByRole("button", { name: /^cancel stream$/i });
    await cancelStreamBtn.waitFor({ state: "visible", timeout: 30_000 });
    await expect(cancelStreamBtn).toBeEnabled();
  });

  // ------------------------------------------------------------------
  // Step 3: Cancel the stream via dialog — Instant Settle path
  // ------------------------------------------------------------------
  test("cancel stream via dialog — instant settle or grace period", async ({ page }) => {
    expect(treeAddress, "treeAddress must be set by previous test").toBeTruthy();

    await injectSigningWallet(page, keypair);
    await page.goto(`/campaign/${treeAddress}`, { waitUntil: "load" });

    // Click the "Cancel Stream" trigger button
    const cancelStreamBtn = page.getByRole("button", { name: /^cancel stream$/i });
    await cancelStreamBtn.waitFor({ state: "visible", timeout: 30_000 });
    await cancelStreamBtn.click();

    // Dialog opens — heading: "Cancel this vesting stream?"
    // Scope lookups to the dialog to avoid collision with the "Cancel Stream" trigger button
    // (which stays in the DOM behind the overlay and has the same accessible name).
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 10_000 });

    // Confirm button is either:
    //   "Cancel & Settle"  — when schedule is loaded (instant mode, default)
    //   "Cancel Stream"    — when schedule not loaded (grace period fallback)
    const cancelAndSettleBtn = dialog.getByRole("button", { name: /cancel & settle/i });
    const cancelStreamConfirmBtn = dialog.getByRole("button", { name: /cancel stream/i });

    // Wait for one of the two confirm buttons to be visible
    await Promise.race([
      cancelAndSettleBtn.waitFor({ state: "visible", timeout: 15_000 }).catch(() => null),
      cancelStreamConfirmBtn.waitFor({ state: "visible", timeout: 15_000 }).catch(() => null),
    ]);

    const settleVisible = await cancelAndSettleBtn.isVisible().catch(() => false);
    if (settleVisible) {
      await cancelAndSettleBtn.click();
    } else {
      await cancelStreamConfirmBtn.click();
    }

    // Wait for on-chain confirmation — campaign status badge shows "Cancelled" or "Settled"
    await expect(
      page.getByText(/cancelled|settled/i).first()
    ).toBeVisible({ timeout: 45_000 });

    // "Cancel Stream" action button should be gone after the operation
    await expect(page.getByRole("button", { name: /^cancel stream$/i })).not.toBeVisible({
      timeout: 10_000,
    });
  });
});
