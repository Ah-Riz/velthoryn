import { hashLeaf, type VestingLeaf } from "@/lib/merkle/builder";

export interface StreamSchedule {
  releaseType: number;
  startTime: number;
  cliffTime: number;
  endTime: number;
  milestoneIdx: number;
  beneficiary?: string;
  amount?: string;
  milestoneName?: string;
  milestoneOwner?: string;
  milestoneMode?: string;
  milestoneEvidence?: string;
}

const LOCAL_PREFIX = "velthoryn:stream:";
const PENDING_INDEX_PREFIX = "velthoryn:pending-index:";
const PENDING_FUND_PREFIX = "velthoryn:pending-fund:";

export interface StoredLocalStreamSchedule {
  treeAddress: string;
  schedule: StreamSchedule;
}

export interface CachedLocalCampaignSnapshot {
  creator: string;
  mint: string;
  campaignId: number;
  leafCount: number;
  totalSupply: string;
  totalClaimed: string;
  cancellable: boolean;
  paused: boolean;
  cancelledAt: number | null;
  createdAt: number;
  myClaimed?: string;
}

export interface StoredLocalStreamRecord extends StoredLocalStreamSchedule {
  cachedCampaign?: CachedLocalCampaignSnapshot;
}

interface LocalStreamStorageRecord {
  schedule: StreamSchedule;
  cachedCampaign?: CachedLocalCampaignSnapshot;
}

export function streamScheduleKey(treeAddress: string): string {
  return `${LOCAL_PREFIX}${treeAddress}`;
}

export function pendingCampaignIndexKey(treeAddress: string): string {
  return `${PENDING_INDEX_PREFIX}${treeAddress}`;
}

export function pendingCampaignFundingKey(treeAddress: string): string {
  return `${PENDING_FUND_PREFIX}${treeAddress}`;
}

function isStreamSchedule(value: unknown): value is StreamSchedule {
  if (!value || typeof value !== "object") return false;
  return "releaseType" in value && "startTime" in value && "cliffTime" in value && "endTime" in value;
}

function parseLocalStreamStorageRecord(raw: string): LocalStreamStorageRecord | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isStreamSchedule(parsed)) {
      return { schedule: parsed };
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      "schedule" in parsed &&
      isStreamSchedule((parsed as { schedule?: unknown }).schedule)
    ) {
      const record = parsed as LocalStreamStorageRecord;
      return {
        schedule: record.schedule,
        cachedCampaign: record.cachedCampaign,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveStreamScheduleLocal(
  treeAddress: string,
  schedule: StreamSchedule,
): void {
  if (typeof window === "undefined") return;
  try {
    const existing = loadLocalStreamRecord(treeAddress);
    const next: LocalStreamStorageRecord = {
      schedule,
      cachedCampaign: existing?.cachedCampaign,
    };
    localStorage.setItem(streamScheduleKey(treeAddress), JSON.stringify(next));
  } catch {
    // quota / private mode
  }
}

export function saveLocalCampaignSnapshotLocal(
  treeAddress: string,
  cachedCampaign: CachedLocalCampaignSnapshot,
): void {
  if (typeof window === "undefined") return;
  try {
    const existing = loadLocalStreamRecord(treeAddress);
    if (!existing) return;
    const next: LocalStreamStorageRecord = {
      schedule: existing.schedule,
      cachedCampaign,
    };
    localStorage.setItem(streamScheduleKey(treeAddress), JSON.stringify(next));
  } catch {
    // quota / private mode
  }
}

export function loadLocalStreamRecord(
  treeAddress: string,
): StoredLocalStreamRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(streamScheduleKey(treeAddress));
    if (!raw) return null;
    const record = parseLocalStreamStorageRecord(raw);
    if (!record) return null;
    return {
      treeAddress,
      schedule: record.schedule,
      cachedCampaign: record.cachedCampaign,
    };
  } catch {
    return null;
  }
}

export function loadStreamScheduleLocal(
  treeAddress: string,
): StreamSchedule | null {
  return loadLocalStreamRecord(treeAddress)?.schedule ?? null;
}

export function listLocalStreamSchedules(): StoredLocalStreamSchedule[] {
  return listLocalStreamRecords().map(({ treeAddress, schedule }) => ({
    treeAddress,
    schedule,
  }));
}

export function listLocalStreamRecords(): StoredLocalStreamRecord[] {
  if (typeof window === "undefined") return [];

  const streams: StoredLocalStreamRecord[] = [];

  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(LOCAL_PREFIX)) continue;

      const treeAddress = key.slice(LOCAL_PREFIX.length);
      const record = loadLocalStreamRecord(treeAddress);
      if (!record) continue;
      streams.push(record);
    }
  } catch {
    return [];
  }

  return streams;
}

export interface CampaignIndexPayload {
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

export function savePendingCampaignIndexLocal(
  payload: CampaignIndexPayload,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      pendingCampaignIndexKey(payload.treeAddress),
      JSON.stringify(payload),
    );
  } catch {
    // quota / private mode
  }
}

export function removePendingCampaignIndexLocal(treeAddress: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(pendingCampaignIndexKey(treeAddress));
  } catch {
    // noop
  }
}

export function listPendingCampaignIndexesLocal(): CampaignIndexPayload[] {
  if (typeof window === "undefined") return [];

  const payloads: CampaignIndexPayload[] = [];

  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PENDING_INDEX_PREFIX)) continue;

      const raw = localStorage.getItem(key);
      if (!raw) continue;

      try {
        payloads.push(JSON.parse(raw) as CampaignIndexPayload);
      } catch {
        // ignore malformed pending payloads
      }
    }
  } catch {
    return [];
  }

  return payloads;
}

export interface PendingCampaignFundingPayload {
  treeAddress: string;
  creator: string;
  mint: string;
  totalSupply: string;
  createdAt: number;
  createSig?: string;
}

export function savePendingCampaignFundingLocal(
  payload: PendingCampaignFundingPayload,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      pendingCampaignFundingKey(payload.treeAddress),
      JSON.stringify(payload),
    );
  } catch {
    // quota / private mode
  }
}

export function removePendingCampaignFundingLocal(treeAddress: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(pendingCampaignFundingKey(treeAddress));
  } catch {
    // noop
  }
}

export function listPendingCampaignFundingsLocal(): PendingCampaignFundingPayload[] {
  if (typeof window === "undefined") return [];

  const payloads: PendingCampaignFundingPayload[] = [];

  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PENDING_FUND_PREFIX)) continue;

      const raw = localStorage.getItem(key);
      if (!raw) continue;

      try {
        payloads.push(JSON.parse(raw) as PendingCampaignFundingPayload);
      } catch {
        // ignore malformed pending payloads
      }
    }
  } catch {
    return [];
  }

  return payloads;
}

export type CreateStreamIndexPayload = CampaignIndexPayload;

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
  pauseAuthority?: string | null;
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
    pauseAuthority: params.pauseAuthority ?? null,
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

export async function indexCampaign(
  payload: CampaignIndexPayload,
  authHeaders?: Record<string, string>,
): Promise<void> {
  savePendingCampaignIndexLocal(payload);

  const requestId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `campaign-index-${Date.now()}`;

  console.info("[indexCampaign] POST /api/campaigns:start", {
    requestId,
    treeAddress: payload.treeAddress,
    creator: payload.creator,
    mint: payload.mint,
    campaignId: payload.campaignId,
    leafCount: payload.leafCount,
    totalSupply: payload.totalSupply,
    firstLeaf: payload.leaves[0]
      ? {
          leafIndex: payload.leaves[0].leafIndex,
          beneficiary: payload.leaves[0].beneficiary,
          amount: payload.leaves[0].amount,
          releaseType: payload.leaves[0].releaseType,
          proofDepth: payload.leaves[0].proof.length,
        }
      : null,
  });

  const res = await fetch("/api/campaigns", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-request-id": requestId,
      ...authHeaders,
    },
    body: JSON.stringify(payload),
  });

  console.info("[indexCampaign] POST /api/campaigns:done", {
    requestId,
    status: res.status,
    ok: res.ok,
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("[indexCampaign] POST /api/campaigns:failed", {
      requestId,
      status: res.status,
      body,
    });
    throw new Error(`Index failed (${res.status}): ${body}`);
  }

  removePendingCampaignIndexLocal(payload.treeAddress);
}

export async function indexStreamCampaign(
  payload: CreateStreamIndexPayload,
  authHeaders?: Record<string, string>,
): Promise<void> {
  await indexCampaign(payload, authHeaders);
}
