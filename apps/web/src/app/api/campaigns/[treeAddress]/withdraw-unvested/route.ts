import { NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { jsonResponse } from "@/lib/api/json-response";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";
import { getAuthenticatedWallet } from "@/lib/api/auth-middleware";
import { withdrawUnvestedRequestSchema } from "@/lib/api/validators";
import { buildWithdrawUnvestedTx, GRACE_PERIOD_SECS } from "@/lib/api/tx-builder";

async function withdrawUnvestedHandler(
  request: NextRequest,
  { params }: { params: Promise<{ treeAddress: string }> },
) {
  const { treeAddress } = await params;

  const body = await request.json().catch(() => ({}));
  const parsed = withdrawUnvestedRequestSchema.safeParse(body);
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

  if (campaign.cancelledAt === null) {
    throw new AppError("Campaign is not cancelled", 400, "NOT_CANCELLED");
  }

  const cancelledAt = BigInt(campaign.cancelledAt);
  const gracePeriodEnd = cancelledAt + GRACE_PERIOD_SECS;
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < gracePeriodEnd) {
    throw new AppError("Grace period is still active", 400, "GRACE_PERIOD_ACTIVE");
  }

  const authWallet = getAuthenticatedWallet(request);
  if (authWallet !== campaign.creator) {
    throw new ForbiddenError("Signer is not the campaign's creator");
  }

  const prepared = await buildWithdrawUnvestedTx({
    vestingTree: new PublicKey(treeAddress),
    creator: new PublicKey(creator),
    creatorAta: new PublicKey(creatorAta),
    mint: new PublicKey(campaign.mint),
  });

  return jsonResponse(prepared);
}

export const POST = withRoute(
  { auth: true, rateLimit: { requests: 10, window: 60 } },
  withdrawUnvestedHandler,
);
