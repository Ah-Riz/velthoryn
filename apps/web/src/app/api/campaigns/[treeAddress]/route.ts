import { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/api/json-response";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  rootVersions,
  claimEvents,
  leaves,
  milestoneEvents,
} from "@/lib/db/schema";
import { NotFoundError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";
import { GRACE_PERIOD_SECS } from "@/lib/api/tx-builder";
import { computeInstantRefundEligible } from "@/lib/api/instant-refund";
import { buildVestingCurve } from "@/lib/vesting/schedule";

async function getCampaignByAddressHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ treeAddress: string }> },
) {
  const { treeAddress } = await params;

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.treeAddress, treeAddress))
    .limit(1);

  if (!campaign) {
    throw new NotFoundError("Campaign");
  }

  // Fetch root versions for this campaign
  const rootVersionList = await db
    .select({
      id: rootVersions.id,
      version: rootVersions.version,
      merkleRoot: rootVersions.merkleRoot,
      leafCount: rootVersions.leafCount,
      createdAt: rootVersions.createdAt,
      ipfsCid: rootVersions.ipfsCid,
    })
    .from(rootVersions)
    .where(eq(rootVersions.campaignId, campaign.id))
    .orderBy(sql`${rootVersions.version} DESC`);

  const latestRootVersion = rootVersionList[0];
  const latestLeaves = latestRootVersion
    ? await db
        .select({
          beneficiary: leaves.beneficiary,
          amount: leaves.amount,
          releaseType: leaves.releaseType,
          startTime: leaves.startTime,
          cliffTime: leaves.cliffTime,
          endTime: leaves.endTime,
          milestoneIdx: leaves.milestoneIdx,
        })
        .from(leaves)
        .where(eq(leaves.rootVersionId, latestRootVersion.id))
    : [];

  const claimTotals = await db
    .select({
      beneficiary: claimEvents.beneficiary,
      claimedAmount: sql<string>`max(${claimEvents.totalClaimedByUser})::text`,
    })
    .from(claimEvents)
    .where(eq(claimEvents.campaignId, campaign.id))
    .groupBy(claimEvents.beneficiary);

  const claimedByBeneficiary = new Map(
    claimTotals.map((row) => [row.beneficiary, BigInt(row.claimedAmount)]),
  );
  const recipientAgg = new Map<string, { allocation: bigint; leafCount: number }>();
  for (const leaf of latestLeaves) {
    const current = recipientAgg.get(leaf.beneficiary) ?? { allocation: 0n, leafCount: 0 };
    recipientAgg.set(leaf.beneficiary, {
      allocation: current.allocation + BigInt(leaf.amount),
      leafCount: current.leafCount + 1,
    });
  }
  const recipientList = [...recipientAgg.entries()]
    .map(([beneficiary, summary]) => ({
      beneficiary,
      allocation: summary.allocation.toString(),
      leafCount: summary.leafCount,
      claimedAmount: (claimedByBeneficiary.get(beneficiary) ?? 0n).toString(),
    }))
    .sort((a, b) => b.leafCount - a.leafCount || a.beneficiary.localeCompare(b.beneficiary));

  // Compute analytics from claim_events
  const [analytics] = await db
    .select({
      uniqueClaimers: sql<number>`count(distinct ${claimEvents.beneficiary})::int`,
      claimCount: sql<number>`count(*)::int`,
    })
    .from(claimEvents)
    .where(eq(claimEvents.campaignId, campaign.id));

  const totalSupply = BigInt(campaign.totalSupply);
  const totalClaimed = BigInt(campaign.totalClaimed);
  const percentClaimed =
    totalSupply > 0n
      ? Number((totalClaimed * 10000n) / totalSupply) / 100
      : 0;

  const hasMilestoneLeaves = latestLeaves.some((l) => l.releaseType === 2);

  // Derive unique milestone indices from actual leaves — avoids showing phantom
  // milestone release buttons when the tree also contains cliff/linear leaves.
  const milestoneIndices = [...new Set(
    latestLeaves
      .filter((l) => l.releaseType === 2)
      .map((l) => l.milestoneIdx),
  )].sort((a, b) => a - b);

  let gracePeriod: {
    end: string;
    remaining: string;
    isExpired: boolean;
  } | null = null;

  if (campaign.cancelledAt !== null) {
    const cancelledAt = BigInt(campaign.cancelledAt);
    const gracePeriodEnd = cancelledAt + GRACE_PERIOD_SECS;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const remaining = gracePeriodEnd > now ? gracePeriodEnd - now : 0n;
    gracePeriod = {
      end: gracePeriodEnd.toString(),
      remaining: remaining.toString(),
      isExpired: now >= gracePeriodEnd,
    };
  }

  const [milestoneStats] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(milestoneEvents)
    .where(eq(milestoneEvents.campaignId, campaign.id));

  const nowSecs = BigInt(Math.floor(Date.now() / 1000));
  const minCliffTime = campaign.minCliffTime === null ? null : BigInt(campaign.minCliffTime);
  const instantRefundEligible = computeInstantRefundEligible({
    leafCount: campaign.leafCount,
    cancellable: campaign.cancellable,
    cancelledAt: campaign.cancelledAt === null ? null : BigInt(campaign.cancelledAt),
    instantRefunded: campaign.instantRefunded,
    minCliffTime,
    milestoneReleasedCount: milestoneStats.count ?? 0,
    nowSecs,
  });

  const cancelledAtBigint = campaign.cancelledAt === null ? null : BigInt(campaign.cancelledAt);
  const vestingCurve = campaign.leafCount > 1
    ? buildVestingCurve(
        latestLeaves.map((l) => ({
          amount: BigInt(l.amount),
          releaseType: l.releaseType,
          startTime: BigInt(l.startTime),
          cliffTime: BigInt(l.cliffTime),
          endTime: BigInt(l.endTime),
        })),
        totalSupply,
        cancelledAtBigint,
      )
    : null;

  return jsonResponse({
    treeAddress: campaign.treeAddress,
    creator: campaign.creator,
    mint: campaign.mint,
    campaignId: campaign.campaignId,
    merkleRoot: campaign.merkleRoot,
    leafCount: campaign.leafCount,
    totalSupply: campaign.totalSupply,
    totalClaimed: campaign.totalClaimed,
    cancellable: campaign.cancellable,
    cancelAuthority: campaign.cancelAuthority,
    pauseAuthority: campaign.pauseAuthority,
    paused: campaign.paused,
    cancelledAt: campaign.cancelledAt,
    minCliffTime: campaign.minCliffTime,
    instantRefunded: campaign.instantRefunded,
    instantRefundEligible,
    createdAt: campaign.createdAt,
    metadata: campaign.metadata,
    hasMilestoneLeaves,
    milestoneIndices,
    gracePeriod,
    analytics: {
      uniqueClaimers: analytics.uniqueClaimers,
      claimCount: analytics.claimCount,
      percentClaimed,
      rootVersionCount: rootVersionList.length,
    },
    rootVersions: rootVersionList,
    recipients: recipientList,
    singleLeaf: campaign.leafCount === 1 && latestLeaves[0]
      ? {
          beneficiary: latestLeaves[0].beneficiary,
          releaseType: latestLeaves[0].releaseType,
          startTime: Number(latestLeaves[0].startTime),
          cliffTime: Number(latestLeaves[0].cliffTime),
          endTime: Number(latestLeaves[0].endTime),
          milestoneIdx: latestLeaves[0].milestoneIdx,
        }
      : null,
    vestingCurve,
  });
}

export const GET = withRoute(
  { rateLimit: { requests: 60, window: 60 } },
  getCampaignByAddressHandler,
);
