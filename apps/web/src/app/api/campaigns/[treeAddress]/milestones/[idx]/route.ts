import { NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, milestoneEvents } from "@/lib/db/schema";
import { jsonResponse } from "@/lib/api/json-response";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";
import { getAuthenticatedWallet } from "@/lib/api/auth-middleware";
import { milestoneReleaseRequestSchema } from "@/lib/api/validators";
import { buildMilestoneReleaseTx } from "@/lib/api/tx-builder";

async function milestoneReleaseHandler(
  request: NextRequest,
  { params }: { params: Promise<{ treeAddress: string; idx: string }> },
) {
  const { treeAddress, idx: idxStr } = await params;

  const idxNum = Number(idxStr);
  if (!Number.isInteger(idxNum) || idxNum < 0 || idxNum > 255) {
    throw new ValidationError("Milestone index must be an integer between 0 and 255");
  }
  const milestoneIdx = idxNum;

  const body = await request.json().catch(() => ({}));
  const parsed = milestoneReleaseRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Validation failed", parsed.error.issues);
  }
  const { creator } = parsed.data;

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.treeAddress, treeAddress))
    .limit(1);

  if (!campaign) {
    throw new NotFoundError("Campaign");
  }

  const authWallet = getAuthenticatedWallet(request);
  if (authWallet !== campaign.creator) {
    throw new ForbiddenError("Signer is not the campaign's creator");
  }

  if (campaign.cancelledAt !== null) {
    throw new AppError("Campaign is cancelled", 400, "ALREADY_CANCELLED");
  }

  const [existing] = await db
    .select({ id: milestoneEvents.id })
    .from(milestoneEvents)
    .where(
      and(
        eq(milestoneEvents.campaignId, campaign.id),
        eq(milestoneEvents.milestoneIdx, milestoneIdx),
      ),
    )
    .limit(1);

  if (existing) {
    throw new AppError(
      `Milestone ${milestoneIdx} has already been released`,
      400,
      "MILESTONE_ALREADY_RELEASED",
    );
  }

  const prepared = await buildMilestoneReleaseTx({
    vestingTree: new PublicKey(treeAddress),
    creator: new PublicKey(creator),
    milestoneIdx,
  });

  return jsonResponse(prepared);
}

export const POST = withRoute(
  { auth: true, rateLimit: { requests: 10, window: 60 } },
  milestoneReleaseHandler,
);
