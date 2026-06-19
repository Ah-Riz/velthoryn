import { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/api/json-response";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";

async function getBeneficiaryCampaignsHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;

  if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    throw new ValidationError("Invalid address");
  }

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
    instant_refunded: boolean;
    stream_settled: boolean;
    leaf_index: number;
    amount: number;
    release_type: number;
    start_time: number;
    cliff_time: number;
    end_time: number;
    milestone_idx: number;
    my_claimed: number;
  }>(sql`
      WITH latest_rv AS (
        SELECT id, campaign_id, version
        FROM root_versions
        WHERE (campaign_id, version) IN (
          SELECT campaign_id, MAX(version)
          FROM root_versions
          GROUP BY campaign_id
        )
      ),
      my_claims AS (
        SELECT
          campaign_id,
          beneficiary,
          max(total_claimed_by_user) AS claimed_amount
        FROM claim_events
        WHERE beneficiary = ${address}
        GROUP BY campaign_id, beneficiary
      )
      SELECT
        c.id, c.tree_address, c.creator, c.mint, c.campaign_id,
        c.total_supply, c.leaf_count, c.paused, c.cancelled_at,
        c.created_at, c.metadata,
        c.instant_refunded,
        EXISTS (
          SELECT 1 FROM stream_cancel_events sce
          WHERE sce.campaign_id = c.id
        ) AS stream_settled,
        l.leaf_index, l.amount, l.release_type,
        l.start_time, l.cliff_time, l.end_time, l.milestone_idx,
        coalesce(mc.claimed_amount, 0)::bigint AS my_claimed
      FROM campaigns c
      INNER JOIN latest_rv rv ON rv.campaign_id = c.id
      INNER JOIN leaves l ON l.root_version_id = rv.id AND l.beneficiary = ${address}
      LEFT JOIN my_claims mc ON mc.campaign_id = c.id AND mc.beneficiary = ${address}
      ORDER BY c.created_at DESC
    `);

  if (results.length === 0) {
    return jsonResponse({ campaigns: [] });
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
    instantRefunded: row.instant_refunded,
    streamSettled: row.stream_settled,
    myClaimed: row.my_claimed,
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

  return jsonResponse({ campaigns: campaignList });
}

export const GET = withRoute(
  { rateLimit: { requests: 60, window: 60 } },
  getBeneficiaryCampaignsHandler,
);
