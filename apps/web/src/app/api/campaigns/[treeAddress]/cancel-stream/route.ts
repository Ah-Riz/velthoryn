import { NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { jsonResponse } from "@/lib/api/json-response";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";
import { getAuthenticatedWallet } from "@/lib/api/auth-middleware";
import { cancelStreamRequestSchema } from "@/lib/api/validators";
import { buildCancelStreamTx } from "@/lib/api/tx-builder";

async function cancelStreamHandler(
  request: NextRequest,
  { params }: { params: Promise<{ treeAddress: string }> },
) {
  const { treeAddress } = await params;

  const body = await request.json().catch(() => ({}));
  const parsed = cancelStreamRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Validation failed", parsed.error.issues);
  }
  const { creator, beneficiary, withdrawArgs, beneficiaryAta, creatorAta } = parsed.data;

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.treeAddress, treeAddress))
    .limit(1);

  if (!campaign) {
    throw new NotFoundError("Campaign");
  }

  if (campaign.leafCount !== 1) {
    throw new AppError(
      "cancel_stream is only valid for single-recipient campaigns",
      400,
      "NOT_SINGLE_STREAM",
    );
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

  const prepared = await buildCancelStreamTx({
    vestingTree: new PublicKey(treeAddress),
    creator: new PublicKey(creator),
    beneficiary: new PublicKey(beneficiary),
    beneficiaryAta: new PublicKey(beneficiaryAta),
    creatorAta: new PublicKey(creatorAta),
    mint: new PublicKey(campaign.mint),
    withdrawArgs,
  });

  return jsonResponse(prepared);
}

export const POST = withRoute(
  { auth: true, rateLimit: { requests: 10, window: 60 } },
  cancelStreamHandler,
);
