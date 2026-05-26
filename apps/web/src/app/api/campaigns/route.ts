import { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/api/json-response";
import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, rootVersions, leaves } from "@/lib/db/schema";
import { createCampaignRequestSchema } from "@/lib/api/validators";
import { verifyAllLeaves } from "@/lib/merkle/verify";
import { ValidationError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";
import { getRequestId } from "@/lib/api/request-id";
import { logger } from "@/lib/api/logger";

function u64BigInt(value: string | number): bigint {
  return BigInt(value);
}

async function postCampaignsHandler(request: NextRequest) {
  const requestId = getRequestId(request);
  const body = await request.json();

  logger.info({
    requestId,
    message: "[POST /api/campaigns] Request received",
    treeAddress: body?.treeAddress,
    creator: body?.creator,
    leafCount: body?.leafCount,
  });

  const parsed = createCampaignRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Validation failed", parsed.error.issues);
  }

  const data = parsed.data;

  if (data.leafCount !== data.leaves.length) {
    throw new ValidationError(
      `leafCount (${data.leafCount}) does not match leaves array length (${data.leaves.length})`,
    );
  }

  const proofCheck = verifyAllLeaves(data.leaves, data.merkleRoot);
  if (!proofCheck.ok) {
    const leafSuffix =
      proofCheck.leafIndex !== undefined
        ? ` for leaf index ${proofCheck.leafIndex}`
        : "";
    throw new ValidationError(`${proofCheck.error}${leafSuffix}`);
  }

  const leafRows = data.leaves.map((leaf) => ({
    rootVersionId: 0,
    leafIndex: leaf.leafIndex,
    beneficiary: leaf.beneficiary,
    amount: u64BigInt(leaf.amount),
    releaseType: leaf.releaseType,
    startTime: u64BigInt(leaf.startTime),
    cliffTime: u64BigInt(leaf.cliffTime),
    endTime: u64BigInt(leaf.endTime),
    milestoneIdx: leaf.milestoneIdx,
    proof: leaf.proof,
  }));

  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.treeAddress, data.treeAddress))
      .limit(1);

    if (existing) {
      return jsonResponse({ ok: true, campaignId: existing.id }, { status: 200 });
    }

    const [inserted] = await tx
      .insert(campaigns)
      .values({
        treeAddress: data.treeAddress,
        creator: data.creator,
        mint: data.mint,
        campaignId: u64BigInt(data.campaignId),
        merkleRoot: data.merkleRoot,
        leafCount: data.leafCount,
        totalSupply: u64BigInt(data.totalSupply),
        cancellable: data.cancellable,
        cancelAuthority: data.cancelAuthority,
        pauseAuthority: data.pauseAuthority,
        createdAt: u64BigInt(data.createdAt),
        metadata: data.metadata ?? null,
      })
      .returning({ id: campaigns.id });
    const campaignId = inserted.id;

    const [insertedRootVersion] = await tx
      .insert(rootVersions)
      .values({
        campaignId,
        merkleRoot: data.merkleRoot,
        leafCount: data.leafCount,
        ipfsCid: data.ipfsCid ?? null,
        version: 1,
        createdAt: u64BigInt(data.createdAt),
      })
      .returning({ id: rootVersions.id });

    if (leafRows.length > 0) {
      await tx.insert(leaves).values(
        leafRows.map((leaf) => ({
          ...leaf,
          rootVersionId: insertedRootVersion.id,
        })),
      );
    }

    return jsonResponse({ ok: true, campaignId }, { status: 201 });
  });
}

async function getCampaignsHandler(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const creator = searchParams.get("creator");
  const mint = searchParams.get("mint");
  const status = searchParams.get("status");
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 20));
  const offset = (page - 1) * limit;

  const conditions = [];
  if (creator) conditions.push(eq(campaigns.creator, creator));
  if (mint) conditions.push(eq(campaigns.mint, mint));
  if (status === "active") {
    conditions.push(eq(campaigns.paused, false));
    conditions.push(sql`${campaigns.cancelledAt} IS NULL`);
  } else if (status === "paused") {
    conditions.push(eq(campaigns.paused, true));
    conditions.push(sql`${campaigns.cancelledAt} IS NULL`);
  } else if (status === "cancelled") {
    conditions.push(sql`${campaigns.cancelledAt} IS NOT NULL`);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaigns)
    .where(whereClause);

  const results = await db
    .select({
      treeAddress: campaigns.treeAddress,
      creator: campaigns.creator,
      mint: campaigns.mint,
      campaignId: campaigns.campaignId,
      leafCount: campaigns.leafCount,
      totalSupply: campaigns.totalSupply,
      totalClaimed: campaigns.totalClaimed,
      cancellable: campaigns.cancellable,
      paused: campaigns.paused,
      cancelledAt: campaigns.cancelledAt,
      createdAt: campaigns.createdAt,
      metadata: campaigns.metadata,
    })
    .from(campaigns)
    .where(whereClause)
    .orderBy(desc(campaigns.createdAt))
    .limit(limit)
    .offset(offset);

  return jsonResponse({
    campaigns: results,
    total: count,
    page,
    limit,
  });
}

export const POST = withRoute(
  {
    rateLimit: { requests: 10, window: 60 },
    bodyLimit: "campaigns",
  },
  postCampaignsHandler,
);

export const GET = withRoute(
  { rateLimit: { requests: 60, window: 60 } },
  getCampaignsHandler,
);
