/**
 * E2E coverage for CloseClaimRecordButton component.
 *
 * The button renders when:
 *   - fullyClaimed: totalEntitled > 0 && claimedAmount >= totalEntitled
 *   - postGrace:    cancelledAt !== null && nowTs >= cancelledAt + 604800 (7 days)
 *
 * Because claimRecordQuery fetches on-chain via program.account.claimRecord.fetch(),
 * we intercept the Solana JSON-RPC getAccountInfo call and return serialized
 * mock ClaimRecord account data so the component can render without a real on-chain account.
 */
import { expect, test, type Page } from "@playwright/test";
import { PublicKey } from "@solana/web3.js";
import { collectRelevantPageErrors } from "./pageErrors";
import {
  enableE2eWallet,
  gotoWithRetry,
  mockCampaignApi,
  injectStreamSchedule,
  creatorWallet,
} from "./helpers";

const ADDR = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const now = () => Math.floor(Date.now() / 1000);

const PROGRAM_ID = new PublicKey("G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu");

/**
 * Compute the claim record PDA for a given tree + beneficiary.
 * Seeds: ["claim", treePubkey, beneficiaryPubkey]
 */
function computeClaimRecordPda(treeAddress: string, beneficiaryAddress: string): [string, number] {
  const treePubkey = new PublicKey(treeAddress);
  const beneficiaryPubkey = new PublicKey(beneficiaryAddress);
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), treePubkey.toBuffer(), beneficiaryPubkey.toBuffer()],
    PROGRAM_ID,
  );
  return [pda.toBase58(), bump];
}

/**
 * Serialize a ClaimRecord struct in Anchor Borsh layout and return base64.
 *
 * Layout (129 bytes total):
 *   8  bytes - discriminator [57, 229, 0, 9, 65, 62, 96, 7]
 *  32  bytes - beneficiary (pubkey)
 *  32  bytes - tree (pubkey)
 *   8  bytes - claimed_amount (u64 LE)
 *   8  bytes - total_entitled (u64 LE)
 *  32  bytes - milestone_bitmap ([u8; 32])
 *   8  bytes - last_claim_at (i64 LE)
 *   1  byte  - bump (u8)
 */
function buildClaimRecordBase64(
  treeAddress: string,
  beneficiaryAddress: string,
  claimedAmount: bigint,
  totalEntitled: bigint,
  bump: number,
): string {
  const buf = Buffer.alloc(129);
  let offset = 0;

  // Discriminator
  const disc = [57, 229, 0, 9, 65, 62, 96, 7];
  disc.forEach((b) => buf.writeUInt8(b, offset++));

  // beneficiary (32 bytes)
  new PublicKey(beneficiaryAddress).toBuffer().copy(buf, offset);
  offset += 32;

  // tree (32 bytes)
  new PublicKey(treeAddress).toBuffer().copy(buf, offset);
  offset += 32;

  // claimed_amount (u64 LE)
  buf.writeBigUInt64LE(claimedAmount, offset);
  offset += 8;

  // total_entitled (u64 LE)
  buf.writeBigUInt64LE(totalEntitled, offset);
  offset += 8;

  // milestone_bitmap (32 bytes of zeros — already zero)
  offset += 32;

  // last_claim_at (i64 LE)
  buf.writeBigInt64LE(0n, offset);
  offset += 8;

  // bump (u8)
  buf.writeUInt8(bump, offset);

  return buf.toString("base64");
}

/**
 * Intercept Solana JSON-RPC calls and return mock ClaimRecord data for the
 * specific PDA that belongs to (treeAddress, beneficiaryAddress).
 *
 * All other RPC calls are passed through unchanged.
 */
async function mockClaimRecordRpc(
  page: Page,
  treeAddress: string,
  beneficiaryAddress: string,
  claimedAmount: bigint,
  totalEntitled: bigint,
) {
  const [claimRecordPda, bump] = computeClaimRecordPda(treeAddress, beneficiaryAddress);
  const accountDataB64 = buildClaimRecordBase64(
    treeAddress,
    beneficiaryAddress,
    claimedAmount,
    totalEntitled,
    bump,
  );

  // The mock ClaimRecord account JSON-RPC response
  const mockAccountResponse = {
    jsonrpc: "2.0",
    result: {
      context: { slot: 999_999_999 },
      value: {
        data: [accountDataB64, "base64"],
        executable: false,
        lamports: 2_039_280,
        owner: PROGRAM_ID.toBase58(),
        rentEpoch: 0,
        space: 129,
      },
    },
  };

  // Intercept all Solana RPC POSTs; return mock for getAccountInfo of our PDA
  await page.route(/api\.devnet\.solana\.com|helius-rpc\.com/, async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }

    let body: { method?: string; params?: [string, ...unknown[]] };
    try {
      body = JSON.parse(request.postData() ?? "{}");
    } catch {
      await route.continue();
      return;
    }

    if (
      body.method === "getAccountInfo" &&
      Array.isArray(body.params) &&
      body.params[0] === claimRecordPda
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...mockAccountResponse, id: (body as any).id }),
      });
      return;
    }

    await route.continue();
  });
}

// ---------------------------------------------------------------------------
// CloseClaimRecordButton
// ---------------------------------------------------------------------------

test.describe("CloseClaimRecordButton", () => {
  test("Close Record button visible when fully claimed", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    const pastCliff = now() - 86400;

    // Mock RPC so claimRecord returns totalEntitled = claimedAmount = 1 SOL
    await mockClaimRecordRpc(
      page,
      ADDR,
      creatorWallet,
      1_000_000_000n,
      1_000_000_000n,
    );

    await injectStreamSchedule(page, ADDR, {
      releaseType: 0,
      startTime: 0,
      cliffTime: pastCliff,
      endTime: pastCliff,
      beneficiary: creatorWallet,
      amount: "1000000000",
    });
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, {
      leafCount: 1,
      cancelledAt: null,
      totalClaimed: "1000000000",
      totalSupply: "1000000000",
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(
      page.getByRole("button", { name: /close record & reclaim rent/i }),
    ).toBeVisible({ timeout: 25_000 });
    expect(pageErrors).toEqual([]);
  });

  test("Close Record button visible when post grace period", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    const cancelledAt = now() - 86400 * 8; // 8 days ago, grace (7 days) has expired
    const pastCliff = now() - 86400 * 30;

    // Mock RPC: partial claim — not fully claimed, but post-grace makes it eligible
    await mockClaimRecordRpc(
      page,
      ADDR,
      creatorWallet,
      500_000_000n,   // claimedAmount — half claimed
      1_000_000_000n, // totalEntitled — not fully claimed
    );

    await injectStreamSchedule(page, ADDR, {
      releaseType: 0,
      startTime: 0,
      cliffTime: pastCliff,
      endTime: pastCliff,
      beneficiary: creatorWallet,
      amount: "1000000000",
    });
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, {
      leafCount: 1,
      cancelledAt,
      totalClaimed: "500000000",
      totalSupply: "1000000000",
      gracePeriod: {
        end: String(cancelledAt + 86400 * 7),
        remaining: "0",
        isExpired: true,
      },
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(
      page.getByRole("button", { name: /close record & reclaim rent/i }),
    ).toBeVisible({ timeout: 25_000 });
    expect(pageErrors).toEqual([]);
  });

  test("Close Record button NOT visible when not fully claimed and not post grace", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    const pastCliff = now() - 86400;

    // Mock RPC: partial claim, campaign not cancelled
    await mockClaimRecordRpc(
      page,
      ADDR,
      creatorWallet,
      250_000_000n,   // claimedAmount — 25% claimed
      1_000_000_000n, // totalEntitled — not fully claimed
    );

    await injectStreamSchedule(page, ADDR, {
      releaseType: 0,
      startTime: 0,
      cliffTime: pastCliff,
      endTime: pastCliff,
      beneficiary: creatorWallet,
      amount: "1000000000",
    });
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, {
      leafCount: 1,
      cancelledAt: null,
      totalClaimed: "250000000",
      totalSupply: "1000000000",
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(
      page.getByRole("button", { name: /close record & reclaim rent/i }),
    ).not.toBeVisible({ timeout: 25_000 });
    expect(pageErrors).toEqual([]);
  });

  test("Close Record button NOT visible when campaign not cancelled and not fully claimed", async ({ page }) => {
    const pageErrors = collectRelevantPageErrors(page);
    const pastCliff = now() - 86400;

    // Active campaign, no claim record exists (no RPC mock → claimRecordQuery returns null)
    await injectStreamSchedule(page, ADDR, {
      releaseType: 0,
      startTime: 0,
      cliffTime: pastCliff,
      endTime: pastCliff,
      beneficiary: creatorWallet,
      amount: "1000000000",
    });
    await enableE2eWallet(page);
    await mockCampaignApi(page, ADDR, {
      leafCount: 1,
      cancelledAt: null,
      paused: false,
      totalClaimed: "0",
      totalSupply: "1000000000",
    });
    await gotoWithRetry(page, `/campaign/${ADDR}`);

    await expect(
      page.getByRole("button", { name: /close record & reclaim rent/i }),
    ).not.toBeVisible({ timeout: 25_000 });
    expect(pageErrors).toEqual([]);
  });
});
