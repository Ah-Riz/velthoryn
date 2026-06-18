/**
 * E2E tests with REAL wallet signing — milestone release lifecycle.
 *
 * Prerequisites (same as create-and-claim.spec.ts):
 *   1. solana-test-validator running with the vesting program deployed:
 *      solana-test-validator --bpf-program G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu target/deploy/vesting.so --reset
 *   2. Dev server running with localnet RPC:
 *      NEXT_PUBLIC_RPC_ENDPOINT=http://127.0.0.1:8899 NEXT_PUBLIC_E2E_MOCK_WALLET=true pnpm exec next dev -H 127.0.0.1 -p 3200
 *   3. Run these tests:
 *      PLAYWRIGHT_BASE_URL=http://127.0.0.1:3200 npx playwright test tests/e2e/signing/milestone-release.spec.ts
 *
 * Flow:
 *   1. Create a milestone stream (releaseType=2) via the /campaign/create/milestone UI.
 *      The keypair is its own beneficiary so it can also claim after release.
 *   2. Wait 15s for the cliff (set 10s in future) to pass.
 *   3. Navigate to /campaign/${treeAddress} — the page reads the schedule from
 *      localStorage (written by the create hook automatically after submit).
 *   4. Verify that the "Release Milestone #0" button is visible and enabled.
 *   5. Click it and confirm the success toast appears.
 */
import { test, expect, type Page } from "@playwright/test";
import { Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import { alreadyUnlockedDatetimeLocal, expectCampaignLinkReady, selectNativeSol } from "./helpers";

const LOCALNET_RPC = "http://127.0.0.1:8899";

// Fresh keypair — self as beneficiary so we can later test claim too
const keypair = Keypair.generate();

// Shared state across serial tests
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

// ---------------------------------------------------------------------------
// Suite: Milestone Release
// ---------------------------------------------------------------------------

test.describe.serial("Real signing E2E — milestone release lifecycle", () => {
  test.beforeAll(async () => {
    const running = await checkValidator();
    if (!running) {
      test.skip(true, "Local validator not running — skipping milestone signing tests");
      return;
    }
    await fundKeypair(keypair);
    const connection = new Connection(LOCALNET_RPC, "confirmed");
    const balance = await connection.getBalance(keypair.publicKey);
    expect(balance).toBeGreaterThan(5 * LAMPORTS_PER_SOL);
  });

  // -------------------------------------------------------------------------
  // Step 1: Create the milestone stream via UI
  // -------------------------------------------------------------------------
  test("create SOL milestone stream via UI (self as beneficiary, cliff = now + 10s)", async ({ page }) => {
    await injectSigningWallet(page, keypair);
    await page.goto("/campaign/create/milestone", { waitUntil: "load" });

    await selectNativeSol(page);

    // Fill recipient: self (so the same wallet can claim after release)
    const recipientInput = page.getByPlaceholder(/solana wallet address/i).first();
    await recipientInput.waitFor({ state: "visible", timeout: 10_000 });
    await recipientInput.fill(keypair.publicKey.toBase58());

    // Fill amount
    await page.getByPlaceholder(/e\.g\. 1000/i).first().fill("0.01");

    await page.locator("input[type='datetime-local']").first().fill(alreadyUnlockedDatetimeLocal());

    // Submit — single milestone → button reads "Create Milestone Stream"
    const submitBtn = page.getByRole("button", { name: /create milestone stream/i });
    await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
    await submitBtn.click();

    // Wait for the success result card which shows an "Open stream" link
    // The href contains /campaign/<treeAddress>
    treeAddress = await expectCampaignLinkReady(page.getByRole("link", { name: /open stream/i }).first());
    expect(treeAddress.length).toBeGreaterThan(30);
  });

  // -------------------------------------------------------------------------
  // Step 2: Wait for cliff, then verify "Release Milestone #0" button visible
  // -------------------------------------------------------------------------
  test("wait for milestone cliff and verify release button is visible and enabled", async ({ page }) => {
    expect(treeAddress, "treeAddress must be set by the previous test").toBeTruthy();

    await injectSigningWallet(page, keypair);
    await page.goto(`/campaign/${treeAddress}`, { waitUntil: "load" });

    // The page reads localStorage schedule that the create hook stored automatically.
    // Once releaseType=2 and creator===viewer, the TriggerMilestoneButton renders.
    const releaseBtn = page.getByRole("button", { name: /release milestone #0/i });
    await releaseBtn.waitFor({ state: "visible", timeout: 30_000 });

    // Must not be disabled (cliff has passed)
    await expect(releaseBtn).toBeEnabled({ timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // Step 3: Click "Release Milestone #0" and confirm success
  // -------------------------------------------------------------------------
  test("release milestone #0 successfully", async ({ page }) => {
    expect(treeAddress, "treeAddress must be set by the previous test").toBeTruthy();

    await injectSigningWallet(page, keypair);
    await page.goto(`/campaign/${treeAddress}`, { waitUntil: "load" });

    const releaseBtn = page.getByRole("button", { name: /release milestone #0/i });
    await releaseBtn.waitFor({ state: "visible", timeout: 30_000 });
    await expect(releaseBtn).toBeEnabled({ timeout: 5_000 });

    await releaseBtn.click();

    // While the transaction is in-flight the button changes to "Releasing..."
    // Then the success toast "Milestone #0 released." appears
    await expect(
      page.getByText(/milestone #0 released/i).first(),
    ).toBeVisible({ timeout: 45_000 });

    // After release, the button should disappear (alreadyReleased = true → returns null)
    await expect(
      page.getByRole("button", { name: /release milestone #0/i }),
    ).not.toBeVisible({ timeout: 15_000 });
  });
});
