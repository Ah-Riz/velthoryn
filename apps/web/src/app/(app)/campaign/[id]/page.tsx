"use client";

import { useEffect, useState, useCallback, use, useMemo, useRef } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { isNativeSol, isWrappedSol } from "@/lib/sol/auto-wrap";
import { WrapSolModal } from "@/components/campaign/create/WrapSolModal";
import { useVestingProgram } from "@/hooks/useVestingProgram";
import { useProofLookup } from "@/hooks/useProofLookup";
import { useClaimRecord } from "@/hooks/useClaimRecord";
import { useCampaignDetail } from "@/hooks/useCampaignDetail";
import { useCreateCampaign } from "@/hooks/useCreateCampaign";
import { derivePda } from "@/lib/anchor/client";
import { formatVestingError } from "@/lib/anchor/errors";
import { unixToDatetimeLocal, datetimeLocalToUnix } from "@/lib/stream/datetime";
import {
  loadStreamScheduleLocal,
  removePendingCampaignFundingLocal,
  markStreamSettledLocal,
  isStreamSettledLocal,
} from "@/lib/stream/persist";
import { CancelConfirmDialog } from "@/components/campaign/detail/CancelConfirmDialog";
import { CampaignStatusBanner } from "@/components/campaign/detail/CampaignStatusBanner";

import { MilestoneStatusBadge } from "@/components/campaign/detail/MilestoneStatusBadge";
import { PauseToggleButton } from "@/components/campaign/detail/PauseToggleButton";
import { TriggerMilestoneButton } from "@/components/campaign/detail/TriggerMilestoneButton";
import { MilestoneReleasePanel } from "@/components/campaign/detail/MilestoneReleasePanel";
import { MilestoneCarouselCard } from "@/components/campaign/detail/MilestoneCarouselCard";
import { CloseClaimRecordButton } from "@/components/campaign/detail/CloseClaimRecordButton";
import { WithdrawUnvestedButton } from "@/components/campaign/detail/WithdrawUnvestedButton";
import { ClaimWithProofButton } from "@/components/campaign/detail/ClaimWithProofButton";
import { VestingChart } from "@/components/campaign/detail/VestingChart";
import { CampaignTimeline } from "@/components/campaign/detail/CampaignTimeline";
import { useCampaignTimeline } from "@/hooks/useCampaignTimeline";
import { useToast } from "@/components/shell/Toast";
import {
  getVestingTypeLabel,
  getVestingTypeBadgeColor,
  formatCountdown,
  getWithdrawDisabledReason,
} from "@/lib/vesting/display";
import { isMilestoneTriggered } from "@/lib/vesting/milestone";
import { POPULAR_TOKENS } from "@/lib/constants/popular-tokens";
import {
  canCancelCampaign,
  canCancelStream,
  canInstantRefund,
  canPauseCampaign,
  canReleaseMilestone,
  canRotateRoot,
  canWithdrawUnvested,
} from "@/lib/campaign/authority";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type TreeState = {
  creator: PublicKey;
  mint: PublicKey;
  vault: PublicKey;
  vaultAuthority: PublicKey;
  campaignId: BN;
  merkleRoot: number[];
  totalSupply: BN;
  totalClaimed: BN;
  cancellable: boolean;
  cancelAuthority: PublicKey | null;
  cancelledAt: BN | null;
  paused: boolean;
  pauseAuthority: PublicKey | null;
  createdAt: BN;
  leafCount: number;
  milestoneReleasedFlags: Uint8Array;
  minCliffTime: BN;
  instantRefunded: boolean;
  bump: number;
};

type ScheduleSource = "none" | "api" | "local" | "url" | "manual";
type MilestoneUiMeta = {
  name: string | null;
  owner: string | null;
  mode: string | null;
  evidence: string | null;
};
type ProofLeaf = {
  leafIndex: number;
  beneficiary: string;
  amount: number;
  releaseType: number;
  startTime: number;
  cliffTime: number;
  endTime: number;
  milestoneIdx: number;
};
type LeafWithProof = {
  leaf: ProofLeaf;
  proof: number[][];
};
type UrlScheduleLoadResult = {
  loaded: boolean;
  beneficiary: string | null;
  milestoneUi: MilestoneUiMeta;
};

const ONCHAIN_TREE_FETCH_TIMEOUT_MS = 8000;
const ONCHAIN_TREE_FETCH_TIMEOUT_MESSAGE = "Timed out fetching vesting tree";

function buildIndexedFallbackTreeState(detail: {
  creator: string;
  mint: string;
  campaignId: number;
  merkleRoot: string;
  totalSupply: number | string;
  totalClaimed: number | string;
  cancellable: boolean;
  paused: boolean;
  cancelledAt: number | null;
  minCliffTime?: number | null;
  instantRefunded?: boolean;
  createdAt: number;
  leafCount: number;
  cancelAuthority?: string | null;
  pauseAuthority?: string | null;
}): TreeState | null {
  try {
    const merkleRoot = detail.merkleRoot.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? new Array(32).fill(0);
    return {
      creator: new PublicKey(detail.creator),
      mint: new PublicKey(detail.mint),
      vault: SystemProgram.programId,
      vaultAuthority: SystemProgram.programId,
      campaignId: new BN(detail.campaignId),
      merkleRoot,
      totalSupply: new BN(String(detail.totalSupply)),
      totalClaimed: new BN(String(detail.totalClaimed)),
      cancellable: detail.cancellable,
      cancelAuthority: detail.cancelAuthority ? new PublicKey(detail.cancelAuthority) : null,
      cancelledAt: detail.cancelledAt !== null ? new BN(detail.cancelledAt) : null,
      paused: detail.paused,
      pauseAuthority: detail.pauseAuthority ? new PublicKey(detail.pauseAuthority) : null,
      createdAt: new BN(detail.createdAt),
      leafCount: detail.leafCount,
      milestoneReleasedFlags: new Uint8Array(32),
      minCliffTime: detail.minCliffTime != null ? new BN(detail.minCliffTime) : new BN(0),
      instantRefunded: detail.instantRefunded ?? false,
      bump: 0,
    };
  } catch {
    return null;
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/* ------------------------------------------------------------------ */
/*  Vesting math (unchanged business logic)                           */
/* ------------------------------------------------------------------ */

function vestedAmount(
  amount: bigint,
  releaseType: number,
  cliffTs: bigint,
  endTs: bigint,
  cancelledAt: bigint | null,
  now: bigint,
  milestoneReleased?: boolean,
): bigint {
  const effectiveNow = cancelledAt !== null && cancelledAt < now ? cancelledAt : now;

  switch (releaseType) {
    case 0:
      return effectiveNow >= cliffTs ? amount : 0n;
    case 1: {
      if (effectiveNow >= endTs) return amount;
      if (effectiveNow <= cliffTs) return 0n;
      const elapsed = effectiveNow - cliffTs;
      const duration = endTs - cliffTs;
      return (amount * elapsed) / duration;
    }
    case 2:
      return (milestoneReleased ?? false) && effectiveNow >= cliffTs ? amount : 0n;
    default:
      return 0n;
  }
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function progressPercent(vested: bigint, total: bigint): number {
  if (total === 0n) return 0;
  return Number((vested * 100n) / total);
}

function applyScheduleToForm(
  leaf: {
    releaseType: number;
    startTime: number;
    cliffTime: number;
    endTime: number;
    milestoneIdx: number;
  },
  setters: {
    setReleaseType: (v: number) => void;
    setStartTime: (v: string) => void;
    setCliffTime: (v: string) => void;
    setEndTime: (v: string) => void;
    setMilestoneIdx: (v: string) => void;
    setRawStartTs?: (v: number | null) => void;
    setRawCliffTs?: (v: number | null) => void;
    setRawEndTs?: (v: number | null) => void;
  },
) {
  setters.setReleaseType(leaf.releaseType);
  setters.setStartTime(unixToDatetimeLocal(leaf.startTime));
  setters.setCliffTime(unixToDatetimeLocal(leaf.cliffTime));
  setters.setEndTime(unixToDatetimeLocal(leaf.endTime));
  setters.setRawStartTs?.(leaf.startTime);
  setters.setRawCliffTs?.(leaf.cliffTime);
  setters.setRawEndTs?.(leaf.endTime);
  setters.setMilestoneIdx(String(leaf.milestoneIdx));
}

/* ------------------------------------------------------------------ */
/*  Helpers: truncate address for display                             */
/* ------------------------------------------------------------------ */

function truncateAddress(addr: string, chars = 6): string {
  if (addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
}

function waitForLoadingPaint() {
  return new Promise<void>((resolve) => setTimeout(resolve, 250));
}

/* ------------------------------------------------------------------ */
/*  Page component                                                    */
/* ------------------------------------------------------------------ */

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: treeAddress } = use(params);
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const program = useVestingProgram();
  const { fundCampaign } = useCreateCampaign();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [treeState, setTreeState] = useState<TreeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mintDecimals, setMintDecimals] = useState<number | null>(null);

  const [releaseType, setReleaseType] = useState(1);
  const [startTime, setStartTime] = useState("");
  const [cliffTime, setCliffTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [milestoneIdx, setMilestoneIdx] = useState("0");
  // Raw unix timestamps for withdraw (avoids datetime-local second truncation)
  const [rawStartTs, setRawStartTs] = useState<number | null>(null);
  const [rawCliffTs, setRawCliffTs] = useState<number | null>(null);
  const [rawEndTs, setRawEndTs] = useState<number | null>(null);
  const [scheduleSource, setScheduleSource] = useState<ScheduleSource>("none");
  const [showManualSchedule, setShowManualSchedule] = useState(false);
  const [expectedBeneficiary, setExpectedBeneficiary] = useState<string | null>(null);
  const [milestoneUi, setMilestoneUi] = useState<MilestoneUiMeta>({
    name: null,
    owner: null,
    mode: null,
    evidence: null,
  });

  const [txStatus, setTxStatus] = useState<
    { type: "idle" } | { type: "loading" } | { type: "success"; sig: string } | { type: "error"; msg: string }
  >({ type: "idle" });
  const [fundingStatus, setFundingStatus] = useState<
    { type: "idle" } | { type: "loading" } | { type: "error"; msg: string }
  >({ type: "idle" });

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [instantRefundLoading, setInstantRefundLoading] = useState(false);
  const [streamSettled, setStreamSettled] = useState(() => isStreamSettledLocal(treeAddress));
  const [manualBeneficiary, setManualBeneficiary] = useState("");
  const [nowUnix, setNowUnix] = useState(() => Math.floor(Date.now() / 1000));
  const treeMint = treeState?.mint;
  const isWrappedSolStream = treeMint ? isWrappedSol(treeMint) : false;
  const mintLabel = treeMint
    ? isNativeSol(treeMint)
      ? "SOL (native)"
      : isWrappedSol(treeMint)
        ? "wSOL"
        : treeMint.toBase58()
    : null;
  const [wrapModalOpen, setWrapModalOpen] = useState(false);
  const [recipientsOpen, setRecipientsOpen] = useState(false);
  const withdrawButtonRef = useRef<HTMLButtonElement>(null);
  const fetchTreeInFlightRef = useRef<Promise<void> | null>(null);
  const lastFetchTreeAtRef = useRef(0);
  const treeStateRef = useRef<TreeState | null>(null);
  const campaignDetailRef = useRef<ReturnType<typeof useCampaignDetail>["data"]>(undefined);
  const lastMissingTreeAddressRef = useRef<string | null>(null);

  const isSingleLeaf = treeState?.leafCount === 1;
  const beneficiaryKey = publicKey?.toBase58();
  const localSchedule = useMemo(
    () => loadStreamScheduleLocal(treeAddress),
    [treeAddress],
  );
  const proofBeneficiary = useMemo(() => {
    if (!beneficiaryKey) return undefined;
    // Single-stream/local flows already persist schedule client-side; avoid
    // unnecessary proof lookups that only apply to indexed Merkle campaigns.
    if (localSchedule) {
      return undefined;
    }
    return beneficiaryKey;
  }, [beneficiaryKey, localSchedule]);
  const proofQuery = useProofLookup(
    treeAddress,
    proofBeneficiary,
  );
  const proofAllQuery = useQuery<LeafWithProof[] | null>({
    queryKey: ["proof-all", treeAddress, beneficiaryKey],
    queryFn: async () => {
      const params = new URLSearchParams({ beneficiary: beneficiaryKey!, all: "true" });
      const res = await fetch(`/api/campaigns/${treeAddress}/proof?${params}`);
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`Failed to fetch proof list: ${res.status}`);
      }
      const data = await res.json();
      return data.leaves ?? (data.leaf ? [{ leaf: data.leaf, proof: data.proof }] : null);
    },
    enabled: !!treeAddress && !!beneficiaryKey && (treeState?.leafCount ?? 0) > 1,
    staleTime: 30_000,
  });
  const campaignDetailQuery = useCampaignDetail(treeAddress);
  const timelineQuery = useCampaignTimeline(treeAddress);

  const claimRecordQuery = useClaimRecord(treeAddress, beneficiaryKey);

  useEffect(() => {
    treeStateRef.current = treeState;
  }, [treeState]);

  useEffect(() => {
    campaignDetailRef.current = campaignDetailQuery.data;
  }, [campaignDetailQuery.data]);

  const scheduleLocked =
    isSingleLeaf &&
    (scheduleSource === "api" || scheduleSource === "local" || scheduleSource === "url") &&
    !showManualSchedule;

  /* ---- Fetch on-chain tree state ---- */

  const fetchTree = useCallback(async (force = false) => {
    if (!program) return;
    const now = Date.now();
    if (fetchTreeInFlightRef.current) {
      await fetchTreeInFlightRef.current;
      return;
    }
    if (!force && now - lastFetchTreeAtRef.current < 1500) {
      return;
    }

    const shouldShowLoading = !treeStateRef.current;
    if (shouldShowLoading) {
      setLoading(true);
    }
    const run = (async () => {
      try {
        const treePubkey = new PublicKey(treeAddress);
        const account = await withTimeout<any>(
          (program.account as any).vestingTree.fetch(treePubkey),
          ONCHAIN_TREE_FETCH_TIMEOUT_MS,
          ONCHAIN_TREE_FETCH_TIMEOUT_MESSAGE,
        );
        lastMissingTreeAddressRef.current = null;
        setTreeState({
          creator: account.creator,
          mint: account.mint,
          vault: account.vault,
          vaultAuthority: account.vaultAuthority,
          campaignId: account.campaignId,
          merkleRoot: account.merkleRoot,
          totalSupply: account.totalSupply,
          totalClaimed: account.totalClaimed,
          cancellable: account.cancellable,
          cancelAuthority: account.cancelAuthority ?? null,
          cancelledAt: account.cancelledAt ?? null,
          paused: account.paused,
          pauseAuthority: account.pauseAuthority ?? null,
          createdAt: account.createdAt,
          leafCount: account.leafCount,
          milestoneReleasedFlags: new Uint8Array(account.milestoneReleasedFlags ?? new Array(32).fill(0)),
          minCliffTime: account.minCliffTime ?? new BN(0),
          instantRefunded: account.instantRefunded ?? false,
          bump: account.bump,
        });
        setError(null);
        lastFetchTreeAtRef.current = Date.now();
        // Invalidate campaign list caches so My Campaigns page shows updated status
        void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
        void queryClient.invalidateQueries({ queryKey: ["beneficiaryCampaigns"] });
      } catch (err: unknown) {
        const rawMessage = err instanceof Error ? err.message : String(err);
        if (
          rawMessage.includes("Account does not exist or has no data") ||
          rawMessage.includes(ONCHAIN_TREE_FETCH_TIMEOUT_MESSAGE)
        ) {
          if (lastMissingTreeAddressRef.current !== treeAddress) {
            console.warn("[CampaignPage] Ignoring non-fatal account fetch error:", rawMessage);
            lastMissingTreeAddressRef.current = treeAddress;
          }
          const existing = treeStateRef.current;
          const fallback = campaignDetailRef.current
            ? buildIndexedFallbackTreeState(campaignDetailRef.current)
            : null;
          if (existing && fallback) {
            const existingClaimed = BigInt(existing.totalClaimed.toString());
            const fallbackClaimed = BigInt(fallback.totalClaimed.toString());
            setTreeState({
              ...fallback,
              totalClaimed: new BN(
                (existingClaimed > fallbackClaimed ? existingClaimed : fallbackClaimed).toString(),
              ),
            });
          } else if (existing) {
            setTreeState(existing);
          } else if (fallback) {
            setTreeState(fallback);
          }
          setError(null);
          lastFetchTreeAtRef.current = Date.now();
          return;
        }
        if (treeStateRef.current) {
          console.warn("[CampaignPage] Background refresh failed:", err);
          setError(null);
          return;
        }
        setError(formatVestingError(err));
      } finally {
        if (shouldShowLoading) {
          setLoading(false);
        }
      }
    })();

    fetchTreeInFlightRef.current = run;
    try {
      await run;
    } finally {
      fetchTreeInFlightRef.current = null;
    }
  }, [program, treeAddress, queryClient]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  useEffect(() => {
    if (treeState || loading || !campaignDetailQuery.data) return;
    const fallback = buildIndexedFallbackTreeState(campaignDetailQuery.data);
    if (fallback) {
      setTreeState(fallback);
      setError(null);
    }
  }, [treeState, loading, campaignDetailQuery.data]);

  // Real-time: subscribe to on-chain account changes for auto-refresh
  useEffect(() => {
    if (!treeAddress) return;
    let subId: number | undefined;
    try {
      const treePubkey = new PublicKey(treeAddress);
      subId = connection.onAccountChange(treePubkey, () => {
        void fetchTree();
      }, "confirmed");
    } catch { /* invalid address, skip */ }
    return () => {
      if (subId !== undefined) connection.removeAccountChangeListener(subId);
    };
  }, [treeAddress, connection, fetchTree]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowUnix(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!treeMint) {
      setMintDecimals(null);
      return;
    }
    if (isNativeSol(treeMint)) {
      setMintDecimals(9);
      return;
    }
    const popularToken = POPULAR_TOKENS.find((token) => token.mint === treeMint.toBase58());
    if (popularToken) {
      setMintDecimals(popularToken.decimals);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const parsedInfo = await connection.getParsedAccountInfo(treeMint);
        const parsed = (parsedInfo.value?.data as any)?.parsed;
        if (parsed?.type === "mint") {
          if (!cancelled) setMintDecimals(parsed.info.decimals);
          return;
        }
      } catch {
        // Fall back to raw account parsing below.
      }

      try {
        const rawInfo = await connection.getAccountInfo(treeMint);
        if (cancelled || !rawInfo || rawInfo.data.length < 45) return;
        setMintDecimals(rawInfo.data[44]);
      } catch {
        if (!cancelled) setMintDecimals(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [treeMint, connection]);

  /* ---- Load schedule from API / local / URL / manual ---- */

  function tryLoadFromUrl(): UrlScheduleLoadResult {
    if (typeof window === "undefined") {
      return {
        loaded: false,
        beneficiary: null,
        milestoneUi: { name: null, owner: null, mode: null, evidence: null },
      };
    }
    const url = new URL(window.location.href);
    const rt = url.searchParams.get("rt");
    const st = url.searchParams.get("st");
    const ct = url.searchParams.get("ct");
    const et = url.searchParams.get("et");
    const mi = url.searchParams.get("mi");
    const bf = url.searchParams.get("bf");
    const mn = url.searchParams.get("mn");
    const mo = url.searchParams.get("mo");
    const mm = url.searchParams.get("mm");
    const me = url.searchParams.get("me");
    if (ct && et) {
      applyScheduleToForm(
        {
          releaseType: Number(rt ?? 1),
          startTime: Number(st ?? 0),
          cliffTime: Number(ct),
          endTime: Number(et),
          milestoneIdx: Number(mi ?? 0),
        },
        { setReleaseType, setStartTime, setCliffTime, setEndTime, setMilestoneIdx, setRawStartTs, setRawCliffTs, setRawEndTs },
      );
      return {
        loaded: true,
        beneficiary: bf,
        milestoneUi: {
          name: mn,
          owner: mo,
          mode: mm,
          evidence: me,
        },
      };
    }
    return {
      loaded: false,
      beneficiary: null,
      milestoneUi: { name: null, owner: null, mode: null, evidence: null },
    };
  }

  useEffect(() => {
    if (!publicKey) return;

    // API proof available — use it (works for both single and multi-leaf)
    if (proofQuery.data?.leaf) {
      applyScheduleToForm(proofQuery.data.leaf, {
        setReleaseType,
        setStartTime,
        setCliffTime,
        setEndTime,
        setMilestoneIdx,
        setRawStartTs,
        setRawCliffTs,
        setRawEndTs,
      });
      setExpectedBeneficiary(proofQuery.data.leaf.beneficiary);
      setScheduleSource("api");
      return;
    }

    // Fallback: localStorage or URL params (only if API didn't return data)
    if (
      scheduleSource !== "api" &&
      (proofQuery.isError || proofBeneficiary === undefined)
    ) {
      if (localSchedule) {
        applyScheduleToForm(
          {
            releaseType: localSchedule.releaseType,
            startTime: localSchedule.startTime,
            cliffTime: localSchedule.cliffTime,
            endTime: localSchedule.endTime,
            milestoneIdx: localSchedule.milestoneIdx,
          },
          {
            setReleaseType,
            setStartTime,
            setCliffTime,
            setEndTime,
            setMilestoneIdx,
            setRawStartTs,
            setRawCliffTs,
            setRawEndTs,
          },
        );
        setExpectedBeneficiary(localSchedule.beneficiary ?? null);
        setMilestoneUi({
          name: localSchedule.milestoneName ?? null,
          owner: localSchedule.milestoneOwner ?? null,
          mode: localSchedule.milestoneMode ?? null,
          evidence: localSchedule.milestoneEvidence ?? null,
        });
        setScheduleSource("local");
      } else {
        const urlSchedule = tryLoadFromUrl();
        if (urlSchedule.loaded) {
          setExpectedBeneficiary(urlSchedule.beneficiary);
          setMilestoneUi(urlSchedule.milestoneUi);
          setScheduleSource("url");
        } else if (scheduleSource === "none") {
          setScheduleSource("manual");
        }
      }
    }
  }, [
    isSingleLeaf,
    publicKey,
    proofQuery.data,
    proofQuery.isError,
    proofBeneficiary,
    treeAddress,
    scheduleSource,
    localSchedule,
  ]);

  /* ---- Derived values ---- */

  function formatTokenAmount(raw: bigint): string {
    if (mintDecimals === null) return raw.toString();
    if (mintDecimals === 0) return raw.toLocaleString();
    const divisor = 10n ** BigInt(mintDecimals);
    const whole = raw / divisor;
    const frac = raw % divisor;
    const fracStr = frac.toString().padStart(mintDecimals, "0").slice(0, 4).replace(/0+$/, "");
    return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
  }

  function formatFundingAmount(raw: bigint): string {
    if (!treeMint) return formatTokenAmount(raw);
    const token = POPULAR_TOKENS.find((item) => item.mint === treeMint.toBase58());
    const decimals = token?.decimals ?? (isNativeSol(treeMint) || isWrappedSol(treeMint) ? 9 : mintDecimals);
    const symbol = token?.symbol ?? (isNativeSol(treeMint) ? "SOL" : isWrappedSol(treeMint) ? "wSOL" : "tokens");
    if (decimals === null) return `${raw.toString()} ${symbol}`;
    if (decimals === 0) return `${raw.toLocaleString()} ${symbol}`;
    const divisor = 10n ** BigInt(decimals);
    const whole = raw / divisor;
    const frac = raw % divisor;
    const fracStr = frac.toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "");
    return `${fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString()} ${symbol}`;
  }

  const nowTs = BigInt(nowUnix);
  const totalSupply = treeState ? BigInt(treeState.totalSupply.toString()) : 0n;
  const treeTotalClaimed = treeState ? BigInt(treeState.totalClaimed.toString()) : 0n;
  const cancelledAtBigint = treeState?.cancelledAt
    ? BigInt(treeState.cancelledAt.toString())
    : null;
  const myClaimedAmount = claimRecordQuery.data
    ? BigInt(claimRecordQuery.data.claimedAmount.toString())
    : 0n;
  const totalClaimed =
    isSingleLeaf && myClaimedAmount > treeTotalClaimed
      ? myClaimedAmount
      : treeTotalClaimed;

  const cliffTsBigint = cliffTime ? BigInt(datetimeLocalToUnix(cliffTime)) : 0n;
  const endTsBigint = endTime ? BigInt(datetimeLocalToUnix(endTime)) : 0n;
  const isMultiRecipient = (treeState?.leafCount ?? 0) > 1;

  const singleMilestoneReleased = releaseType === 2
    ? isMilestoneTriggered(
        treeState?.milestoneReleasedFlags ?? new Uint8Array(32),
        Number(milestoneIdx),
      )
    : undefined;
  const vested = cliffTime && endTime
    ? vestedAmount(totalSupply, releaseType, cliffTsBigint, endTsBigint, cancelledAtBigint, nowTs, singleMilestoneReleased)
    : 0n;
  const claimable = vested > totalClaimed ? vested - totalClaimed : 0n;
  const recipientLeaves = proofAllQuery.data ?? [];
  const isRecipientView = isMultiRecipient && recipientLeaves.length > 0;
  const isRecipientMetricsLoading =
    isMultiRecipient &&
    !!beneficiaryKey &&
    proofAllQuery.isLoading &&
    proofAllQuery.data === undefined;
  const recipientAllocation = isRecipientView
    ? recipientLeaves.reduce<bigint>((sum, entry) => sum + BigInt(String(entry.leaf.amount)), 0n)
    : 0n;
  const recipientVested = isRecipientView
    ? recipientLeaves.reduce<bigint>((sum, entry) => {
        const amount = BigInt(String(entry.leaf.amount));
        if (entry.leaf.releaseType === 2) {
          const released = isMilestoneTriggered(
            treeState?.milestoneReleasedFlags ?? new Uint8Array(32),
            entry.leaf.milestoneIdx,
          );
          const unlockTs = BigInt(entry.leaf.cliffTime);
          const effectiveNow = cancelledAtBigint !== null && cancelledAtBigint < nowTs
            ? cancelledAtBigint
            : nowTs;
          return sum + (released && effectiveNow >= unlockTs ? amount : 0n);
        }
        return sum + vestedAmount(
          amount,
          entry.leaf.releaseType,
          BigInt(entry.leaf.cliffTime),
          BigInt(entry.leaf.endTime),
          cancelledAtBigint,
          nowTs,
        );
      }, 0n)
    : 0n;
  const recipientClaimed = isRecipientView
    ? (myClaimedAmount > recipientAllocation ? recipientAllocation : myClaimedAmount)
    : 0n;
  const recipientClaimable = isRecipientView
    ? (recipientVested > recipientClaimed ? recipientVested - recipientClaimed : 0n)
    : 0n;
  const displaySupply = isRecipientView ? recipientAllocation : totalSupply;
  const displayClaimed = isRecipientView ? recipientClaimed : totalClaimed;
  const displayVested = isRecipientView ? recipientVested : vested;
  const displayClaimable = isRecipientView ? recipientClaimable : claimable;
  const displayProgress = progressPercent(displayVested, displaySupply);

  const fundingStateQuery = useQuery({
    queryKey: [
      "campaignFundingState",
      treeAddress,
      treeState?.mint.toBase58(),
      treeState?.vault.toBase58(),
      totalSupply.toString(),
      totalClaimed.toString(),
    ],
    queryFn: async () => {
      if (!treeState) return null;
      const native = isNativeSol(treeState.mint);
      let funded = 0n;

      if (native) {
        const treePubkey = new PublicKey(treeAddress);
        const accountInfo = await connection.getAccountInfo(treePubkey);
        if (!accountInfo) return null;
        const rent = await connection.getMinimumBalanceForRentExemption(accountInfo.data.length);
        const lamports = BigInt(accountInfo.lamports);
        funded = lamports > BigInt(rent) ? lamports - BigInt(rent) : 0n;
      } else {
        try {
          const balance = await connection.getTokenAccountBalance(treeState.vault);
          funded = BigInt(balance.value.amount);
        } catch {
          funded = 0n;
        }
      }

      const requiredBalance = totalSupply > totalClaimed ? totalSupply - totalClaimed : 0n;

      return {
        funded,
        remaining: requiredBalance > funded ? requiredBalance - funded : 0n,
      };
    },
    enabled:
      !!treeState &&
      cancelledAtBigint === null &&
      totalSupply > 0n,
    staleTime: 10_000,
  });
  const fundingRemaining = fundingStateQuery.data?.remaining ?? 0n;
  const isFundingIncomplete = fundingRemaining > 0n;
  const canShowFundingRecovery =
    !!treeState &&
    !!publicKey &&
    publicKey.equals(treeState.creator) &&
    cancelledAtBigint === null &&
    isFundingIncomplete;

  const canShowPauseToggle = canPauseCampaign({
    viewer: publicKey,
    pauseAuthority: treeState?.pauseAuthority,
    cancelledAt: cancelledAtBigint,
    totalSupply,
    totalClaimed,
  });
  const canShowCancel = canCancelCampaign({
    viewer: publicKey,
    cancelAuthority: treeState?.cancelAuthority,
    cancellable: treeState?.cancellable ?? false,
    cancelledAt: cancelledAtBigint,
    totalSupply,
    totalClaimed,
  });
  const hasStreamCancelledEvent = timelineQuery.data?.events.some((e) => e.type === "stream_cancelled") ?? false;
  const isCreator =
    !!publicKey && !!treeState?.creator && publicKey.equals(treeState.creator);
  const unvestedAmount =
    cancelledAtBigint !== null ? totalSupply - vested : 0n;
  const isWithdrawn =
    cancelledAtBigint !== null && (streamSettled || hasStreamCancelledEvent);
  const canShowWithdrawUnvested = !streamSettled && !hasStreamCancelledEvent && !(treeState?.instantRefunded) && canWithdrawUnvested({
    viewer: publicKey,
    creator: treeState?.creator,
    cancelledAt: cancelledAtBigint,
  });
  const minCliffTimeBigint = treeState?.minCliffTime
    ? BigInt(treeState.minCliffTime.toString())
    : null;
  const canShowInstantRefund = canInstantRefund({
    viewer: publicKey,
    creator: treeState?.creator,
    cancellable: treeState?.cancellable ?? false,
    cancelledAt: cancelledAtBigint,
    instantRefunded: treeState?.instantRefunded ?? false,
    leafCount: treeState?.leafCount ?? 0,
    minCliffTime: minCliffTimeBigint,
    nowTs: nowTs,
    totalSupply,
    totalClaimed,
    milestoneReleasedFlags: treeState?.milestoneReleasedFlags ?? new Uint8Array(32),
  });
  const canShowRootRotation = canRotateRoot({
    viewer: publicKey,
    cancelAuthority: treeState?.cancelAuthority,
    cancellable: treeState?.cancellable ?? false,
    cancelledAt: cancelledAtBigint,
    leafCount: treeState?.leafCount ?? 0,
  });
  const hasMilestoneLeaves = campaignDetailQuery.data?.hasMilestoneLeaves
    ?? recipientLeaves.some((l) => l.leaf.releaseType === 2);
  const canShowReleaseMilestone = canReleaseMilestone({
    viewer: publicKey,
    creator: treeState?.creator,
    cancelledAt: cancelledAtBigint,
    releaseType,
    hasMilestoneLeaves,
  });
  const isCliff = releaseType === 0;
  const isLinear = releaseType === 1;
  const isMilestone = releaseType === 2;
  const beneficiaryMismatch =
    !!publicKey && !!expectedBeneficiary && publicKey.toBase58() !== expectedBeneficiary;
  const milestoneBitmap = claimRecordQuery.data?.milestoneBitmap
    ? new Uint8Array(claimRecordQuery.data.milestoneBitmap)
    : new Uint8Array(32);
  const milestoneTriggered = isMilestoneTriggered(milestoneBitmap, Number(milestoneIdx));
  const milestoneReleased = singleMilestoneReleased ?? false;
  const milestoneLifecycleLabel = milestoneTriggered
    ? "Claimed"
    : nowTs >= cliffTsBigint
      ? "Ready To Claim"
      : "Awaiting Unlock";
  let milestoneEntries: { index: number; amount: bigint; cliffTime: bigint }[] = [];
  if (isMilestone) {
    if (isMultiRecipient && recipientLeaves.length > 0) {
      milestoneEntries = recipientLeaves
        .filter((l) => l.leaf.releaseType === 2)
        .map((l) => ({
          index: l.leaf.milestoneIdx,
          amount: BigInt(String(l.leaf.amount)),
          cliffTime: BigInt(l.leaf.cliffTime),
        }));
    } else if (isMultiRecipient && (treeState?.leafCount ?? 0) > 1) {
      const count = Math.min(treeState?.leafCount ?? 0, 256);
      milestoneEntries = Array.from({ length: count }, (_, i) => ({
        index: i,
        amount: 0n,
        cliffTime: cliffTsBigint,
      }));
    } else {
      milestoneEntries = [{
        index: Number(milestoneIdx),
        amount: totalSupply,
        cliffTime: cliffTsBigint,
      }];
    }
  }

  let milestoneReleasedCount = 0;
  if (isMilestone && milestoneEntries.length > 0) {
    const flags = treeState?.milestoneReleasedFlags ?? new Uint8Array(32);
    milestoneReleasedCount = milestoneEntries.filter((m) => isMilestoneTriggered(flags, m.index)).length;
  }

  const rawWithdrawDisabledReason = beneficiaryMismatch && isSingleLeaf
    ? `Only beneficiary ${truncateAddress(expectedBeneficiary)} can claim`
    : getWithdrawDisabledReason({
    loading: txStatus.type === "loading",
    paused: treeState?.paused ?? false,
    claimable: displayClaimable,
    cancelledAt: cancelledAtBigint,
    releaseType,
    nowTs,
    cliffTs: cliffTsBigint,
    milestoneIdx: Number(milestoneIdx),
    milestoneBitmap,
    milestoneReleased: singleMilestoneReleased,
  });
  const isCancelledBeforeCliff =
    cliffTsBigint > 0n &&
    cancelledAtBigint !== null &&
    cancelledAtBigint < cliffTsBigint;
  const withdrawDisabledReason =
    (streamSettled || hasStreamCancelledEvent) &&
    cancelledAtBigint !== null &&
    displayClaimable === 0n &&
    rawWithdrawDisabledReason === "Stream cancelled — nothing to claim"
      ? isCancelledBeforeCliff
        ? "Cancelled — vesting had not started yet"
        : "Settled — tokens sent to your wallet"
      : rawWithdrawDisabledReason;
  const claimableLabel =
    isSingleLeaf && beneficiaryMismatch
      ? "Beneficiary Claimable"
      : isRecipientView
        ? "Your Claimable"
        : "Claimable";
  const claimedLabel = isRecipientView ? "You Claimed" : "Total Claimed";
  const vestedLabel = isMilestone
    ? milestoneEntries.length > 1
      ? milestoneReleasedCount === 0
        ? "Not yet released"
        : milestoneReleasedCount === milestoneEntries.length
          ? "All released"
          : `${milestoneReleasedCount}/${milestoneEntries.length} released`
      : milestoneLifecycleLabel
    : isRecipientView
      ? formatTokenAmount(displayVested)
      : `${displayProgress}%`;
  const scheduleSummary =
    isCliff
      ? "Full release at a single time."
      : isLinear
        ? "Gradual release from cliff to end."
        : "Single indexed release with milestone context.";
  const waitCountdown =
    claimable === 0n && nowTs < cliffTsBigint && cancelledAtBigint === null
      ? formatCountdown(cliffTsBigint, nowTs)
      : null;
  const waitActionLabel =
    claimable === 0n
      ? isCliff && waitCountdown
        ? `Wait for cliff ${waitCountdown}`
        : isLinear && waitCountdown
          ? `Wait for vesting ${waitCountdown}`
          : isMilestone && waitCountdown
            ? `Wait for milestone ${waitCountdown}`
            : isMilestone && !milestoneReleased && !milestoneTriggered
              ? "Wait for milestone release"
              : null
      : null;
  const claimFundingDisabledReason = treeState?.instantRefunded
    ? "Campaign Refunded"
    : fundingStateQuery.isLoading
      ? "Checking campaign funding..."
      : isFundingIncomplete
        ? "Campaign not funded yet"
        : null;
  const claimActionLabel = beneficiaryMismatch && expectedBeneficiary
    ? `Only ${truncateAddress(expectedBeneficiary)} can claim`
    : txStatus.type === "loading"
      ? "Claiming..."
      : treeState?.paused
        ? "Campaign Paused"
        : claimFundingDisabledReason
          ? claimFundingDisabledReason
        : waitActionLabel
          ? waitActionLabel
          : withdrawDisabledReason ?? `Claim ${formatTokenAmount(displayClaimable)}`;
  const currentMerkleRootHex = treeState ? Buffer.from(treeState.merkleRoot).toString("hex") : "";
  const rootVersions = campaignDetailQuery.data?.rootVersions ?? [];
  const campaignRecipients = campaignDetailQuery.data?.recipients ?? [];
  const uniqueRecipientCount = campaignRecipients.length;
  const isMultiWallet = uniqueRecipientCount > 1;
  const pageTitle = isMultiWallet ? "Vesting Campaign" : "Vesting Stream";
  const pageDescription = isMultiWallet
    ? "Review campaign status, shared schedule, and recipient claim actions."
    : "Review the stream status, schedule, and claim actions.";
  const scheduleSectionTitle = isSingleLeaf
    ? scheduleLocked
      ? "Claim Schedule"
      : "Manual Claim Parameters"
    : "Schedule Reference";
  const scheduleSectionCaption = isSingleLeaf
    ? scheduleLocked
      ? "This schedule is loaded from indexed or local data and is used for the normal single-stream claim flow."
      : "Use this only if you need to manually reconstruct a single-stream claim. It does not update the campaign on-chain."
    : "This is a read-only reference for the campaign schedule. Bulk claims still use indexed leaf data and Merkle proof.";
  const showReadOnlySchedule = !isSingleLeaf || scheduleLocked;
  const detailsCaption = isMultiWallet
    ? "Core campaign information."
    : "Core stream information.";
  const actionsCaption = isMultiWallet
    ? "Claim and manage this campaign."
    : "Claim and manage this stream.";

  /* ---- Status helpers ---- */

  const statusLabel = treeState?.instantRefunded
    ? "Refunded"
    : treeState?.paused
      ? "Paused"
      : treeState?.cancelledAt
        ? "Cancelled"
        : displaySupply > 0n && displayClaimed >= displaySupply
          ? "Claimed"
          : "Active";

  const statusBadgeClass = treeState?.instantRefunded
    ? "border-amber-500/20 bg-amber-500/10 text-amber-400"
    : treeState?.paused
      ? "border-amber-500/20 bg-amber-500/10 text-amber-400"
      : treeState?.cancelledAt
        ? "border-red-500/20 bg-red-500/10 text-red-400"
        : displaySupply > 0n && displayClaimed >= displaySupply
          ? "border-sky-500/20 bg-sky-500/10 text-sky-400"
          : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400";

  async function handleFundExistingCampaign() {
    if (!treeState || fundingRemaining <= 0n) return;
    setFundingStatus({ type: "loading" });
    try {
      const funded = await fundCampaign({
        mintAddress: treeState.mint.toBase58(),
        treeAddress,
        totalSupply: fundingRemaining.toString(),
      });
      removePendingCampaignFundingLocal(treeAddress);
      setFundingStatus({ type: "idle" });
      setTxStatus({ type: "success", sig: funded.sig });
      toast("Campaign funded.", "success");
      await fundingStateQuery.refetch();
      fetchTree(true);
      void campaignDetailQuery.refetch();
    } catch (error) {
      setFundingStatus({ type: "error", msg: formatVestingError(error) });
    }
  }

  /* ---- Cancel handler ---- */

  async function handleCancel() {
    if (!program || !publicKey || !treeState) return;
    setCancelLoading(true);
    await waitForLoadingPaint();
    try {
      const treePubkey = new PublicKey(treeAddress);

      const cancelIx = await program.methods
        .cancelCampaign()
        .accounts({
          cancelAuthority: publicKey,
          vestingTree: treePubkey,
        })
        .instruction();
      const cancelTx = new Transaction().add(cancelIx);
      const sig = await sendTransaction(cancelTx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      setTxStatus({ type: "success", sig });
      setCancelOpen(false);
      toast("Campaign cancelled successfully.", "success");

      const cancelTs = Math.floor(Date.now() / 1000);
      setTreeState((prev) => {
        if (!prev) return prev;
        const next = { ...prev, cancelledAt: new BN(cancelTs), paused: false };
        treeStateRef.current = next;
        return next;
      });
      void campaignDetailQuery.refetch();
      setTimeout(() => fetchTree(true), 4000);

      queryClient.setQueriesData(
        { queryKey: ["campaigns"] },
        (old: unknown) => {
          const data = old as { campaigns?: { treeAddress: string; cancelledAt: number | null }[] } | undefined;
          if (!data?.campaigns) return old;
          return { ...data, campaigns: data.campaigns.map((c) => c.treeAddress === treeAddress ? { ...c, cancelledAt: cancelTs } : c) };
        },
      );

      fetch(`/api/campaigns/${treeAddress}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelledAt: cancelTs }),
      }).catch(() => {});
      fetch("/api/events/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature: sig }),
      })
        .then(() => queryClient.invalidateQueries({ queryKey: ["timeline", treeAddress] }))
        .catch(() => {});
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        /User rejected|Connection rejected/i.test(err.message)
      ) {
        setTxStatus({ type: "idle" });
        return;
      }
      const msg = formatVestingError(err);
      setTxStatus({ type: "error", msg });
      toast(msg, "error");
    } finally {
      setCancelLoading(false);
    }
  }

  /* ---- Cancel Stream (instant settle) handler ---- */

  async function handleCancelStream() {
    const resolvedBeneficiary = expectedBeneficiary ?? (manualBeneficiary || null);
    if (!program || !publicKey || !treeState || !resolvedBeneficiary) return;
    setCancelLoading(true);
    await waitForLoadingPaint();
    try {
      const treePubkey = new PublicKey(treeAddress);
      const beneficiary = new PublicKey(resolvedBeneficiary);
      const [claimRecord] = derivePda(["claim", treePubkey.toBuffer(), beneficiary.toBuffer()]);
      const startTs = startTime ? new BN(datetimeLocalToUnix(startTime)) : new BN(0);
      const args = {
        releaseType,
        startTime: startTs,
        cliffTime: new BN(datetimeLocalToUnix(cliffTime)),
        endTime: new BN(datetimeLocalToUnix(endTime)),
        milestoneIdx: Number(milestoneIdx),
      };

      if (isNativeSol(treeState.mint)) {
        const sentinel = program.programId;
        const cancelIx = await program.methods
          .cancelStream(args)
          .accounts({
            creator: publicKey,
            beneficiary,
            vestingTree: treePubkey,
            claimRecord,
            systemProgram: SystemProgram.programId,
            vaultAuthority: sentinel,
            vault: sentinel,
            beneficiaryAta: sentinel,
            creatorAta: sentinel,
            tokenProgram: sentinel,
          })
          .instruction();
        const tx = new Transaction().add(cancelIx);
        const cancelStreamSig = await sendTransaction(tx, connection);
        fetch("/api/events/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature: cancelStreamSig }),
        }).catch(() => {});
      } else {
        const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
        const beneficiaryAta = getAssociatedTokenAddressSync(treeState.mint, beneficiary);
        const creatorAta = getAssociatedTokenAddressSync(treeState.mint, publicKey);

        const cancelStreamIx = await program.methods
          .cancelStream(args)
          .accounts({
            creator: publicKey,
            beneficiary,
            vestingTree: treePubkey,
            claimRecord,
            systemProgram: SystemProgram.programId,
            vaultAuthority: treeState.vaultAuthority,
            vault: treeState.vault,
            beneficiaryAta,
            creatorAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction();
        const cancelStreamTx = new Transaction().add(cancelStreamIx);
        const cancelStreamSig = await sendTransaction(cancelStreamTx, connection);
        fetch("/api/events/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature: cancelStreamSig }),
        }).catch(() => {});
      }

      toast("Stream cancelled and settled.", "success");
      setCancelOpen(false);
      setTxStatus({ type: "success", sig: "" });
      setStreamSettled(true);
      markStreamSettledLocal(treeAddress);
      void queryClient.invalidateQueries({ queryKey: ["timeline", treeAddress] });

      const cancelTs = Math.floor(Date.now() / 1000);
      const claimedAtCancel = vestedAmount(
        totalSupply,
        releaseType,
        cliffTsBigint,
        endTsBigint,
        BigInt(cancelTs),
        BigInt(cancelTs),
        singleMilestoneReleased,
      );
      const nextTotalClaimed = claimedAtCancel > totalClaimed ? claimedAtCancel : totalClaimed;
      setTreeState((prev) =>
        {
          if (!prev) return prev;
          const next = {
            ...prev,
            totalClaimed: new BN(nextTotalClaimed.toString()),
            cancelledAt: new BN(cancelTs),
            paused: false,
          };
          treeStateRef.current = next;
          return next;
        },
      );
      queryClient.setQueryData(["claimRecord", treeAddress, resolvedBeneficiary], (old: unknown) => {
        const record = old as { claimedAmount?: { toString(): string }; lastClaimAt?: { toString(): string } } | null | undefined;
        if (!record) return old;
        const existingClaimed = record.claimedAmount ? BigInt(record.claimedAmount.toString()) : 0n;
        const nextClaimed = claimedAtCancel > existingClaimed ? claimedAtCancel : existingClaimed;
        return {
          ...record,
          claimedAmount: new BN(nextClaimed.toString()),
          lastClaimAt: new BN(cancelTs),
        };
      });
      queryClient.setQueriesData(
        { queryKey: ["campaigns"] },
        (old: unknown) => {
          const data = old as { campaigns?: { treeAddress: string; cancelledAt: number | null; totalClaimed?: number | string }[] } | undefined;
          if (!data?.campaigns) return old;
          return { ...data, campaigns: data.campaigns.map((c) => c.treeAddress === treeAddress ? { ...c, cancelledAt: cancelTs, totalClaimed: nextTotalClaimed.toString() } : c) };
        },
      );
      void queryClient.invalidateQueries({ queryKey: ["beneficiaryCampaigns"] });

      fetch(`/api/campaigns/${treeAddress}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelledAt: cancelTs, totalClaimed: nextTotalClaimed.toString() }),
      }).catch(() => {});
      fetchTree(true);
      void campaignDetailQuery.refetch();
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        /User rejected|Connection rejected/i.test(err.message)
      ) {
        setTxStatus({ type: "idle" });
        return;
      }
      const msg = formatVestingError(err);
      setTxStatus({ type: "error", msg });
      toast(msg, "error");
    } finally {
      setCancelLoading(false);
    }
  }

  /* ---- Instant Refund handler (multi-leaf, not started) ---- */

  async function handleInstantRefund() {
    if (!program || !publicKey || !treeState) return;
    setInstantRefundLoading(true);
    await waitForLoadingPaint();
    try {
      const treePubkey = new PublicKey(treeAddress);
      const native = isNativeSol(treeState.mint);

      if (native) {
        const sentinel = program.programId;
        const refundIx = await program.methods
          .instantRefundCampaign()
          .accounts({
            creator: publicKey,
            vestingTree: treePubkey,
            vaultAuthority: sentinel,
            vault: sentinel,
            creatorAta: sentinel,
            tokenProgram: sentinel,
            systemProgram: SystemProgram.programId,
          } as any)
          .instruction();
        const refundTx = new Transaction().add(refundIx);
        const refundSig = await sendTransaction(refundTx, connection);
        fetch("/api/events/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature: refundSig }),
        })
          .then(() => queryClient.invalidateQueries({ queryKey: ["timeline", treeAddress] }))
          .catch(() => {});
      } else {
        const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
        const [vaultAuthority] = PublicKey.findProgramAddressSync(
          [Buffer.from("vault_authority"), treePubkey.toBuffer()],
          program.programId,
        );
        const vault = getAssociatedTokenAddressSync(treeState.mint, vaultAuthority, true);
        const creatorAta = getAssociatedTokenAddressSync(treeState.mint, publicKey);

        const refundIx = await program.methods
          .instantRefundCampaign()
          .accounts({
            creator: publicKey,
            vestingTree: treePubkey,
            vaultAuthority,
            vault,
            creatorAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .instruction();
        const refundTx = new Transaction().add(refundIx);
        const refundSig = await sendTransaction(refundTx, connection);
        fetch("/api/events/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature: refundSig }),
        })
          .then(() => queryClient.invalidateQueries({ queryKey: ["timeline", treeAddress] }))
          .catch(() => {});
      }

      toast("Campaign instantly refunded. All funds returned.", "success");
      setCancelOpen(false);

      const cancelTs = Math.floor(Date.now() / 1000);
      setTreeState((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          cancelledAt: new BN(cancelTs),
          paused: false,
          instantRefunded: true,
        };
        treeStateRef.current = next;
        return next;
      });
      queryClient.setQueriesData(
        { queryKey: ["campaigns"] },
        (old: unknown) => {
          const data = old as { campaigns?: { treeAddress: string; cancelledAt: number | null }[] } | undefined;
          if (!data?.campaigns) return old;
          return { ...data, campaigns: data.campaigns.map((c) => c.treeAddress === treeAddress ? { ...c, cancelledAt: cancelTs } : c) };
        },
      );
      void queryClient.invalidateQueries({ queryKey: ["beneficiaryCampaigns"] });

      fetch(`/api/campaigns/${treeAddress}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelledAt: cancelTs, instantRefunded: true }),
      }).catch(() => {});
      void campaignDetailQuery.refetch();
      setTimeout(() => fetchTree(true), 4000);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        /User rejected|Connection rejected/i.test(err.message)
      ) {
        setInstantRefundLoading(false);
        return;
      }
      const msg = formatVestingError(err);
      setTxStatus({ type: "error", msg });
      toast(msg, "error");
    } finally {
      setInstantRefundLoading(false);
    }
  }

  /* ---- Withdraw / Claim handler ---- */

  async function handleWithdraw() {
    if (!program || !publicKey || !treeState) return;
    if (beneficiaryMismatch && expectedBeneficiary) {
      toast(
        `Only beneficiary ${truncateAddress(expectedBeneficiary)} can claim this stream.`,
        "error",
      );
      return;
    }

    setTxStatus({ type: "loading" });
    await waitForLoadingPaint();

    try {
      const treePubkey = new PublicKey(treeAddress);
      const [claimRecord] = derivePda([
        "claim",
        treePubkey.toBuffer(),
        publicKey.toBuffer(),
      ]);

      const startTs = rawStartTs !== null
        ? new BN(rawStartTs)
        : startTime
        ? new BN(datetimeLocalToUnix(startTime))
        : new BN(0);
      const cliffTs = rawCliffTs !== null
        ? new BN(rawCliffTs)
        : new BN(datetimeLocalToUnix(cliffTime));
      const endTs = rawEndTs !== null
        ? new BN(rawEndTs)
        : new BN(datetimeLocalToUnix(endTime));

      if (process.env.NODE_ENV === "development") {
        const { verifyVestedAmount } = await import("@/lib/vesting/verify-onchain");
        const parity = await verifyVestedAmount(program, {
          beneficiary: publicKey,
          amount: totalSupply,
          releaseType,
          startTime: startTime ? datetimeLocalToUnix(startTime) : 0,
          cliffTime: datetimeLocalToUnix(cliffTime),
          endTime: datetimeLocalToUnix(endTime),
          milestoneIdx: Number(milestoneIdx),
          cancelledAt: cancelledAtBigint !== null ? Number(cancelledAtBigint) : null,
          milestoneReleasedFlags: treeState.milestoneReleasedFlags,
          clientVested: vested,
        });
        console.info("[vesting parity]", parity.match ? "✓ match" : "✗ MISMATCH", parity);
      }

      const args = {
        releaseType,
        startTime: startTs,
        cliffTime: cliffTs,
        endTime: endTs,
        milestoneIdx: Number(milestoneIdx),
      };

      const sig = isNativeSol(treeState.mint)
        ? await (async () => {
            const sentinel = program.programId;
            const withdrawIx = await program.methods
              .withdraw(args)
              .accounts({
                beneficiary: publicKey,
                vestingTree: treePubkey,
                claimRecord,
                vaultAuthority: sentinel,
                vault: sentinel,
                mint: sentinel,
                beneficiaryAta: sentinel,
                tokenProgram: sentinel,
                associatedTokenProgram: sentinel,
                systemProgram: SystemProgram.programId,
              })
              .instruction();
            const tx = new Transaction().add(withdrawIx);
            return sendTransaction(tx, connection);
          })()
        : await (async () => {
            const [vaultAuthority] = derivePda(["vault_authority", treePubkey.toBuffer()]);
            const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
            const beneficiaryAta = getAssociatedTokenAddressSync(treeState.mint, publicKey);

            const withdrawIx = await program.methods
              .withdraw(args)
              .accounts({
                beneficiary: publicKey,
                vestingTree: treePubkey,
                claimRecord,
                vaultAuthority,
                vault: treeState.vault,
                beneficiaryAta,
                mint: treeState.mint,
              })
              .instruction();
            const tx = new Transaction().add(withdrawIx);
            return sendTransaction(tx, connection);
          })();

      await connection.confirmTransaction(sig, "confirmed");

      const nextClaimed = totalClaimed + claimable;
      setTxStatus({ type: "success", sig });
      setError(null);
      setTreeState((prev) =>
        prev
          ? {
              ...prev,
              totalClaimed: new BN(nextClaimed.toString()),
            }
          : prev,
      );
      const wrappedSol = isWrappedSol(treeState.mint);
      toast(
        isNativeSol(treeState.mint)
          ? `Claimed ${formatTokenAmount(claimable)} SOL successfully!`
          : wrappedSol
          ? `Claimed ${formatTokenAmount(claimable)} wSOL! Use Wrap/Unwrap to convert to SOL.`
          : `Claimed ${formatTokenAmount(claimable)} tokens successfully!`,
        "success",
      );
      if (releaseType === 2) {
        queryClient.setQueryData(
          ["claimRecord", treeAddress, beneficiaryKey],
          (old: unknown) => {
            const record = old as { milestoneBitmap?: number[]; claimedAmount?: unknown; lastClaimAt?: unknown } | null | undefined;
            if (!record) return old;
            const bitmap = [...(record.milestoneBitmap ?? new Array(32).fill(0))];
            const byteIdx = Math.floor(Number(milestoneIdx) / 8);
            const bitIdx = Number(milestoneIdx) % 8;
            if (byteIdx < bitmap.length) bitmap[byteIdx] |= (1 << bitIdx);
            return { ...record, milestoneBitmap: bitmap, claimedAmount: new BN(nextClaimed.toString()) };
          },
        );
      }
      void fetchTree(true);
      void campaignDetailQuery.refetch();
      void queryClient.invalidateQueries({
        queryKey: ["claimRecord", treeAddress, beneficiaryKey],
      });
      void (async () => {
        await fetch("/api/claims/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature: sig }),
        })
        .then(async (res) => {
          if (!res.ok) {
            const body = await res.text();
            console.warn("[claim sync] Failed:", res.status, body);
            return;
          }
          await Promise.all([
            campaignDetailQuery.refetch(),
            queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
            queryClient.invalidateQueries({ queryKey: ["beneficiaryCampaigns"] }),
          ]);
        })
        .catch((syncError) => {
          console.warn("[claim sync] Error:", syncError);
        });
      })();

      const newClaimed = nextClaimed.toString();
      queryClient.setQueriesData(
        { queryKey: ["campaigns"] },
        (old: unknown) => {
          const data = old as { campaigns?: { treeAddress: string; totalClaimed: number | string }[] } | undefined;
          if (!data?.campaigns) return old;
          return { ...data, campaigns: data.campaigns.map((c) => c.treeAddress === treeAddress ? { ...c, totalClaimed: newClaimed } : c) };
        },
      );
      queryClient.setQueriesData(
        { queryKey: ["beneficiaryCampaigns"] },
        (old: unknown) => {
          const data = old as { campaigns?: { treeAddress: string; myClaimed: number | string }[] } | undefined;
          if (!data?.campaigns) return old;
          return { ...data, campaigns: data.campaigns.map((c) => c.treeAddress === treeAddress ? { ...c, myClaimed: newClaimed } : c) };
        },
      );
      queryClient.setQueryData(
        ["campaign", treeAddress],
        (old: unknown) => {
          const data = old as { totalClaimed?: number | string } | undefined;
          if (!data) return old;
          return {
            ...data,
            totalClaimed: newClaimed,
          };
        },
      );
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        /User rejected|Connection rejected/i.test(err.message)
      ) {
        setTxStatus({ type: "idle" });
        return;
      }
      const msg = formatVestingError(err);
      setTxStatus({ type: "error", msg });
      toast(msg, "error");
    }
  }

  /* ================================================================ */
  /*  RENDER                                                          */
  /* ================================================================ */

  /* -- Loading state -- */
  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="h-4 w-1/4" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="mt-3 h-6 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="p-5">
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="mt-4 h-2 w-full" />
          </CardContent>
        </Card>
        <div className="flex gap-3">
          <Skeleton className="h-10 w-32 rounded-xl" />
          <Skeleton className="h-10 w-28 rounded-xl" />
        </div>
      </div>
    );
  }

  /* -- Error state -- */
  if (error) {
    return (
      <div className="mx-auto max-w-5xl py-16">
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
          <p className="text-[13px] text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  /* -- No wallet -- */
  if (!publicKey) {
    return (
      <div className="mx-auto max-w-5xl flex flex-col items-center justify-center py-32">
        <p className="text-[15px] text-[#555d73]">Connect your wallet to view and claim tokens</p>
      </div>
    );
  }

  /* -- No tree data -- */
  if (!treeState) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <Card className="rounded-2xl p-6">
        <CardContent className="p-0">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-[24px] font-semibold text-foreground">{pageTitle}</h1>
              <p className="mt-2 max-w-3xl text-[14px] text-muted-foreground">
                {pageDescription}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant="outline"
                className={cn("h-auto rounded-full px-3 py-1 text-[12px] font-medium", statusBadgeClass)}
              >
                {statusLabel}
              </Badge>
              <Badge
                variant="outline"
                className={cn("h-auto rounded-full px-3 py-1 text-[12px] font-medium", getVestingTypeBadgeColor(releaseType))}
              >
                {getVestingTypeLabel(releaseType)}
              </Badge>
              {isCliff && cliffTime && nowTs < cliffTsBigint && (
                <Badge variant="outline" className="h-auto rounded-full border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[12px] font-medium text-amber-400">
                  Unlocks in {formatCountdown(cliffTsBigint, nowTs)}
                </Badge>
              )}
              {isMilestone && (
                <Badge
                  variant="outline"
                  className={cn(
                    "h-auto rounded-full px-3 py-1 text-[12px] font-medium",
                    milestoneTriggered
                      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                      : "border-white/[0.08] bg-white/[0.02] text-muted-foreground",
                  )}
                >
                  {milestoneLifecycleLabel}
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <CampaignStatusBanner
        cancelledAtBigint={cancelledAtBigint}
        isCreator={isCreator}
        isInstantRefunded={treeState.instantRefunded ?? false}
        isFunded={!isFundingIncomplete || cancelledAtBigint !== null}
        nowTs={nowTs}
        onWithdrawClick={() => withdrawButtonRef.current?.click()}
        onResumeFunding={canShowFundingRecovery ? handleFundExistingCampaign : undefined}
        unvestedAmount={unvestedAmount}
        mintDecimals={mintDecimals}
        isWithdrawn={isWithdrawn}
      />

      {fundingStatus.type === "error" && isCreator && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-[12px] text-red-300">
          {fundingStatus.msg}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {isRecipientMetricsLoading ? (
            <MetricSkeletonGroup />
          ) : isRecipientView ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <MetricCard label="Total Supply" value={formatTokenAmount(totalSupply)} />
                <MetricCard label="Your Allocation" value={formatTokenAmount(displaySupply)} accent />
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <MetricCard label={claimedLabel} value={formatTokenAmount(displayClaimed)} />
                <MetricCard label="Vested" value={vestedLabel} />
                <MetricCard label={claimableLabel} value={formatTokenAmount(displayClaimable)} accent />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              <MetricCard label="Total Supply" value={formatTokenAmount(totalSupply)} />
              <MetricCard label={claimedLabel} value={formatTokenAmount(displayClaimed)} />
              <MetricCard label="Vested" value={vestedLabel} />
              <MetricCard label={claimableLabel} value={formatTokenAmount(displayClaimable)} accent />
            </div>
          )}

          {!isMilestone && cliffTime && endTime && (
            <Card className="rounded-2xl">
              <CardContent className="p-5">
                <SectionHeader
                  title="Progress"
                  caption={scheduleSummary}
                />
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-[12px] text-muted-foreground">
                    <span>Vested</span>
                    <span className="font-medium text-foreground">{displayProgress}%</span>
                  </div>
                  <Progress value={Math.min(displayProgress, 100)} className="h-2.5" />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Vesting Curve Chart */}
          {cliffTime && endTime && (
            <VestingChart
              releaseType={releaseType}
              startTs={datetimeLocalToUnix(startTime || cliffTime)}
              cliffTs={datetimeLocalToUnix(cliffTime)}
              endTs={datetimeLocalToUnix(endTime)}
              totalAmount={displaySupply}
              vestedAmount={displayVested}
              cancelledAt={cancelledAtBigint ? Number(cancelledAtBigint) : null}
              milestoneCount={isMilestone ? (treeState?.leafCount ?? 1) : undefined}
              formatAmount={formatTokenAmount}
            />
          )}

          {isMilestone && milestoneEntries.length > 0 && (
            <MilestoneCarouselCard
              milestones={milestoneEntries}
              milestoneReleasedFlags={treeState?.milestoneReleasedFlags ?? new Uint8Array(32)}
              milestoneBitmap={milestoneBitmap}
              nowTs={nowTs}
              cancelledAt={cancelledAtBigint}
              isCreator={!!treeState?.creator && !!publicKey && publicKey.equals(treeState.creator)}
              formatAmount={formatTokenAmount}
              milestoneUi={milestoneUi}
            />
          )}

          <CampaignTimeline treeAddress={treeAddress} mintDecimals={mintDecimals} />

          <Card className="rounded-2xl">
            <CardContent className="p-5">
              <SectionHeader
                title="Details"
                caption={detailsCaption}
              />
              <div className="mt-5 grid gap-3">
                <DetailRow label="Tree Address" value={treeAddress} mono />
                <DetailRow label="Creator" value={treeState.creator.toBase58()} mono />
                <DetailRow label="Mint" value={mintLabel ?? treeState.mint.toBase58()} mono={mintLabel === null || mintLabel === treeState.mint.toBase58()} />
                {expectedBeneficiary && !isMultiWallet && (
                  <DetailRow label="Beneficiary" value={expectedBeneficiary} mono />
                )}
                {isMultiWallet && (
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Recipients</p>
                        <p className="mt-2 text-[14px] font-medium text-foreground">
                          {campaignRecipients.length || treeState.leafCount} wallets in this campaign
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {campaignRecipients.slice(0, 3).map((recipient) => (
                            <Badge
                              key={recipient.beneficiary}
                              variant="outline"
                              className="h-auto rounded-full border-white/[0.08] bg-white/[0.03] px-3 py-1 font-mono text-[11px] text-foreground"
                            >
                              {truncateAddress(recipient.beneficiary)}
                            </Badge>
                          ))}
                          {campaignRecipients.length > 3 && (
                            <Badge variant="outline" className="h-auto rounded-full border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] text-muted-foreground">
                              +{campaignRecipients.length - 3} more
                            </Badge>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setRecipientsOpen(true)}
                        className="shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[12px] font-medium text-foreground transition hover:bg-white/[0.06]"
                      >
                        View All
                      </button>
                    </div>
                  </div>
                )}
                <DetailRow label="Campaign ID" value={treeState.campaignId.toString()} />
                <DetailRow label="Created" value={formatDate(treeState.createdAt.toNumber())} />
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-4">
                <SectionHeader
                  title={scheduleSectionTitle}
                  caption={scheduleSectionCaption}
                />
                {isSingleLeaf && scheduleLocked && (
                  <button
                    type="button"
                    onClick={() => setShowManualSchedule(true)}
                    className="text-[12px] font-medium text-foreground underline underline-offset-4"
                  >
                    Advanced / Manual
                  </button>
                )}
                {isSingleLeaf && showManualSchedule && (
                  <button
                    type="button"
                    onClick={() => setShowManualSchedule(false)}
                    className="text-[12px] font-medium text-muted-foreground underline underline-offset-4"
                  >
                    Back to Loaded Schedule
                  </button>
                )}
              </div>

              {proofQuery.isLoading && isSingleLeaf && (
                <p className="mt-4 text-[12px] text-muted-foreground">Loading schedule...</p>
              )}

              {!showReadOnlySchedule && (
                <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[12px] leading-6 text-amber-200">
                  Editing these values does not change the campaign on-chain. They are only used locally to reconstruct a single-stream claim if the loaded schedule is unavailable.
                </div>
              )}

              {showReadOnlySchedule ? (
                <div className="mt-5 grid gap-3">
                  <DetailRow label="Vesting Type" value={getVestingTypeLabel(releaseType)} />
                  <DetailRow label="Start Time" value={startTime ? formatDate(datetimeLocalToUnix(startTime)) : "—"} />
                  <DetailRow label={isMilestone ? "Unlock Time" : isCliff ? "Unlock Time" : "Cliff Time"} value={cliffTime ? formatDate(datetimeLocalToUnix(cliffTime)) : "—"} />
                  <DetailRow label="End Time" value={endTime ? formatDate(datetimeLocalToUnix(endTime)) : "—"} />
                  {isMilestone && <DetailRow label="Milestone Index" value={milestoneIdx} />}
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  <FieldRow
                    label="Vesting Type"
                    input={(
                      <Select
                        value={String(releaseType)}
                        onValueChange={(v) => setReleaseType(Number(v))}
                        disabled={scheduleLocked}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">Cliff</SelectItem>
                          <SelectItem value="1">Linear</SelectItem>
                          <SelectItem value="2">Milestone</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />

                  <div className="grid gap-4 md:grid-cols-3">
                    <FieldRow
                      label="Start Time"
                      input={(
                        <input
                          type="datetime-local"
                          value={startTime}
                          onChange={(e) => setStartTime(e.target.value)}
                          disabled={scheduleLocked}
                          className="w-full rounded-xl border border-white/[0.08] bg-[#11161f] px-4 py-3 text-[13px] text-white outline-none transition focus:border-white/20 disabled:opacity-50"
                        />
                      )}
                    />
                    <FieldRow
                      label={isMilestone ? "Unlock Time" : isCliff ? "Unlock Time" : "Cliff Time"}
                      input={(
                        <input
                          type="datetime-local"
                          value={cliffTime}
                          onChange={(e) => setCliffTime(e.target.value)}
                          disabled={scheduleLocked}
                          className="w-full rounded-xl border border-white/[0.08] bg-[#11161f] px-4 py-3 text-[13px] text-white outline-none transition focus:border-white/20 disabled:opacity-50"
                        />
                      )}
                    />
                    <FieldRow
                      label="End Time"
                      input={(
                        <input
                          type="datetime-local"
                          value={endTime}
                          onChange={(e) => setEndTime(e.target.value)}
                          disabled={scheduleLocked}
                          className="w-full rounded-xl border border-white/[0.08] bg-[#11161f] px-4 py-3 text-[13px] text-white outline-none transition focus:border-white/20 disabled:opacity-50"
                        />
                      )}
                    />
                  </div>

                  {isMilestone && (
                    <FieldRow
                      label="Milestone Index"
                      input={(
                        <input
                          type="number"
                          min="0"
                          max="255"
                          value={milestoneIdx}
                          onChange={(e) => setMilestoneIdx(e.target.value)}
                          disabled={scheduleLocked}
                          className="w-full rounded-xl border border-white/[0.08] bg-[#11161f] px-4 py-3 text-[13px] text-white outline-none transition focus:border-white/20 disabled:opacity-50"
                        />
                      )}
                    />
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card
            id="campaign-actions"
            className="rounded-2xl lg:sticky lg:top-6"
          >
          <CardContent className="p-5">
            <SectionHeader
              title="Actions"
              caption={actionsCaption}
            />

            {scheduleSource === "url" && (
              <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[12px] leading-6 text-amber-300">
                <strong>Unverified:</strong> Schedule parameters were loaded from the URL. Values shown (including claimable amount) may not reflect actual on-chain state.
              </div>
            )}

            {isSingleLeaf && beneficiaryMismatch && expectedBeneficiary && (
              <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[12px] leading-6 text-amber-300">
                Connected wallet does not match the beneficiary.
              </div>
            )}

            {isSingleLeaf && !expectedBeneficiary && scheduleSource !== "api" && scheduleSource !== "url" && (
              <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[12px] leading-6 text-[#8b92a5]">
                Beneficiary could not be verified from indexed data.
              </div>
            )}

            <div className="mt-5 space-y-4">
              {isMultiRecipient && program && !claimFundingDisabledReason ? (
                <ClaimWithProofButton
                  program={program}
                  publicKey={publicKey}
                  treePubkey={new PublicKey(treeAddress)}
                  treeAddress={treeAddress}
                  mint={treeState.mint}
                  vault={treeState.vault}
                  vaultAuthority={treeState.vaultAuthority}
                  mintDecimals={mintDecimals}
                  paused={treeState.paused}
                  milestoneReleasedFlags={treeState.milestoneReleasedFlags}
                  cancelledAt={cancelledAtBigint}
                  isCreator={treeState.creator && publicKey.equals(treeState.creator)}
                  onSuccess={() => {
                    fetchTree(true);
                    void queryClient.invalidateQueries({ queryKey: ["claimRecord", treeAddress, beneficiaryKey] });
                  }}
                  toast={toast}
                />
              ) : isMultiRecipient && program ? (
                <button
                  type="button"
                  disabled
                  className="w-full cursor-not-allowed rounded-xl bg-white px-4 py-3 text-[14px] font-semibold text-[#0d1117] opacity-50"
                >
                  {claimFundingDisabledReason}
                </button>
              ) : (
                <button
                  onClick={handleWithdraw}
                  disabled={!!withdrawDisabledReason || !!claimFundingDisabledReason}
                  className="w-full rounded-xl bg-white px-4 py-3 text-[14px] font-semibold text-[#0d1117] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {txStatus.type === "loading" ? "Claiming..." : claimActionLabel}
                </button>
              )}

              {/* Single-leaf milestone: show status badge + single release button */}
              {isSingleLeaf && (
                <>
                  <MilestoneStatusBadge
                    isMilestoneType={isMilestone}
                    alreadyTriggered={milestoneTriggered}
                    milestoneReleased={milestoneReleased}
                    milestoneIdx={Number(milestoneIdx)}
                    cliffTime={cliffTsBigint}
                    nowTs={nowTs}
                  />
                  {program && (
                    <TriggerMilestoneButton
                      program={program}
                      publicKey={publicKey}
                      treePubkey={new PublicKey(treeAddress)}
                      milestoneIdx={Number(milestoneIdx)}
                      alreadyReleased={milestoneReleased}
                      canRelease={canShowReleaseMilestone}
                      onSuccess={() => {
                        setTreeState((prev) => {
                          if (!prev) return prev;
                          const newFlags = new Uint8Array(prev.milestoneReleasedFlags);
                          newFlags[Number(milestoneIdx)] = 1;
                          const next = { ...prev, milestoneReleasedFlags: newFlags };
                          treeStateRef.current = next;
                          return next;
                        });
                        setTimeout(() => fetchTree(true), 2000);
                      }}
                      toast={toast}
                    />
                  )}
                </>
              )}

              {/* Multi-leaf milestone: show release panel with all milestones */}
              {!isSingleLeaf && program && (
                <MilestoneReleasePanel
                  program={program}
                  publicKey={publicKey}
                  treePubkey={new PublicKey(treeAddress)}
                  milestoneReleasedFlags={treeState.milestoneReleasedFlags}
                  milestoneIndices={campaignDetailQuery.data?.milestoneIndices ?? []}
                  canRelease={canShowReleaseMilestone}
                  onSuccess={(idx: number) => {
                    setTreeState((prev) => {
                      if (!prev) return prev;
                      const newFlags = new Uint8Array(prev.milestoneReleasedFlags);
                      newFlags[idx] = 1;
                      const next = { ...prev, milestoneReleasedFlags: newFlags };
                      treeStateRef.current = next;
                      return next;
                    });
                    setTimeout(() => fetchTree(true), 2000);
                  }}
                  toast={toast}
                />
              )}

              {program && (
                <>
                  {treeState.pauseAuthority && treeState.creator && !treeState.pauseAuthority.equals(treeState.creator) && (
                    <p className="text-[11px] text-amber-400/80">Pause authority differs from creator. Pausing blocks all claims.</p>
                  )}
                  <PauseToggleButton
                  program={program}
                  publicKey={publicKey}
                  treePubkey={new PublicKey(treeAddress)}
                  paused={treeState.paused}
                  isPauseAuthority={canShowPauseToggle}
                  cancelledAt={cancelledAtBigint}
                  onSuccess={() => {
                    const newPaused = !treeState.paused;
                    fetchTree(true);
                    queryClient.setQueriesData(
                      { queryKey: ["campaigns"] },
                      (old: unknown) => {
                        const data = old as { campaigns?: { treeAddress: string; paused: boolean }[] } | undefined;
                        if (!data?.campaigns) return old;
                        return { ...data, campaigns: data.campaigns.map((c) => c.treeAddress === treeAddress ? { ...c, paused: newPaused } : c) };
                      },
                    );
                    fetch(`/api/campaigns/${treeAddress}/status`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ paused: newPaused }),
                    }).catch(() => {});
                  }}
                  toast={toast}
                />
                </>
              )}

              {canShowInstantRefund && (
                <button
                  onClick={() => setCancelOpen(true)}
                  className="w-full rounded-xl border border-amber-500/20 px-4 py-3 text-[13px] font-medium text-amber-400 transition hover:border-amber-500/40 hover:bg-amber-500/5"
                >
                  Instant Refund
                </button>
              )}

              {canShowCancel && !canShowInstantRefund && (
                <button
                  onClick={() => setCancelOpen(true)}
                  className="w-full rounded-xl border border-red-500/20 px-4 py-3 text-[13px] font-medium text-red-400 transition hover:border-red-500/40 hover:bg-red-500/5"
                >
                  {isSingleLeaf ? "Cancel Stream" : "Cancel Campaign"}
                </button>
              )}

              {program && (
                <WithdrawUnvestedButton
                  ref={withdrawButtonRef}
                  program={program}
                  publicKey={publicKey}
                  treePubkey={new PublicKey(treeAddress)}
                  mint={treeState.mint}
                  vaultAuthority={treeState.vaultAuthority}
                  vault={treeState.vault}
                  cancelledAt={cancelledAtBigint}
                  isCreator={canShowWithdrawUnvested}
                  nowTs={nowTs}
                  onSuccess={() => fetchTree(true)}
                  toast={toast}
                />
              )}

              {program && claimRecordQuery.data && (
                <CloseClaimRecordButton
                  program={program}
                  publicKey={publicKey}
                  treePubkey={new PublicKey(treeAddress)}
                  totalEntitled={BigInt(claimRecordQuery.data.totalEntitled.toString())}
                  claimedAmount={BigInt(claimRecordQuery.data.claimedAmount.toString())}
                  cancelledAt={cancelledAtBigint}
                  nowTs={nowTs}
                  onSuccess={() => fetchTree(true)}
                  toast={toast}
                />
              )}

              {canShowRootRotation && (
                <Card className="rounded-2xl">
                  <CardContent className="p-5">
                    <div className="space-y-1">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Advanced Admin</p>
                      <h3 className="text-[15px] font-medium text-foreground">Allocation Editor</h3>
                      <p className="text-[13px] leading-6 text-muted-foreground">
                        Update the recipient list for this campaign without creating a new one. Use this only when you need to correct future allocations.
                      </p>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Current Root</p>
                        <p className="mt-2 font-mono text-[12px] text-foreground">{currentMerkleRootHex ? `${currentMerkleRootHex.slice(0, 10)}...${currentMerkleRootHex.slice(-8)}` : "—"}</p>
                      </div>
                      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Current Version</p>
                        <p className="mt-2 text-[13px] text-foreground">v{rootVersions[0]?.version ?? 1} · {treeState.leafCount} leaves</p>
                      </div>
                    </div>
                    <a
                      href={`/campaign/${treeAddress}/allocations`}
                      className="mt-4 inline-flex w-full items-center justify-center rounded-xl border border-white/[0.08] bg-white px-4 py-3 text-[13px] font-medium text-[#0d1117] transition hover:opacity-90"
                    >
                      Open Allocation Editor
                    </a>
                  </CardContent>
                </Card>
              )}
            </div>

            {txStatus.type === "success" && (
              <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <p className="text-[12px] font-medium text-emerald-400">Transaction submitted.</p>
                <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">{txStatus.sig}</p>
                {isWrappedSolStream && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                    <span className="text-[12px] text-amber-300">Claimed tokens are in wSOL.</span>
                    <button
                      type="button"
                      onClick={() => setWrapModalOpen(true)}
                      className="rounded-md bg-amber-500/20 px-3 py-1 text-[11px] font-medium text-amber-300 transition hover:bg-amber-500/30"
                    >
                      Unwrap to SOL
                    </button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
          </Card>
        </div>
      </div>

      {/* Cancel confirmation dialog */}
      <CancelConfirmDialog
        isOpen={cancelOpen}
        onConfirm={handleCancel}
        onConfirmStream={handleCancelStream}
        onConfirmInstantRefund={handleInstantRefund}
        onClose={() => setCancelOpen(false)}
        isLoading={cancelLoading}
        isStreamLoading={cancelLoading}
        isInstantRefundLoading={instantRefundLoading}
        isSingleStream={isSingleLeaf && canCancelStream({
          viewer: publicKey,
          creator: treeState?.creator,
          cancellable: treeState?.cancellable ?? false,
          cancelledAt: cancelledAtBigint,
          totalSupply,
          totalClaimed,
          leafCount: treeState?.leafCount ?? 0,
        })}
        isInstantRefundEligible={canShowInstantRefund}
        scheduleLoaded={scheduleSource !== "none" && !!cliffTime && !!endTime}
        beneficiaryUnknown={!expectedBeneficiary}
        manualBeneficiary={manualBeneficiary}
        onManualBeneficiaryChange={setManualBeneficiary}
        totalSupply={totalSupply}
        totalClaimed={totalClaimed}
        vestedAmount={vested}
        mintDecimals={mintDecimals}
      />

      <WrapSolModal
        isOpen={wrapModalOpen}
        onClose={() => setWrapModalOpen(false)}
        onSuccess={() => {
          setWrapModalOpen(false);
          toast("wSOL unwrapped to SOL!", "success");
        }}
      />

      <RecipientListModal
        isOpen={recipientsOpen}
        onClose={() => setRecipientsOpen(false)}
        recipients={campaignRecipients}
        mintDecimals={mintDecimals}
        viewer={publicKey?.toBase58()}
      />
    </div>
  );
}

/* ================================================================== */
/*  Sub-components                                                    */
/* ================================================================== */

function SectionHeader({
  title,
  caption,
}: {
  title: string;
  caption: string;
}) {
  return (
    <div>
      <h2 className="text-[16px] font-semibold text-white">{title}</h2>
      <p className="mt-1 text-[13px] text-[#8b92a5]">{caption}</p>
    </div>
  );
}

function FieldRow({
  label,
  input,
}: {
  label: string;
  input: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-[12px] font-medium text-[#8b92a5]">{label}</label>
      {input}
    </div>
  );
}

/** Metric card used in the 4-card grid. */
function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-5">
        <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
        <p className={cn("mt-2 text-2xl font-semibold tabular-nums", accent ? "text-violet-400" : "text-foreground")}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function MetricSkeletonGroup() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
    </div>
  );
}

function MetricCardSkeleton() {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-8 w-28" />
      </CardContent>
    </Card>
  );
}

/** Key-value row inside the Campaign Details card. */
function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-[12px] text-muted-foreground">{label}</span>
      {mono ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default text-right font-mono text-[13px] text-foreground">
              {truncateAddress(value)}
            </span>
          </TooltipTrigger>
          <TooltipContent side="left">
            <p className="max-w-xs break-all font-mono text-[11px]">{value}</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className="text-right text-[13px] text-foreground">{value}</span>
      )}
    </div>
  );
}

function RecipientListModal({
  isOpen,
  onClose,
  recipients,
  mintDecimals,
  viewer,
}: {
  isOpen: boolean;
  onClose: () => void;
  recipients: Array<{
    beneficiary: string;
    allocation: string;
    leafCount: number;
    claimedAmount: string;
  }>;
  mintDecimals: number | null;
  viewer?: string;
}) {
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const formatAmount = (raw: string) => {
    const value = BigInt(raw);
    if (mintDecimals === null) return value.toString();
    if (mintDecimals === 0) return value.toLocaleString();
    const divisor = 10n ** BigInt(mintDecimals);
    const whole = value / divisor;
    const frac = value % divisor;
    const fracStr = frac.toString().padStart(mintDecimals, "0").slice(0, 4).replace(/0+$/, "");
    return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
  };
  const filteredRecipients = recipients.filter((recipient) =>
    recipient.beneficiary.toLowerCase().includes(search.trim().toLowerCase()),
  );

  async function handleCopy(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(address);
      window.setTimeout(() => {
        setCopied((current) => (current === address ? null : current));
      }, 1500);
    } catch {
      setCopied(null);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl gap-0 p-0">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle className="text-[20px] font-semibold">Recipients</DialogTitle>
          <DialogDescription>
            Latest recipient list from the current campaign root.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipient wallet"
            className="w-full rounded-2xl border border-white/[0.08] bg-[#11161f] px-4 py-3 text-[13px] text-white outline-none transition focus:border-white/20"
          />
        </div>

        <ScrollArea className="max-h-[60vh] px-6 pb-6">
          <div className="space-y-3 pr-1">
            {filteredRecipients.map((recipient) => {
              const allocation = BigInt(recipient.allocation);
              const claimedAmount = BigInt(recipient.claimedAmount);
              const fullyClaimed = claimedAmount >= allocation && allocation > 0n;
              const partiallyClaimed = claimedAmount > 0n && claimedAmount < allocation;

              return (
                <Card key={recipient.beneficiary} className="rounded-2xl">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-mono text-[13px] text-foreground" title={recipient.beneficiary}>
                            {recipient.beneficiary}
                          </p>
                          {viewer === recipient.beneficiary && (
                            <Badge variant="outline" className="h-auto rounded-full border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300">
                              You
                            </Badge>
                          )}
                          <Badge
                            variant="outline"
                            className={cn(
                              "h-auto rounded-full px-2 py-0.5 text-[10px] font-medium",
                              fullyClaimed
                                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                                : partiallyClaimed
                                  ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
                                  : "border-white/[0.08] bg-white/[0.03] text-muted-foreground",
                            )}
                          >
                            {fullyClaimed ? "Fully claimed" : partiallyClaimed ? "Partially claimed" : "Unclaimed"}
                          </Badge>
                        </div>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          {recipient.leafCount} {recipient.leafCount === 1 ? "allocation" : "allocations"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(recipient.beneficiary)}
                        className="shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] font-medium text-foreground transition hover:bg-white/[0.06]"
                      >
                        {copied === recipient.beneficiary ? "Copied" : "Copy"}
                      </button>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Allocation</p>
                        <p className="mt-1.5 text-[14px] font-medium tabular-nums text-foreground">{formatAmount(recipient.allocation)}</p>
                      </div>
                      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3">
                        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Claimed</p>
                        <p className="mt-1.5 text-[14px] font-medium tabular-nums text-foreground">{formatAmount(recipient.claimedAmount)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {filteredRecipients.length === 0 && (
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-8 text-center text-[13px] text-muted-foreground">
                No recipient matched that wallet.
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

/** Small animated spinner. */
function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="opacity-20"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
