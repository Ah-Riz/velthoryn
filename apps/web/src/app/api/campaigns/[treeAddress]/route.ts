import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, rootVersions, claimEvents } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// GET /api/campaigns/:treeAddress — campaign detail with analytics
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ treeAddress: string }> },
) {
  try {
    const { treeAddress } = await params;

    // Find campaign
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.treeAddress, treeAddress))
      .limit(1);

    if (!campaign) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 },
      );
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
        totalClaimed: sql<number>`coalesce(sum(${claimEvents.amount}), 0)::int`,
      })
      .from(claimEvents)
      .where(eq(claimEvents.campaignId, campaign.id));

    const percentClaimed =
      campaign.totalSupply > 0
        ? Math.round((analytics.totalClaimed / campaign.totalSupply) * 10000) / 100
        : 0;

    return NextResponse.json({
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
      analytics: {
        uniqueClaimers: analytics.uniqueClaimers,
        claimCount: analytics.claimCount,
        percentClaimed,
        rootVersionCount: rootVersionList.length,
      },
      rootVersions: rootVersionList,
    });
  } catch (error) {
    console.error("[GET /api/campaigns/:treeAddress] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
