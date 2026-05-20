import { NextRequest, NextResponse } from "next/server";
import { jsonResponse } from "@/lib/api/json-response";
import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, rootVersions, leaves } from "@/lib/db/schema";
import { createCampaignRequestSchema } from "@/lib/api/validators";
import { verifyAllLeaves } from "@/lib/merkle/verify";

function u64BigInt(value: string | number): bigint {
  return BigInt(value);
}

// ---------------------------------------------------------------------------
// POST /api/campaigns — create campaign (create_campaign or create_stream)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createCampaignRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const data = parsed.data;

    // Cross-check declared leafCount matches actual leaves
    if (data.leafCount !== data.leaves.length) {
      return NextResponse.json(
        { error: `leafCount (${data.leafCount}) does not match leaves array length (${data.leaves.length})` },
        { status: 400 },
      );
    }

    const proofCheck = verifyAllLeaves(data.leaves, data.merkleRoot);
    if (!proofCheck.ok) {
      const leafSuffix =
        proofCheck.leafIndex !== undefined
          ? ` for leaf index ${proofCheck.leafIndex}`
          : "";
      return NextResponse.json(
        { error: `${proofCheck.error}${leafSuffix}` },
        { status: 400 },
      );
    }

    // Prepare leaf rows outside the transaction
    const leafRows = data.leaves.map((leaf) => ({
      rootVersionId: 0, // placeholder, set after root version insert
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
      // Idempotent retry: check before insert (catching 23505 leaves the tx aborted in Postgres)
      const [existing] = await tx
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(eq(campaigns.treeAddress, data.treeAddress))
        .limit(1);

      if (existing) {
        return jsonResponse(
          { ok: true, campaignId: existing.id },
          { status: 200 },
        );
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
          createdAt: u64BigInt(data.createdAt),
          metadata: data.metadata ?? null,
        })
        .returning({ id: campaigns.id });
      const campaignId = inserted.id;

      // Insert root version (version = 1)
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

      // Insert leaves
      if (leafRows.length > 0) {
        await tx
          .insert(leaves)
          .values(
            leafRows.map((leaf) => ({
              ...leaf,
              rootVersionId: insertedRootVersion.id,
            })),
          );
      }

      return jsonResponse({ ok: true, campaignId }, { status: 201 });
    });
  } catch (error) {
    console.error("[POST /api/campaigns] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/campaigns — list campaigns with optional filters
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const creator = searchParams.get("creator");
    const mint = searchParams.get("mint");
    const status = searchParams.get("status"); // active | paused | cancelled
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number(searchParams.get("limit")) || 20),
    );
    const offset = (page - 1) * limit;

    // Build filter conditions
    const conditions = [];
    if (creator) {
      conditions.push(eq(campaigns.creator, creator));
    }
    if (mint) {
      conditions.push(eq(campaigns.mint, mint));
    }
    if (status === "active") {
      conditions.push(eq(campaigns.paused, false));
      conditions.push(sql`${campaigns.cancelledAt} IS NULL`);
    } else if (status === "paused") {
      conditions.push(eq(campaigns.paused, true));
      conditions.push(sql`${campaigns.cancelledAt} IS NULL`);
    } else if (status === "cancelled") {
      conditions.push(sql`${campaigns.cancelledAt} IS NOT NULL`);
    }

    const whereClause =
      conditions.length > 0 ? and(...conditions) : undefined;

    // Count total matching campaigns
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(campaigns)
      .where(whereClause);

    // Fetch paginated campaigns
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
  } catch (error) {
    console.error("[GET /api/campaigns] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
