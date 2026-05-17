import { hashLeaf, type VestingLeaf } from "@/lib/merkle/builder";

export interface StreamSchedule {
  releaseType: number;
  startTime: number;
  cliffTime: number;
  endTime: number;
  milestoneIdx: number;
}

const LOCAL_PREFIX = "velthoryn:stream:";

export function streamScheduleKey(treeAddress: string): string {
  return `${LOCAL_PREFIX}${treeAddress}`;
}

export function saveStreamScheduleLocal(
  treeAddress: string,
  schedule: StreamSchedule,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(streamScheduleKey(treeAddress), JSON.stringify(schedule));
  } catch {
    // quota / private mode
  }
}

export function loadStreamScheduleLocal(
  treeAddress: string,
): StreamSchedule | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(streamScheduleKey(treeAddress));
    if (!raw) return null;
    return JSON.parse(raw) as StreamSchedule;
  } catch {
    return null;
  }
}

export interface CreateStreamIndexPayload {
  treeAddress: string;
  creator: string;
  mint: string;
  campaignId: number;
  merkleRoot: string;
  leafCount: number;
  totalSupply: string;
  cancellable: boolean;
  cancelAuthority: string | null;
  pauseAuthority: string | null;
  createdAt: number;
  leaves: Array<{
    leafIndex: number;
    beneficiary: string;
    amount: string;
    releaseType: number;
    startTime: string;
    cliffTime: string;
    endTime: string;
    milestoneIdx: number;
    proof: number[][];
  }>;
}

export function buildCreateStreamIndexPayload(params: {
  treeAddress: string;
  creator: string;
  mint: string;
  campaignId: number;
  beneficiary: string;
  amount: string;
  releaseType: number;
  startTime: number;
  cliffTime: number;
  endTime: number;
  milestoneIdx: number;
  cancellable: boolean;
  cancelAuthority: string | null;
  createdAt?: number;
}): CreateStreamIndexPayload {
  const leafForHash: VestingLeaf = {
    leafIndex: 0,
    beneficiary: params.beneficiary,
    amount: BigInt(params.amount),
    releaseType: params.releaseType as 0 | 1 | 2,
    startTs: BigInt(params.startTime),
    cliffTs: BigInt(params.cliffTime),
    endTs: BigInt(params.endTime),
    milestoneIdx: params.milestoneIdx,
  };

  const merkleRoot = hashLeaf(leafForHash).toString("hex");

  return {
    treeAddress: params.treeAddress,
    creator: params.creator,
    mint: params.mint,
    campaignId: params.campaignId,
    merkleRoot,
    leafCount: 1,
    totalSupply: params.amount,
    cancellable: params.cancellable,
    cancelAuthority: params.cancelAuthority,
    pauseAuthority: null,
    createdAt: params.createdAt ?? Math.floor(Date.now() / 1000),
    leaves: [
      {
        leafIndex: 0,
        beneficiary: params.beneficiary,
        amount: params.amount,
        releaseType: params.releaseType,
        startTime: String(params.startTime),
        cliffTime: String(params.cliffTime),
        endTime: String(params.endTime),
        milestoneIdx: params.milestoneIdx,
        proof: [],
      },
    ],
  };
}

export async function indexStreamCampaign(
  payload: CreateStreamIndexPayload,
): Promise<void> {
  const res = await fetch("/api/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Index failed (${res.status}): ${body}`);
  }
}
