"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { derivePda } from "@/lib/anchor/client";
import {
  listLocalStreamRecords,
  saveLocalCampaignSnapshotLocal,
  isStreamSettledLocal,
  type CachedLocalCampaignSnapshot,
} from "@/lib/stream/persist";
import { useVestingProgram } from "./useVestingProgram";

type LocalSenderCampaign = {
  treeAddress: string;
  creator: string;
  mint: string;
  campaignId: number;
  leafCount: number;
  totalSupply: string;
  totalClaimed: string;
  cancellable: boolean;
  paused: boolean;
  cancelledAt: number | null;
  instantRefunded: boolean;
  streamSettled: boolean;
  createdAt: number;
  metadata: null;
};

type LocalRecipientCampaign = {
  treeAddress: string;
  creator: string;
  mint: string;
  campaignId: number;
  totalSupply: string;
  leafCount: number;
  paused: boolean;
  cancelledAt: number | null;
  createdAt: number;
  metadata: null;
  myClaimed: string;
  myLeaf: {
    leafIndex: number;
    amount: string;
    releaseType: number;
    startTime: number;
    cliffTime: number;
    endTime: number;
    milestoneIdx: number;
  };
};

type LocalCampaignsState = {
  senderCampaigns: LocalSenderCampaign[];
  recipientCampaigns: LocalRecipientCampaign[];
  isLoading: boolean;
  error: string | null;
};

type ClaimRecordAccount = {
  claimedAmount?: { toString(): string };
};

type VestingTreeAccount = {
  creator: { toBase58(): string };
  mint: { toBase58(): string };
  campaignId: { toString(): string };
  totalSupply: { toString(): string };
  totalClaimed: { toString(): string };
  cancelledAt?: { toString(): string } | null;
  instantRefunded?: boolean;
  createdAt: { toString(): string };
  leafCount: { toString(): string } | number;
  cancellable: unknown;
  paused: unknown;
};

function buildSenderCampaign(
  treeAddress: string,
  currentAddress: string,
  cached: CachedLocalCampaignSnapshot,
): LocalSenderCampaign | null {
  if (cached.creator !== currentAddress) return null;

  return {
    treeAddress,
    creator: cached.creator,
    mint: cached.mint,
    campaignId: cached.campaignId,
    leafCount: cached.leafCount,
    totalSupply: cached.totalSupply,
    totalClaimed: cached.totalClaimed,
    cancellable: cached.cancellable,
    paused: cached.paused,
    cancelledAt: cached.cancelledAt,
    instantRefunded: cached.instantRefunded ?? false,
    streamSettled: isStreamSettledLocal(treeAddress),
    createdAt: cached.createdAt,
    metadata: null,
  };
}

function buildRecipientCampaign(
  treeAddress: string,
  currentAddress: string,
  schedule: {
    beneficiary?: string;
    amount?: string;
    releaseType: number;
    startTime: number;
    cliffTime: number;
    endTime: number;
    milestoneIdx: number;
  },
  cached: CachedLocalCampaignSnapshot,
): LocalRecipientCampaign | null {
  if (schedule.beneficiary !== currentAddress) return null;

  return {
    treeAddress,
    creator: cached.creator,
    mint: cached.mint,
    campaignId: cached.campaignId,
    totalSupply: cached.totalSupply,
    leafCount: cached.leafCount,
    paused: cached.paused,
    cancelledAt: cached.cancelledAt,
    createdAt: cached.createdAt,
    metadata: null,
    myClaimed: cached.myClaimed ?? "0",
    myLeaf: {
      leafIndex: 0,
      amount: schedule.amount ?? cached.totalSupply,
      releaseType: schedule.releaseType,
      startTime: schedule.startTime,
      cliffTime: schedule.cliffTime,
      endTime: schedule.endTime,
      milestoneIdx: schedule.milestoneIdx,
    },
  };
}

async function retry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, 500 * (attempt + 1));
        });
      }
    }
  }

  throw lastError;
}

export function useLocalCampaigns(address: string | undefined, refreshKey?: number): LocalCampaignsState {
  const program = useVestingProgram();
  const [state, setState] = useState<LocalCampaignsState>(() => ({
    senderCampaigns: [],
    recipientCampaigns: [],
    isLoading: !!address && listLocalStreamRecords().length > 0,
    error: null,
  }));

  useEffect(() => {
    if (!address) {
      setState({ senderCampaigns: [], recipientCampaigns: [], isLoading: false, error: null });
      return;
    }
    if (!program) {
      const hasLocal = listLocalStreamRecords().length > 0;
      setState((prev) => ({ ...prev, isLoading: hasLocal }));
      return;
    }

    const currentAddress = address;
    const activeProgram = program;
    const localStreams = listLocalStreamRecords();
    if (localStreams.length === 0) {
      setState({
        senderCampaigns: [],
        recipientCampaigns: [],
        isLoading: false,
        error: null,
      });
      return;
    }

    let cancelled = false;

    async function load() {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const addressKey = new PublicKey(currentAddress);

        async function fetchOne({ treeAddress, schedule, cachedCampaign }: (typeof localStreams)[number]) {
            try {
              const treePubkey = new PublicKey(treeAddress);
              const account = (await retry(
                () => (activeProgram.account as any).vestingTree.fetch(treePubkey),
              )) as VestingTreeAccount;

              const creator = account.creator.toBase58();
              const mint = account.mint.toBase58();
              const campaignId = Number(account.campaignId.toString());
              const totalSupply = account.totalSupply.toString();
              const totalClaimed = account.totalClaimed.toString();
              const cancelledAt = account.cancelledAt
                ? Number(account.cancelledAt.toString())
                : null;
              const createdAt = Number(account.createdAt.toString());
              const leafCount = Number(account.leafCount);

              const instantRefunded = Boolean(account.instantRefunded);

              const senderCampaign =
                creator === currentAddress
                  ? {
                      treeAddress,
                      creator,
                      mint,
                      campaignId,
                      leafCount,
                      totalSupply,
                      totalClaimed,
                      cancellable: Boolean(account.cancellable),
                      paused: Boolean(account.paused),
                      cancelledAt,
                      instantRefunded,
                      streamSettled: isStreamSettledLocal(treeAddress),
                      createdAt,
                      metadata: null,
                    }
                  : null;

              const isRecipient = schedule.beneficiary === currentAddress;
              let myClaimed = "0";

              if (isRecipient) {
                try {
                  const [claimRecordPda] = derivePda([
                    "claim",
                    treePubkey.toBuffer(),
                    addressKey.toBuffer(),
                  ]);
                  const claimRecord = (await retry(
                    () => (activeProgram.account as any).claimRecord.fetch(claimRecordPda),
                    2,
                  )) as ClaimRecordAccount;
                  myClaimed = claimRecord.claimedAmount?.toString() ?? "0";
                } catch {
                  myClaimed = "0";
                }
              }

              saveLocalCampaignSnapshotLocal(treeAddress, {
                creator,
                mint,
                campaignId,
                leafCount,
                totalSupply,
                totalClaimed,
                cancellable: Boolean(account.cancellable),
                paused: Boolean(account.paused),
                cancelledAt,
                instantRefunded,
                createdAt,
                myClaimed,
              });

              const recipientCampaign =
                isRecipient
                  ? {
                      treeAddress,
                      creator,
                      mint,
                      campaignId,
                      totalSupply,
                      leafCount,
                      paused: Boolean(account.paused),
                      cancelledAt,
                      createdAt,
                      metadata: null,
                      myClaimed,
                      myLeaf: {
                        leafIndex: 0,
                        amount: totalSupply,
                        releaseType: schedule.releaseType,
                        startTime: schedule.startTime,
                        cliffTime: schedule.cliffTime,
                        endTime: schedule.endTime,
                        milestoneIdx: schedule.milestoneIdx,
                      },
                    }
                  : null;

              return { senderCampaign, recipientCampaign };
            } catch {
              if (!cachedCampaign) return null;
              return {
                senderCampaign: buildSenderCampaign(
                  treeAddress,
                  currentAddress,
                  cachedCampaign,
                ),
                recipientCampaign: buildRecipientCampaign(
                  treeAddress,
                  currentAddress,
                  schedule,
                  cachedCampaign,
                ),
              };
            }
        }

        const BATCH_SIZE = 2;
        const results: (Awaited<ReturnType<typeof fetchOne>>)[] = [];
        for (let i = 0; i < localStreams.length; i += BATCH_SIZE) {
          if (cancelled) break;
          const batch = localStreams.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.all(batch.map(fetchOne));
          results.push(...batchResults);
          if (i + BATCH_SIZE < localStreams.length) {
            await new Promise((r) => setTimeout(r, 300));
          }
        }

        if (cancelled) {
          setState((prev) => ({ ...prev, isLoading: false }));
          return;
        }

        setState({
          senderCampaigns: results
            .flatMap((result) => (result?.senderCampaign ? [result.senderCampaign] : [])),
          recipientCampaigns: results
            .flatMap((result) => (result?.recipientCampaign ? [result.recipientCampaign] : [])),
          isLoading: false,
          error: null,
        });
      } catch (error) {
        if (cancelled) return;
        setState({
          senderCampaigns: [],
          recipientCampaigns: [],
          isLoading: false,
          error: error instanceof Error ? error.message : "Failed to load local streams",
        });
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [address, program, refreshKey]);

  return state;
}
