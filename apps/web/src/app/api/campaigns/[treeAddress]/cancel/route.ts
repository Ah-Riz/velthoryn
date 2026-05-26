import { NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { jsonResponse } from "@/lib/api/json-response";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";
import { getAuthenticatedWallet } from "@/lib/api/auth-middleware";
import { cancelCampaignRequestSchema } from "@/lib/api/validators";
import { buildCancelCampaignTx } from "@/lib/api/tx-builder";

async function cancelCampaignHandler(
  request: NextRequest,
  { params }: { params: Promise<{ treeAddress: string }> },
) {
  const { treeAddress } = await params;

  const body = await request.json().catch(() => ({}));
  const parsed = cancelCampaignRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Validation failed", parsed.error.issues);
  }
  const { cancelAuthority } = parsed.data;

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

  if (campaign.totalClaimed >= campaign.totalSupply && campaign.totalSupply > 0n) {
    throw new AppError("Campaign is fully vested", 400, "FULLY_VESTED");
  }

  const authWallet = getAuthenticatedWallet(request);
  if (!campaign.cancelAuthority || authWallet !== campaign.cancelAuthority) {
    throw new ForbiddenError("Signer is not the campaign's cancel authority");
  }

  const prepared = await buildCancelCampaignTx({
    vestingTree: new PublicKey(treeAddress),
    cancelAuthority: new PublicKey(cancelAuthority),
  });

  return jsonResponse(prepared);
}

export const POST = withRoute(
  { auth: true, rateLimit: { requests: 10, window: 60 } },
  cancelCampaignHandler,
);
