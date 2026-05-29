import { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/api/json-response";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, rootVersions, leaves } from "@/lib/db/schema";
import { createRootVersionRequestSchema } from "@/lib/api/validators";
import { verifyAllLeaves } from "@/lib/merkle/verify";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";

function u64BigInt(value: string | number): bigint {
  return BigInt(value);
}

async function postRootVersionHandler(
  request: NextRequest,
  { params }: { params: Promise<{ treeAddress: string }> },
) {
  const { treeAddress } = await params;
  const body = await request.json();
  const parsed = createRootVersionRequestSchema.safeParse(body);

  if (!parsed.success) {
    throw new ValidationError("Validation failed", parsed.error.issues);
  }

  const data = parsed.data;
  const proofCheck = verifyAllLeaves(data.leaves, data.merkleRoot);
  if (!proofCheck.ok) {
    const leafSuffix =
      proofCheck.leafIndex !== undefined
        ? ` for leaf index ${proofCheck.leafIndex}`
        : "";
    throw new ValidationError(`${proofCheck.error}${leafSuffix}`);
  }

  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.treeAddress, treeAddress))
    .limit(1);

  if (!campaign) {
    throw new NotFoundError("Campaign");
  }

  const nextVersion = await db.transaction(async (tx) => {
    const [currentMax] = await tx
      .select({ version: sql<number>`coalesce(max(${rootVersions.version}), 0)::int` })
      .from(rootVersions)
      .where(eq(rootVersions.campaignId, campaign.id));

    const version = currentMax.version + 1;

    const [insertedRootVersion] = await tx
      .insert(rootVersions)
      .values({
        campaignId: campaign.id,
        merkleRoot: data.merkleRoot,
        leafCount: data.leafCount,
        ipfsCid: data.ipfsCid ?? null,
        version: version,
        createdAt: u64BigInt(Math.floor(Date.now() / 1000)),
      })
      .returning({ id: rootVersions.id });

    const leafRows = data.leaves.map((leaf) => ({
      rootVersionId: insertedRootVersion.id,
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

    if (leafRows.length > 0) {
      await tx.insert(leaves).values(leafRows);
    }

    await tx
      .update(campaigns)
      .set({
        merkleRoot: data.merkleRoot,
        leafCount: data.leafCount,
      })
      .where(eq(campaigns.id, campaign.id));

    return version;
  });

  return jsonResponse({ ok: true, version: nextVersion }, { status: 201 });
}

export const POST = withRoute(
  {
    rateLimit: { requests: 10, window: 60 },
    bodyLimit: "root-versions",
  },
  postRootVersionHandler,
);
