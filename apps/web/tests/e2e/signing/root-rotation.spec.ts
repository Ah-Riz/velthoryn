/**
 * E2E tests with REAL wallet signing — root rotation via AllocationEditor.
 *
 * Prerequisites (same as other signing specs):
 *   1. solana-test-validator running with the vesting program deployed:
 *      solana-test-validator --bpf-program G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu target/deploy/vesting.so --reset
 *   2. Dev server running with localnet RPC:
 *      NEXT_PUBLIC_RPC_ENDPOINT=http://127.0.0.1:8899 NEXT_PUBLIC_E2E_MOCK_WALLET=true pnpm exec next dev -H 127.0.0.1 -p 3200
 *   3. Run these tests:
 *      PLAYWRIGHT_BASE_URL=http://127.0.0.1:3200 npx playwright test tests/e2e/signing/root-rotation.spec.ts
 *
 * Flow under test (root rotation):
 *   1. Create a cancellable 2-recipient SOL cliff campaign (cliff = 30 days out).
 *   2. Capture treeAddress from the "View campaign" link.
 *   3. Navigate to /campaign/<treeAddress>/allocations.
 *   4. Wait for the editor to load — the proof API populates rows with schedule data.
 *   5. Click "+ Add Recipient" to add a new row (schedule fields inherit from the
 *      last row, so the schedule-validation guard in handleSubmit is satisfied).
 *   6. Fill the new row with a random wallet address and a small amount.
 *   7. Click "Update Allocations" and sign the transaction.
 *   8. Assert the success toast ("Allocations updated").
 *
 * Schedule-data insight:
 *   The allocations page fetches full leaf data (startTime / cliffTime / endTime)
 *   from /api/campaigns/<treeAddress>/proof?beneficiary=...&all=true for each
 *   indexed recipient.  When those rows are populated, "+ Add Recipient" inherits
 *   the last row's schedule, making the new row pass the non-empty-schedule guard
 *   inside handleSubmit.  We therefore *must* wait for the editor to finish loading
 *   the initial rows before we click "+ Add Recipient".
 */

import { test, expect, type Page } from "@playwright/test";
import { Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import { datetimeLocalFromNow, expectCampaignLinkReady, selectNativeSol } from "./helpers";

const LOCALNET_RPC = "http://127.0.0.1:8899";

// One keypair shared across the entire serial suite — it is both creator and
// cancelAuthority, which is required for the Update Allocations button to appear.
const keypair = Keypair.generate();

// Populated by the first test and consumed by the remaining tests.
let treeAddress = "";

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

async function fundKeypair(kp: Keypair): Promise<void> {
  const connection = new Connection(LOCALNET_RPC, "confirmed");
  const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

/**
 * Inject the test keypair into localStorage so the app's mock wallet adapter
 * picks it up and uses it for all signing operations.
 */
async function injectSigningWallet(page: Page, kp: Keypair): Promise<void> {
  const secretKeyB58 = bs58.encode(kp.secretKey);
  const publicKeyB58 = kp.publicKey.toBase58();

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
 * Create a cancellable 2-recipient SOL cliff campaign and return the treeAddress.
 *
 * cliffOffsetSeconds — how far in the future to set the cliff.
 *
 * Mirror of createCancellableSolCampaign from campaign-actions-signing.spec.ts.
 */
async function createCancellableSolCampaign(
  page: Page,
  kp: Keypair,
  cliffOffsetSeconds: number,
): Promise<string> {
  await injectSigningWallet(page, kp);
  await page.goto("/campaign/create/cliff", { waitUntil: "load" });

  await selectNativeSol(page);

  const cancellableToggle = page.getByText(/allow cancellation/i);
  await cancellableToggle.click();

  // Add a second recipient row so the campaign is bulk-funded (gives us a
  // persistent treeAddress on-chain that we can later navigate to).
  const addRecipientBtn = page.getByRole("button", { name: /add recipient/i }).first();
  await addRecipientBtn.waitFor({ state: "visible", timeout: 10_000 });
  await addRecipientBtn.click();

  const recipientInputs = page.getByPlaceholder(/solana wallet address/i);
  const amountInputs = page.getByPlaceholder(/e\.g\. 1000/i);
  const cliffInputs = page.locator("input[type='datetime-local']");

  const cliffValue = datetimeLocalFromNow(cliffOffsetSeconds);

  // Recipient 1 — a random throwaway wallet.
  const rec1 = Keypair.generate().publicKey.toBase58();
  await recipientInputs.nth(0).fill(rec1);
  await amountInputs.nth(0).fill("0.005");
  await cliffInputs.nth(0).fill(cliffValue);

  // Recipient 2 — another random throwaway wallet.
  const rec2 = Keypair.generate().publicKey.toBase58();
  // Cliff inputs at nth(2): each recipient row has 2 datetime inputs (cliff + optional start time)
  await recipientInputs.nth(1).fill(rec2);
  await amountInputs.nth(1).fill("0.005");
  await cliffInputs.nth(2).fill(cliffValue);

  // Submit.
  const submitBtn = page.getByRole("button", { name: /create campaign/i });
  await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
  await submitBtn.click();

  // Wait for the "View campaign" link — indicates the campaign was created and
  // the treeAddress is available.
  return expectCampaignLinkReady(page.getByRole("link", { name: /view campaign/i }));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe.serial("Real signing E2E — root rotation via AllocationEditor", () => {
  test.beforeAll(async () => {
    const running = await checkValidator();
    if (!running) {
      test.skip(true, "Local validator not running — skipping root-rotation signing tests");
      return;
    }
    await fundKeypair(keypair);
    const connection = new Connection(LOCALNET_RPC, "confirmed");
    const balance = await connection.getBalance(keypair.publicKey);
    expect(balance).toBeGreaterThan(5 * LAMPORTS_PER_SOL);
  });

  // -------------------------------------------------------------------------
  // Step 1: Create campaign
  // -------------------------------------------------------------------------

  test("create SOL cliff campaign for root rotation (cliff = now + 30 days)", async ({ page }) => {
    // Cliff 30 days out — campaign is pre-cliff, cancellable, and can be rotated.
    treeAddress = await createCancellableSolCampaign(page, keypair, 86400 * 30);

    expect(treeAddress).toBeTruthy();
    expect(treeAddress.length).toBeGreaterThan(30);
  });

  // -------------------------------------------------------------------------
  // Step 2: Navigate to allocation editor and verify page structure
  // -------------------------------------------------------------------------

  test("navigate to allocation editor", async ({ page }) => {
    expect(treeAddress, "treeAddress must be set by previous test").toBeTruthy();

    await injectSigningWallet(page, keypair);
    await page.goto(`/campaign/${treeAddress}/allocations`, { waitUntil: "load" });

    // Page heading.
    await expect(
      page.getByRole("heading", { name: /allocation editor/i }),
    ).toBeVisible({ timeout: 20_000 });

    // The "Update Allocations" button must exist.  It may be disabled while
    // leaf data loads from the proof API; we just verify it is rendered here.
    await expect(
      page.getByRole("button", { name: /update allocations/i }),
    ).toBeVisible({ timeout: 25_000 });
  });

  // -------------------------------------------------------------------------
  // Step 3: Add recipient and submit root rotation
  // -------------------------------------------------------------------------

  test("add recipient and submit root rotation transaction", async ({ page }) => {
    expect(treeAddress, "treeAddress must be set by previous test").toBeTruthy();

    await injectSigningWallet(page, keypair);
    await page.goto(`/campaign/${treeAddress}/allocations`, { waitUntil: "load" });

    // Wait until the editor is fully loaded (Update Allocations button enabled).
    // The button is disabled while initialRows are loading (leavesLoading state) or
    // while recipient inputs are still empty.  Once the proof API responds and the
    // rows are populated with valid wallet addresses and amounts, the button becomes
    // enabled.
    const updateBtn = page.getByRole("button", { name: /update allocations/i });
    await expect(updateBtn).toBeVisible({ timeout: 25_000 });
    await expect(updateBtn).toBeEnabled({ timeout: 45_000 });

    // The existing rows are now populated with real schedule data (startTime /
    // cliffTime / endTime from the proof API).  "+ Add Recipient" will copy those
    // schedule values into the new row so the handleSubmit schedule-guard passes.
    const addBtn = page.getByRole("button", { name: /\+ add recipient/i });
    await expect(addBtn).toBeVisible({ timeout: 5_000 });
    await addBtn.click();

    // The footer should now show the incremented recipient count.
    // (Original 2 rows + 1 new row = 3 recipients.)
    await expect(page.getByText(/3 recipients/i)).toBeVisible({ timeout: 5_000 });

    // Fill the new (last) row — wallet address input and amount.
    // The last row is appended at the bottom of the table; use last() to target it.
    const newWallet = Keypair.generate().publicKey.toBase58();

    const walletInputs = page.locator("input[placeholder='Solana wallet address']");
    await walletInputs.last().fill(newWallet);

    const amountInputs = page.locator("input[type='number']");
    await amountInputs.last().fill("0.003");

    // After filling a valid wallet address (≥ 32 chars) and amount > 0,
    // the "Update Allocations" button should become enabled.
    await expect(updateBtn).toBeEnabled({ timeout: 5_000 });

    // Click "Update Allocations" — this prepares the new Merkle tree and then
    // fires the on-chain updateRoot instruction which we sign via the mock wallet.
    await updateBtn.click();

    // Immediately after clicking, the button transitions to "Publishing Update…"
    // loading state while the prepare API call and on-chain transaction are in flight.
    await expect(
      page.getByRole("button", { name: /publishing update/i }),
    ).toBeVisible({ timeout: 15_000 });

    // After the transaction confirms and indexing completes, the success toast
    // appears.  Either "Allocations updated on-chain!" (no index) or
    // "Allocations updated! Version N indexed." (with index) is acceptable.
    await expect(
      page.getByText(/allocations updated/i),
    ).toBeVisible({ timeout: 60_000 });

    // The Update Allocations button should return to its idle state (not loading).
    await expect(
      page.getByRole("button", { name: /update allocations/i }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
