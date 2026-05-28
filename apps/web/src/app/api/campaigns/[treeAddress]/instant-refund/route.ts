import { NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, milestoneEvents } from "@/lib/db/schema";
import { jsonResponse } from "@/lib/api/json-response";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";
import { getAuthenticatedWallet } from "@/lib/api/auth-middleware";
import { instantRefundCampaignRequestSchema } from "@/lib/api/validators";
import { buildInstantRefundCampaignTx } from "@/lib/api/tx-builder";
import { computeInstantRefundEligible } from "@/lib/api/instant-refund";

async function instantRefundCampaignHandler(
  request: NextRequest,
  { params }: { params: Promise<{ treeAddress: string }> },
) {
  const { treeAddress } = await params;

  const body = await request.json().catch(() => ({}));
  const parsed = instantRefundCampaignRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Validation failed", parsed.error.issues);
  }
  const { creator, creatorAta } = parsed.data;

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.treeAddress, treeAddress))
    .limit(1);

  if (!campaign) {
    throw new NotFoundError("Campaign");
  }

  if (!campaign.cancellable) {
    throw new AppError("Campaign is not cancellable", 400, "NOT_CANCELLABLE");
  }
  if (campaign.cancelledAt !== null) {
    throw new AppError("Campaign is already cancelled", 400, "ALREADY_CANCELLED");
  }
  const authWallet = getAuthenticatedWallet(request);
  if (authWallet !== campaign.creator) {
    throw new ForbiddenError("Signer is not the campaign's creator");
  }

  const [milestoneStats] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(milestoneEvents)
    .where(eq(milestoneEvents.campaignId, campaign.id));

  const nowSecs = BigInt(Math.floor(Date.now() / 1000));
  const minCliffTime =
    campaign.minCliffTime === null ? null : BigInt(campaign.minCliffTime);
  const eligible = computeInstantRefundEligible({
    leafCount: campaign.leafCount,
    cancellable: campaign.cancellable,
    cancelledAt:
      campaign.cancelledAt === null ? null : BigInt(campaign.cancelledAt),
    instantRefunded: campaign.instantRefunded,
    minCliffTime,
    milestoneReleasedCount: milestoneStats?.count ?? 0,
    nowSecs,
  });

  if (!eligible) {
    throw new AppError(
      "Campaign is not eligible for instant refund",
      400,
      "NOT_ELIGIBLE_FOR_INSTANT_REFUND",
    );
  }

  const mint = new PublicKey(campaign.mint);
  const isNative = mint.equals(PublicKey.default);
  if (!isNative && creatorAta === null) {
    throw new ValidationError("creatorAta is required for SPL-token campaigns");
  }

  const prepared = await buildInstantRefundCampaignTx({
    vestingTree: new PublicKey(treeAddress),
    creator: new PublicKey(creator),
    mint,
    creatorAta: creatorAta ? new PublicKey(creatorAta) : null,
  });

  return jsonResponse(prepared);
}

export const POST = withRoute(
  { auth: true, rateLimit: { requests: 10, window: 60 } },
  instantRefundCampaignHandler,
);

