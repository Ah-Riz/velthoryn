import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, rootVersions, leaves } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// GET /api/campaigns/:treeAddress/proof?beneficiary=<base58>
// Returns leaf data + proof for a beneficiary in the latest root version.
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ treeAddress: string }> },
) {
  try {
    const { treeAddress } = await params;
    const { searchParams } = new URL(request.url);
    const beneficiary = searchParams.get("beneficiary");

    if (!beneficiary) {
      return NextResponse.json(
        { error: "Missing required query parameter: beneficiary" },
        { status: 400 },
      );
    }

    // Find campaign by tree_address
    const [campaign] = await db
      .select({ id: campaigns.id, merkleRoot: campaigns.merkleRoot })
      .from(campaigns)
      .where(eq(campaigns.treeAddress, treeAddress))
      .limit(1);

    if (!campaign) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 },
      );
    }

    // Get the latest root version for this campaign
    const [latestVersion] = await db
      .select({ id: rootVersions.id, version: rootVersions.version })
      .from(rootVersions)
      .where(eq(rootVersions.campaignId, campaign.id))
      .orderBy(sql`${rootVersions.version} DESC`)
      .limit(1);

    if (!latestVersion) {
      return NextResponse.json(
        { error: "No root version found for this campaign" },
        { status: 404 },
      );
    }

    // Find leaf by beneficiary + root_version_id
    const [leaf] = await db
      .select({
        leafIndex: leaves.leafIndex,
        beneficiary: leaves.beneficiary,
        amount: leaves.amount,
        releaseType: leaves.releaseType,
        startTime: leaves.startTime,
        cliffTime: leaves.cliffTime,
        endTime: leaves.endTime,
        milestoneIdx: leaves.milestoneIdx,
        proof: leaves.proof,
      })
      .from(leaves)
      .where(
        and(
          eq(leaves.beneficiary, beneficiary),
          eq(leaves.rootVersionId, latestVersion.id),
        ),
      )
      .limit(1);

    if (!leaf) {
      return NextResponse.json(
        { error: "No proof found for this beneficiary in this campaign" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      leaf: {
        leafIndex: leaf.leafIndex,
        beneficiary: leaf.beneficiary,
        amount: leaf.amount,
        releaseType: leaf.releaseType,
        startTime: leaf.startTime,
        cliffTime: leaf.cliffTime,
        endTime: leaf.endTime,
        milestoneIdx: leaf.milestoneIdx,
      },
      proof: leaf.proof,
      merkleRoot: campaign.merkleRoot,
      treeAddress,
    });
  } catch (error) {
    console.error("[GET /api/campaigns/:treeAddress/proof] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
