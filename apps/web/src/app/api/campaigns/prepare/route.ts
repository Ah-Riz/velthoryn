import type { NextRequest } from "next/server";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { prepareCampaign } from "@velthoryn/client";
import type { CampaignRecipient } from "@velthoryn/client";
import { jsonResponse } from "@/lib/api/json-response";
import { ValidationError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";
import { prepareCampaignRequestSchema } from "@/lib/api/validators";
import { derivePda } from "@/lib/anchor/client";
import { getRequestId } from "@/lib/api/request-id";
import { logger } from "@/lib/api/logger";

async function postPrepareHandler(request: NextRequest) {
  const requestId = getRequestId(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Request body is not valid JSON");
  }

  logger.info({
    requestId,
    message: "[POST /api/campaigns/prepare] Request received",
    recipientCount: Array.isArray((body as Record<string, unknown>)?.recipients) ? ((body as Record<string, unknown>).recipients as unknown[]).length : "unknown",
  });

  const parsed = prepareCampaignRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Validation failed", parsed.error.issues);
  }

  const data = parsed.data;

  let recipients: CampaignRecipient[];
  try {
    recipients = data.recipients.map((r) => ({
      beneficiary: new PublicKey(r.beneficiary),
      amount: new BN(r.amount),
      releaseType: r.releaseType as 0 | 1 | 2,
      startTime: new BN(r.startTime),
      cliffTime: new BN(r.cliffTime),
      endTime: new BN(r.endTime),
      milestoneIdx: r.milestoneIdx,
    }));
  } catch {
    throw new ValidationError("One or more recipient beneficiary addresses are not valid Solana public keys");
  }

  const prepared = prepareCampaign(recipients);

  // Derive tree PDA: seeds = ["tree", creator, mint, campaign_id.to_le_bytes()]
  let treeAddress: import("@solana/web3.js").PublicKey;
  try {
    const campaignIdBytes = new BN(data.campaignId).toArrayLike(Buffer, "le", 8);
    [treeAddress] = derivePda([
      "tree",
      new PublicKey(data.creator).toBuffer(),
      new PublicKey(data.mint).toBuffer(),
      campaignIdBytes,
    ]);
  } catch {
    throw new ValidationError("creator or mint address is not a valid Solana public key");
  }

  const leaves = prepared.leaves.map((leaf, i) => ({
    leafIndex: leaf.leafIndex,
    beneficiary: leaf.beneficiary.toBase58(),
    amount: leaf.amount.toString(),
    releaseType: leaf.releaseType,
    startTime: leaf.startTime.toString(),
    cliffTime: leaf.cliffTime.toString(),
    endTime: leaf.endTime.toString(),
    milestoneIdx: leaf.milestoneIdx,
    proof: prepared.proofs[i],
  }));

  return jsonResponse({
    treeAddress: treeAddress.toBase58(),
    merkleRoot: prepared.rootHex,
    leafCount: prepared.leafCount,
    totalSupply: prepared.totalSupply.toString(),
    minCliffTime: prepared.minCliffTime.toString(),
    leaves,
  });
}

export const POST = withRoute(
  {
    auth: true,
    rateLimit: { requests: 10, window: 60 },
    bodyLimit: "campaigns",
  },
  postPrepareHandler,
);
