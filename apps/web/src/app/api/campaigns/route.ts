import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, rootVersions, leaves } from "@/lib/db/schema";
import { createCampaignRequestSchema } from "@/lib/api/validators";
import { hashLeaf, hashNode } from "@/lib/merkle/builder";

// ---------------------------------------------------------------------------
// verifyProof — standalone proof verification using the web app's merkle lib.
// Mirrors clients/ts/src/merkle.ts verifyProof() exactly.
// ---------------------------------------------------------------------------
function verifyProof(
  hashLeafBuf: Buffer,
  proof: Buffer[],
  index: number,
  root: Buffer,
): boolean {
  let hash = hashLeafBuf;
  let idx = index;
  for (const sibling of proof) {
    if ((idx & 1) === 0) {
      hash = hashNode(hash, sibling);
    } else {
      hash = hashNode(sibling, hash);
    }
    idx >>= 1;
  }
  return hash.equals(root);
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

    // Verify first leaf against declared merkleRoot
    const firstLeaf = data.leaves[0];
    const leafForHash = {
      leafIndex: firstLeaf.leafIndex,
      beneficiary: firstLeaf.beneficiary,
      amount: BigInt(firstLeaf.amount),
      releaseType: firstLeaf.releaseType as 0 | 1 | 2,
      startTs: BigInt(firstLeaf.startTime),
      cliffTs: BigInt(firstLeaf.cliffTime),
      endTs: BigInt(firstLeaf.endTime),
      milestoneIdx: firstLeaf.milestoneIdx,
    };

    const leafHash = hashLeaf(leafForHash);
    const rootBuf = Buffer.from(data.merkleRoot, "hex");

    if (data.leaves.length === 1) {
      // Single-leaf tree: root must equal leaf hash
      if (!leafHash.equals(rootBuf)) {
        return NextResponse.json(
          { error: "Single-leaf root does not match leaf hash" },
          { status: 400 },
        );
      }
    } else if (firstLeaf.proof.length > 0) {
      // Multi-leaf tree: verify first leaf's proof
      const proofBufs = firstLeaf.proof.map((sibling) => Buffer.from(sibling));
      const valid = verifyProof(leafHash, proofBufs, firstLeaf.leafIndex, rootBuf);
      if (!valid) {
        return NextResponse.json(
          { error: "Proof verification failed for first leaf" },
          { status: 400 },
        );
      }
    }

    // Prepare leaf rows outside the transaction
    const leafRows = data.leaves.map((leaf) => ({
      rootVersionId: 0, // placeholder, set after root version insert
      leafIndex: leaf.leafIndex,
      beneficiary: leaf.beneficiary,
      amount: Number(leaf.amount),
      releaseType: leaf.releaseType,
      startTime: Number(leaf.startTime),
      cliffTime: Number(leaf.cliffTime),
      endTime: Number(leaf.endTime),
      milestoneIdx: leaf.milestoneIdx,
      proof: leaf.proof,
    }));

    return await db.transaction(async (tx) => {
      // Try insert, catch unique constraint violation for idempotency
      let campaignId: number;
      try {
        const [inserted] = await tx
          .insert(campaigns)
          .values({
            treeAddress: data.treeAddress,
            creator: data.creator,
            mint: data.mint,
            campaignId: data.campaignId,
            merkleRoot: data.merkleRoot,
            leafCount: data.leafCount,
            totalSupply: Number(data.totalSupply),
            cancellable: data.cancellable,
            createdAt: data.createdAt,
            metadata: data.metadata ?? null,
          })
          .returning({ id: campaigns.id });
        campaignId = inserted.id;
      } catch (e: unknown) {
        // Check for unique constraint violation (PostgreSQL error code 23505)
        const err = e as { code?: string };
        if (err?.code === "23505") {
          const [existing] = await tx
            .select({ id: campaigns.id })
            .from(campaigns)
            .where(eq(campaigns.treeAddress, data.treeAddress))
            .limit(1);
          return NextResponse.json(
            { ok: true, campaignId: existing.id },
            { status: 200 },
          );
        }
        throw e;
      }

      // Insert root version (version = 1)
      const [insertedRootVersion] = await tx
        .insert(rootVersions)
        .values({
          campaignId,
          merkleRoot: data.merkleRoot,
          leafCount: data.leafCount,
          ipfsCid: data.ipfsCid ?? null,
          version: 1,
          createdAt: data.createdAt,
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

      return NextResponse.json({ ok: true, campaignId }, { status: 201 });
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

    return NextResponse.json({
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
