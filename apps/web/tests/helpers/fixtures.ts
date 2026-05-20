import { Keypair } from "@solana/web3.js";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as postCampaigns } from "@/app/api/campaigns/route";
import { db } from "@/lib/db";
import { campaigns, claimEvents } from "@/lib/db/schema";
import {
  computeSingleLeafRoot,
  makeCampaignBody,
  makeLeaf,
  makeUrl,
} from "./requests";

export function uniqueTreeAddress(): string {
  return Keypair.generate().publicKey.toBase58();
}

let nextOnChainCampaignId = 1;

export async function createCampaignViaPost(
  overrides: Record<string, unknown> = {},
): Promise<{
  treeAddress: string;
  campaignId: number;
  status: number;
}> {
  const treeAddress = (overrides.treeAddress as string) ?? uniqueTreeAddress();
  const onChainCampaignId =
    (overrides.campaignId as number | undefined) ?? nextOnChainCampaignId++;
  const leaf = makeLeaf(overrides.leaf as Record<string, unknown> | undefined);
  const leaves = (overrides.leaves as ReturnType<typeof makeLeaf>[] | undefined) ?? [
    leaf,
  ];
  const merkleRoot =
    (overrides.merkleRoot as string | undefined) ?? computeSingleLeafRoot(leaves[0]!);
  const body = makeCampaignBody({
    treeAddress,
    merkleRoot,
    leafCount: leaves.length,
    leaves,
    campaignId: onChainCampaignId,
    ...overrides,
  });

  const req = new NextRequest(makeUrl("/api/campaigns"), {
    method: "POST",
    body: JSON.stringify(body),
  });
  const res = await postCampaigns(req);
  const json = (await res.json()) as { campaignId?: number; error?: string };

  if (!json.campaignId) {
    throw new Error(
      `createCampaignViaPost failed: ${res.status} ${JSON.stringify(json)}`,
    );
  }

  return { treeAddress, campaignId: json.campaignId, status: res.status };
}

export async function seedClaimEvent(
  campaignId: number,
  overrides: Partial<{
    beneficiary: string;
    leafIndex: number;
    amount: number;
    totalClaimedByUser: number;
    totalClaimedOverall: number;
    signature: string;
    slot: number;
    blockTime: number;
  }> = {},
): Promise<void> {
  const sig = overrides.signature ?? `sig_${campaignId}_${Math.random()}`;
  await db.insert(claimEvents).values({
    campaignId,
    beneficiary: overrides.beneficiary ?? "11111111111111111111111111111111",
    leafIndex: overrides.leafIndex ?? 0,
    amount: BigInt(overrides.amount ?? 100000),
    totalClaimedByUser: BigInt(overrides.totalClaimedByUser ?? 100000),
    totalClaimedOverall: BigInt(overrides.totalClaimedOverall ?? 100000),
    milestoneIdx: null,
    signature: sig,
    slot: BigInt(overrides.slot ?? 1000),
    blockTime: BigInt(overrides.blockTime ?? 1700000000),
  });
}

export async function setCampaignStatus(
  treeAddress: string,
  patch: Partial<{
    paused: boolean;
    cancelledAt: string | number | null;
    totalClaimed: string | number;
    totalSupply: string | number;
    leafCount: number;
  }>,
): Promise<void> {
  const { cancelledAt, totalClaimed, totalSupply, ...rest } = patch;
  const update: Partial<typeof campaigns.$inferInsert> = { ...rest };
  if (cancelledAt !== undefined) {
    update.cancelledAt = cancelledAt === null ? null : BigInt(cancelledAt);
  }
  if (totalClaimed !== undefined) {
    update.totalClaimed = BigInt(totalClaimed);
  }
  if (totalSupply !== undefined) {
    update.totalSupply = BigInt(totalSupply);
  }
  await db.update(campaigns).set(update).where(eq(campaigns.treeAddress, treeAddress));
}
