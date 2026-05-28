import { Keypair } from "@solana/web3.js";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as postCampaigns } from "@/app/api/campaigns/route";
import { db } from "@/lib/db";
import {
  campaigns,
  claimEvents,
  cancelEvents,
  pauseEvents,
  milestoneEvents,
  rootUpdateEvents,
  withdrawEvents,
  streamCancelEvents,
} from "@/lib/db/schema";
import {
  computeSingleLeafRoot,
  makeCampaignBody,
  makeLeaf,
  makeUrl,
} from "./requests";
import { createAuthHeader } from "./wallet-auth";
import { resetRedisForTests } from "@/lib/api/redis";

export function uniqueTreeAddress(): string {
  return Keypair.generate().publicKey.toBase58();
}

export async function createCampaignViaPost(
  overrides: Record<string, unknown> = {},
): Promise<{
  treeAddress: string;
  campaignId: number;
  status: number;
}> {
  const treeAddress = (overrides.treeAddress as string) ?? uniqueTreeAddress();
  const onChainCampaignId = overrides.campaignId as number | undefined;
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

  resetRedisForTests();
  const authorization = await createAuthHeader();
  const req = new NextRequest(makeUrl("/api/campaigns"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { authorization },
  });
  const res = await postCampaigns(req, { params: Promise.resolve({}) });
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
  const sig =
    overrides.signature ??
    `sig_${campaignId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
    minCliffTime: string | number | null;
    instantRefunded: boolean;
    cancellable: boolean;
  }>,
): Promise<void> {
  const { cancelledAt, totalClaimed, totalSupply, minCliffTime, ...rest } = patch;
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
  if (minCliffTime !== undefined) {
    update.minCliffTime = minCliffTime === null ? null : BigInt(minCliffTime);
  }
  await db.update(campaigns).set(update).where(eq(campaigns.treeAddress, treeAddress));
}

export async function seedMilestoneEvent(
  campaignId: number,
  overrides: Partial<{
    milestoneIdx: number;
    releasedBy: string;
    signature: string;
    slot: number;
    blockTime: number;
  }> = {},
): Promise<void> {
  const sig =
    overrides.signature ??
    `milestone_sig_${campaignId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await db.insert(milestoneEvents).values({
    campaignId,
    milestoneIdx: overrides.milestoneIdx ?? 0,
    releasedBy: overrides.releasedBy ?? "11111111111111111111111111111112",
    signature: sig,
    slot: BigInt(overrides.slot ?? 1000),
    blockTime: BigInt(overrides.blockTime ?? 1700000000),
  });
}

export async function seedCancelEvent(
  campaignId: number,
  overrides: Partial<{
    cancelledAt: number;
    claimedAtCancel: number;
    signature: string;
    slot: number;
    blockTime: number;
  }> = {},
): Promise<void> {
  const sig =
    overrides.signature ??
    `cancel_sig_${campaignId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await db.insert(cancelEvents).values({
    campaignId,
    cancelledAt: BigInt(overrides.cancelledAt ?? 1700050000),
    claimedAtCancel: BigInt(overrides.claimedAtCancel ?? 500000),
    signature: sig,
    slot: BigInt(overrides.slot ?? 1000),
    blockTime: BigInt(overrides.blockTime ?? 1700050000),
  });
}

export async function seedPauseEvent(
  campaignId: number,
  overrides: Partial<{
    paused: boolean;
    signature: string;
    slot: number;
    blockTime: number;
  }> = {},
): Promise<void> {
  const sig =
    overrides.signature ??
    `pause_sig_${campaignId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await db.insert(pauseEvents).values({
    campaignId,
    paused: overrides.paused ?? true,
    signature: sig,
    slot: BigInt(overrides.slot ?? 1000),
    blockTime: BigInt(overrides.blockTime ?? 1700010000),
  });
}

export async function seedWithdrawEvent(
  campaignId: number,
  overrides: Partial<{
    amount: number;
    signature: string;
    slot: number;
    blockTime: number;
  }> = {},
): Promise<void> {
  const sig =
    overrides.signature ??
    `withdraw_sig_${campaignId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await db.insert(withdrawEvents).values({
    campaignId,
    amount: BigInt(overrides.amount ?? 200000),
    signature: sig,
    slot: BigInt(overrides.slot ?? 1000),
    blockTime: BigInt(overrides.blockTime ?? 1700060000),
  });
}

export async function seedRootUpdateEvent(
  campaignId: number,
  overrides: Partial<{
    oldRoot: string;
    newRoot: string;
    newLeafCount: number;
    signature: string;
    slot: number;
    blockTime: number;
  }> = {},
): Promise<void> {
  const sig =
    overrides.signature ??
    `root_sig_${campaignId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await db.insert(rootUpdateEvents).values({
    campaignId,
    oldRoot: overrides.oldRoot ?? "aa".repeat(32),
    newRoot: overrides.newRoot ?? "bb".repeat(32),
    newLeafCount: overrides.newLeafCount ?? 2,
    signature: sig,
    slot: BigInt(overrides.slot ?? 1000),
    blockTime: BigInt(overrides.blockTime ?? 1700020000),
  });
}

export async function seedStreamCancelEvent(
  campaignId: number,
  overrides: Partial<{
    cancelledAt: number;
    amountToBeneficiary: number;
    amountToCreator: number;
    signature: string;
    slot: number;
    blockTime: number;
  }> = {},
): Promise<void> {
  const sig =
    overrides.signature ??
    `stream_cancel_sig_${campaignId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await db.insert(streamCancelEvents).values({
    campaignId,
    cancelledAt: BigInt(overrides.cancelledAt ?? 1700070000),
    amountToBeneficiary: BigInt(overrides.amountToBeneficiary ?? 300000),
    amountToCreator: BigInt(overrides.amountToCreator ?? 700000),
    signature: sig,
    slot: BigInt(overrides.slot ?? 1000),
    blockTime: BigInt(overrides.blockTime ?? 1700070000),
  });
}
