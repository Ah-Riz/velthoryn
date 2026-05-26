import { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/api/json-response";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, rootVersions, claimEvents } from "@/lib/db/schema";
import { NotFoundError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";
import { GRACE_PERIOD_SECS } from "@/lib/api/tx-builder";

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
        version: rootVersions.version,
        merkleRoot: rootVersions.merkleRoot,
        leafCount: rootVersions.leafCount,
        createdAt: rootVersions.createdAt,
        ipfsCid: rootVersions.ipfsCid,
      })
      .from(rootVersions)
      .where(eq(rootVersions.campaignId, campaign.id))
      .orderBy(sql`${rootVersions.version} DESC`);

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
    paused: campaign.paused,
    cancelledAt: campaign.cancelledAt,
    createdAt: campaign.createdAt,
    metadata: campaign.metadata,
    gracePeriod,
    analytics: {
      uniqueClaimers: analytics.uniqueClaimers,
      claimCount: analytics.claimCount,
      percentClaimed,
      rootVersionCount: rootVersionList.length,
    },
    rootVersions: rootVersionList,
  });
}

export const GET = withRoute(
  { rateLimit: { requests: 60, window: 60 } },
  getCampaignByAddressHandler,
);
