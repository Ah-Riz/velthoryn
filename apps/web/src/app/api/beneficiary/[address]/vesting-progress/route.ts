import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jsonResponse } from "@/lib/api/json-response";
import { ValidationError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";
import { getVestedAmount } from "@/lib/vesting/schedule";
import type { VestingSchedule, ReleaseType } from "@/lib/vesting/schedule";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type BeneficiaryCampaignRow = {
  id: number;
  tree_address: string;
  creator: string;
  mint: string;
  campaign_id: string | number;
  total_supply: string | number;
  leaf_count: number;
  paused: boolean;
  instant_refunded: boolean;
  stream_settled: boolean;
  cancelled_at: string | number | null;
  created_at: string | number;
  metadata: { name?: string; description?: string; logoUri?: string } | null;
  leaf_index: number;
  amount: string | number;
  release_type: number;
  start_time: string | number;
  cliff_time: string | number;
  end_time: string | number;
  milestone_idx: number;
  my_claimed: string | number;
  milestone_released: boolean | null;
} & Record<string, unknown>;

async function getVestingProgressHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;

  if (!BASE58_RE.test(address)) {
    throw new ValidationError("Invalid address");
  }

  const now = BigInt(Math.floor(Date.now() / 1000));

  // Reuse the same CTE pattern as beneficiary/campaigns route
  const results = await db.execute<BeneficiaryCampaignRow>(sql`
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
    ),
    released_milestones AS (
      SELECT campaign_id, milestone_idx
      FROM milestone_events
      GROUP BY campaign_id, milestone_idx
    )
    SELECT
      c.id, c.tree_address, c.creator, c.mint, c.campaign_id,
      c.total_supply, c.leaf_count, c.paused, c.instant_refunded, c.cancelled_at,
      c.created_at, c.metadata,
      l.leaf_index, l.amount, l.release_type,
      l.start_time, l.cliff_time, l.end_time, l.milestone_idx,
      coalesce(mc.claimed_amount, 0)::bigint AS my_claimed,
      (rm.milestone_idx IS NOT NULL) AS milestone_released,
      EXISTS (
        SELECT 1 FROM stream_cancel_events sce
        WHERE sce.campaign_id = c.id
      ) AS stream_settled
    FROM campaigns c
    INNER JOIN latest_rv rv ON rv.campaign_id = c.id
    INNER JOIN leaves l ON l.root_version_id = rv.id AND l.beneficiary = ${address}
    LEFT JOIN my_claims mc ON mc.campaign_id = c.id AND mc.beneficiary = ${address}
    LEFT JOIN released_milestones rm ON rm.campaign_id = c.id AND rm.milestone_idx = l.milestone_idx
    ORDER BY c.created_at DESC
  `);

  const campaignList = results.map((row) => {
    const amount = BigInt(row.amount);
    const rawClaimed = BigInt(row.my_claimed);
    const cancelledAt = row.cancelled_at !== null ? BigInt(row.cancelled_at) : null;
    const isSettled = row.stream_settled === true;
    const isRefunded = row.instant_refunded === true;

    const schedule: VestingSchedule = {
      amount,
      releaseType: row.release_type as ReleaseType,
      startTime: BigInt(row.start_time),
      cliffTime: BigInt(row.cliff_time),
      endTime: BigInt(row.end_time),
    };

    const vestedSoFar = getVestedAmount(schedule, cancelledAt, now);
    const milestoneReleased = row.release_type !== 2 || row.milestone_released === true;

    // Settlement distributes all vested tokens to beneficiary — treat as fully claimed.
    // Instant refund returns everything to creator — nothing left to claim.
    const claimedSoFar = isSettled ? vestedSoFar : rawClaimed;
    const claimable = isRefunded ? 0n
      : (milestoneReleased && vestedSoFar > claimedSoFar ? vestedSoFar - claimedSoFar : 0n);

    // progressPercent = (vestedSoFar / amount) * 100, with 2 decimal precision
    const progressPercent =
      amount > 0n ? Number((vestedSoFar * 10000n) / amount) / 100 : 0;

    // nextUnlock — when does the next token vest?
    const nextUnlock = computeNextUnlock(schedule, cancelledAt, now);

    return {
      mint: row.mint,
      treeAddress: row.tree_address,
      metadata: row.metadata,
      leaf: {
        amount: amount.toString(),
        releaseType: row.release_type,
        startTime: String(row.start_time),
        cliffTime: String(row.cliff_time),
        endTime: String(row.end_time),
        milestoneIdx: row.milestone_idx,
        leafIndex: row.leaf_index,
      },
      progress: {
        totalEntitled: amount.toString(),
        vestedSoFar: vestedSoFar.toString(),
        claimedSoFar: claimedSoFar.toString(),
        claimable: claimable.toString(),
        progressPercent,
        nextUnlock: nextUnlock !== null ? nextUnlock.toString() : null,
      },
      cancelledAt: cancelledAt !== null ? cancelledAt.toString() : null,
      paused: row.paused,
      instantRefunded: row.instant_refunded,
      streamSettled: row.stream_settled,
      milestoneReleased,
    };
  });

  return jsonResponse({ address, campaigns: campaignList });
}

/**
 * Computes the next timestamp at which the vested amount will increase.
 * Returns null if vesting is complete or the schedule has no future unlocks.
 */
function computeNextUnlock(
  schedule: VestingSchedule,
  cancelledAt: bigint | null,
  now: bigint,
): bigint | null {
  const { releaseType, cliffTime, endTime } = schedule;

  // If cancelled, no future unlocks
  if (cancelledAt !== null && now >= cancelledAt) return null;

  const effectiveEnd = cancelledAt !== null && cancelledAt < endTime ? cancelledAt : endTime;

  if (releaseType === 0) {
    // Cliff: unlocks all at cliffTime
    if (now < cliffTime) return cliffTime;
    return null;
  }

  if (releaseType === 1) {
    // Linear: continuous — next second is "the next unlock"
    if (now < cliffTime) return cliffTime;
    if (now >= effectiveEnd) return null;
    return now + 1n;
  }

  if (releaseType === 2) {
    // Milestone: unlocks when the milestone is released (cliffTime is the marker)
    if (now < cliffTime) return cliffTime;
    return null;
  }

  return null;
}

export const GET = withRoute(
  { rateLimit: { requests: 60, window: 60 } },
  getVestingProgressHandler,
);
