import { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/api/json-response";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, rootVersions, leaves } from "@/lib/db/schema";
import { NotFoundError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";

async function getLeavesHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ treeAddress: string }> },
) {
  const { treeAddress } = await params;

  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.treeAddress, treeAddress))
    .limit(1);

  if (!campaign) {
    throw new NotFoundError("Campaign");
  }

  const [latestVersion] = await db
    .select({ id: rootVersions.id })
    .from(rootVersions)
    .where(eq(rootVersions.campaignId, campaign.id))
    .orderBy(sql`${rootVersions.version} DESC`)
    .limit(1);

  if (!latestVersion) {
    throw new NotFoundError("Root version");
  }

  const allLeaves = await db
    .select({
      leafIndex: leaves.leafIndex,
      beneficiary: leaves.beneficiary,
      amount: leaves.amount,
      releaseType: leaves.releaseType,
      startTime: leaves.startTime,
      cliffTime: leaves.cliffTime,
      endTime: leaves.endTime,
      milestoneIdx: leaves.milestoneIdx,
    })
    .from(leaves)
    .where(eq(leaves.rootVersionId, latestVersion.id))
    .orderBy(leaves.leafIndex);

  return jsonResponse({ leaves: allLeaves });
}

export const GET = withRoute(
  { rateLimit: { requests: 30, window: 60 } },
  getLeavesHandler,
);
