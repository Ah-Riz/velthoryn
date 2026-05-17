import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// GET /api/beneficiary/:address/campaigns
// Returns all campaigns where the given address is a beneficiary,
// using the latest root version's leaf data for each campaign.
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  try {
    const { address } = await params;

    if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      return NextResponse.json(
        { error: "Invalid address" },
        { status: 400 },
      );
    }

    // Use a raw SQL CTE approach for efficiency:
    // 1. Find the latest root version per campaign
    // 2. Join with leaves for this beneficiary
    // 3. Join with campaigns for full details
    const results = await db.execute<{
      id: number;
      tree_address: string;
      creator: string;
      mint: string;
      campaign_id: number;
      total_supply: number;
      leaf_count: number;
      paused: boolean;
      cancelled_at: number | null;
      created_at: number;
      metadata: { name?: string; description?: string; logoUri?: string } | null;
      leaf_index: number;
      amount: number;
      release_type: number;
      start_time: number;
      cliff_time: number;
      end_time: number;
      milestone_idx: number;
    }>(sql`
      WITH latest_rv AS (
        SELECT id, campaign_id, version
        FROM root_versions
        WHERE (campaign_id, version) IN (
          SELECT campaign_id, MAX(version)
          FROM root_versions
          GROUP BY campaign_id
        )
      )
      SELECT
        c.id, c.tree_address, c.creator, c.mint, c.campaign_id,
        c.total_supply, c.leaf_count, c.paused, c.cancelled_at,
        c.created_at, c.metadata,
        l.leaf_index, l.amount, l.release_type,
        l.start_time, l.cliff_time, l.end_time, l.milestone_idx
      FROM campaigns c
      INNER JOIN latest_rv rv ON rv.campaign_id = c.id
      INNER JOIN leaves l ON l.root_version_id = rv.id AND l.beneficiary = ${address}
      ORDER BY c.created_at DESC
    `);

    if (results.length === 0) {
      return NextResponse.json({ campaigns: [] });
    }

    const campaignList = results.map((row) => ({
      treeAddress: row.tree_address,
      creator: row.creator,
      mint: row.mint,
      campaignId: row.campaign_id,
      totalSupply: row.total_supply,
      leafCount: row.leaf_count,
      paused: row.paused,
      cancelledAt: row.cancelled_at,
      createdAt: row.created_at,
      metadata: row.metadata,
      myLeaf: {
        leafIndex: row.leaf_index,
        amount: row.amount,
        releaseType: row.release_type,
        startTime: row.start_time,
        cliffTime: row.cliff_time,
        endTime: row.end_time,
        milestoneIdx: row.milestone_idx,
      },
    }));

    return NextResponse.json({ campaigns: campaignList });
  } catch (error) {
    console.error("[GET /api/beneficiary/:address/campaigns] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
