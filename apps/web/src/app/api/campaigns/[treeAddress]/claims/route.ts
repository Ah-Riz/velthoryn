import { NextRequest, NextResponse } from "next/server";
import { jsonResponse } from "@/lib/api/json-response";
import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, claimEvents } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// GET /api/campaigns/:treeAddress/claims?[beneficiary=<base58>][&fromSlot=<slot>][&limit=50]
// Returns claim history for a campaign, optionally filtered by beneficiary.
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ treeAddress: string }> },
) {
  try {
    const { treeAddress } = await params;

    if (!treeAddress || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(treeAddress)) {
      return NextResponse.json(
        { error: "Invalid address" },
        { status: 400 },
      );
    }

    const { searchParams } = new URL(request.url);

    const beneficiary = searchParams.get("beneficiary");
    const fromSlotParam = searchParams.get("fromSlot");

    if (fromSlotParam !== null) {
      const n = Number(fromSlotParam);
      if (!Number.isFinite(n) || n < 0 || fromSlotParam !== String(n) && !/^\d+$/.test(fromSlotParam)) {
        return NextResponse.json(
          { error: "Invalid fromSlot" },
          { status: 400 },
        );
      }
    }

    const fromSlot = fromSlotParam;
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50));

    // Find campaign by tree_address
    const [campaign] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.treeAddress, treeAddress))
      .limit(1);

    if (!campaign) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 },
      );
    }

    // Build filter conditions
    const conditions = [eq(claimEvents.campaignId, campaign.id)];
    if (beneficiary) {
      conditions.push(eq(claimEvents.beneficiary, beneficiary));
    }
    if (fromSlot) {
      conditions.push(sql`${claimEvents.slot} >= ${Number(fromSlot)}`);
    }

    const whereClause = and(...conditions);

    // Count total matching claims
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(claimEvents)
      .where(whereClause);

    // Fetch paginated claims
    const results = await db
      .select({
        beneficiary: claimEvents.beneficiary,
        leafIndex: claimEvents.leafIndex,
        amount: claimEvents.amount,
        totalClaimedByUser: claimEvents.totalClaimedByUser,
        totalClaimedOverall: claimEvents.totalClaimedOverall,
        milestoneIdx: claimEvents.milestoneIdx,
        signature: claimEvents.signature,
        slot: claimEvents.slot,
        blockTime: claimEvents.blockTime,
      })
      .from(claimEvents)
      .where(whereClause)
      .orderBy(desc(claimEvents.blockTime))
      .limit(limit);

    return jsonResponse({
      claims: results,
      total: count,
    });
  } catch (error) {
    console.error("[GET /api/campaigns/:treeAddress/claims] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
