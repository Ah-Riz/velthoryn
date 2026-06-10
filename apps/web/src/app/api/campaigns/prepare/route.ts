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

  // Validate no duplicate (beneficiary, milestoneIdx) pairs for milestone leaves.
  // A duplicate would cause the on-chain bitmap to mark the milestone claimed after
  // the first leaf, making the second leaf permanently unclaimable.
  const milestoneDuplicates = new Map<string, number[]>();
  for (let i = 0; i < data.recipients.length; i++) {
    const r = data.recipients[i];
    if (r.releaseType === 2) {
      const key = `${r.beneficiary}:${r.milestoneIdx}`;
      const existing = milestoneDuplicates.get(key);
      if (existing) {
        existing.push(i);
      } else {
        milestoneDuplicates.set(key, [i]);
      }
    }
  }
  if (milestoneDuplicates.size > 0) {
    const dupEntries: string[] = [];
    for (const [key, indices] of milestoneDuplicates) {
      if (indices.length > 1) {
        dupEntries.push(
          `beneficiary=${key.split(":")[0]}, milestoneIdx=${key.split(":")[1]} at recipient indices [${indices.join(", ")}]`,
        );
      }
    }
    if (dupEntries.length > 0) {
      throw new ValidationError(
        `Duplicate (beneficiary, milestoneIdx) pairs found for milestone recipients. ` +
          `Each beneficiary can have at most one leaf per milestone index. ` +
          `Duplicates: ${dupEntries.join("; ")}`,
      );
    }
  }

  // Known Issue #29: reject multiple cliff/linear leaves per beneficiary.
  const cliffLinearSeen = new Map<string, number[]>();
  for (let i = 0; i < data.recipients.length; i++) {
    const r = data.recipients[i];
    if (r.releaseType !== 2) {
      const prev = cliffLinearSeen.get(r.beneficiary) ?? [];
      if (prev.length > 0) {
        throw new ValidationError(
          `Known Issue #29: beneficiary ${r.beneficiary} has multiple cliff/linear leaves ` +
            `(indices [${prev.join(", ")}, ${i}]). Use separate campaigns instead.`,
        );
      }
      cliffLinearSeen.set(r.beneficiary, [...prev, i]);
    }
  }

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
    rateLimit: { requests: 10, window: 60 },
    bodyLimit: "campaigns",
  },
  postPrepareHandler,
);
