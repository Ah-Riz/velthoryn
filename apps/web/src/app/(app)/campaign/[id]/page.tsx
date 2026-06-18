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
import {
  extractSimulationDetails,
  isWalletCancellation,
  formatVestingError,
  formatVestingErrorWithLogs,
} from "@/lib/anchor/errors";
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

  const isE2eMockTx =
    typeof window !== "undefined" &&
    window.localStorage.getItem("velthoryn:e2e-mock-send-tx") === "1";

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

  // Scroll to top on every navigation to this page (prevents router-cache scroll restoration flash)
  useEffect(() => {
    if (!window.location.hash) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    }
  }, [treeAddress]);

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
          cancelledAt: account.cancelledAt ??
            (campaignDetailRef.current?.cancelledAt != null
              ? new BN(campaignDetailRef.current.cancelledAt)
              : null),
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

  // cancelStream (instant settle) does NOT set cancelledAt on-chain — merge DB value when on-chain is null
  useEffect(() => {
    const dbCancelledAt = campaignDetailQuery.data?.cancelledAt;
    if (!dbCancelledAt) return;
    setTreeState((prev) => {
      if (!prev || prev.cancelledAt !== null) return prev;
      const next = { ...prev, cancelledAt: new BN(dbCancelledAt) };
      treeStateRef.current = next;
      return next;
    });
  }, [campaignDetailQuery.data?.cancelledAt]);

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
        } else if (campaignDetailQuery.data?.singleLeaf) {
          const sl = campaignDetailQuery.data.singleLeaf;
          applyScheduleToForm(sl, {
            setReleaseType,
            setStartTime,
            setCliffTime,
            setEndTime,
            setMilestoneIdx,
            setRawStartTs,
            setRawCliffTs,
            setRawEndTs,
          });
          setExpectedBeneficiary(sl.beneficiary);
          setScheduleSource("api");
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
    campaignDetailQuery.data,
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
  const hasCampaignControls =
    isCreator ||
    canShowPauseToggle ||
    canShowCancel ||
    canShowInstantRefund ||
    canShowWithdrawUnvested ||
    canShowReleaseMilestone;
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

  const campaignTotalVested = (() => {
    const curve = campaignDetailQuery.data?.vestingCurve;
    if (curve && curve.samples.length > 1) {
      const effectiveT = cancelledAtBigint !== null
        ? Math.min(Number(cancelledAtBigint), Number(nowTs))
        : Number(nowTs);
      const samples = curve.samples;
      if (effectiveT <= samples[0].t) return 0n;
      if (effectiveT >= samples[samples.length - 1].t) return BigInt(samples[samples.length - 1].vested);
      for (let i = 1; i < samples.length; i++) {
        if (effectiveT <= samples[i].t) {
          const s0 = samples[i - 1];
          const s1 = samples[i];
          const frac = (effectiveT - s0.t) / (s1.t - s0.t || 1);
          const v0 = BigInt(s0.vested);
          const v1 = BigInt(s1.vested);
          return v0 + BigInt(Math.round(Number(v1 - v0) * frac));
        }
      }
      return 0n;
    }
    return vested;
  })();

  const campaignProgress = progressPercent(campaignTotalVested, totalSupply);
  const isWalletRecipient = isMultiRecipient ? isRecipientView : !beneficiaryMismatch;
  const campaignVestedLabel = isMilestone
    ? milestoneEntries.length > 1
      ? milestoneReleasedCount === 0
        ? "Not yet released"
        : milestoneReleasedCount === milestoneEntries.length
          ? "All released"
          : `${milestoneReleasedCount}/${milestoneEntries.length} released`
      : milestoneReleased ? "Released" : "Pending"
    : `${campaignProgress}%`;

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
    : (streamSettled || hasStreamCancelledEvent) && cancelledAtBigint !== null
      ? isCancelledBeforeCliff
        ? "Cancelled — vesting had not started yet"
        : "Settled — tokens sent to your wallet"
    : cancelledAtBigint !== null && displayClaimable === 0n
      ? "Campaign Cancelled"
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
          : cancelledAtBigint !== null && displayClaimable > 0n
            ? `Claim Vested ${formatTokenAmount(displayClaimable)}`
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
      : isWithdrawn
        ? "Settled"
        : treeState?.cancelledAt
          ? "Cancelled"
          : displaySupply > 0n && displayClaimed >= displaySupply
            ? "Claimed"
            : "Active";

  const statusBadgeClass = treeState?.instantRefunded
    ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400"
    : treeState?.paused
      ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      : isWithdrawn
        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
        : treeState?.cancelledAt
          ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400"
          : displaySupply > 0n && displayClaimed >= displaySupply
            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            : "border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-400";

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
      if (!isE2eMockTx) await connection.confirmTransaction(sig, "confirmed");

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
      if (isWalletCancellation(err)) {
        setTxStatus({ type: "idle" });
        return;
      }
      const { logs, programErr } = extractSimulationDetails(err);
      const msg = formatVestingErrorWithLogs(err, logs, programErr);
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
      const args = {
        releaseType,
        startTime: startTs,
        cliffTime: cliffTs,
        endTime: endTs,
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
        if (!isE2eMockTx) await connection.confirmTransaction(cancelStreamSig, "confirmed");
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
        if (!isE2eMockTx) await connection.confirmTransaction(cancelStreamSig, "confirmed");
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
          const data = old as { campaigns?: { treeAddress: string; cancelledAt: number | null; totalClaimed?: number | string; streamSettled?: boolean }[] } | undefined;
          if (!data?.campaigns) return old;
          return { ...data, campaigns: data.campaigns.map((c) => c.treeAddress === treeAddress ? { ...c, cancelledAt: cancelTs, totalClaimed: nextTotalClaimed.toString(), streamSettled: true } : c) };
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
      if (isWalletCancellation(err)) {
        setTxStatus({ type: "idle" });
        return;
      }
      const { logs, programErr } = extractSimulationDetails(err);
      const msg = formatVestingErrorWithLogs(err, logs, programErr);
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
          })
          .instruction();
        const refundTx = new Transaction().add(refundIx);
        const refundSig = await sendTransaction(refundTx, connection);
        if (!isE2eMockTx) await connection.confirmTransaction(refundSig, "confirmed");
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
        if (!isE2eMockTx) await connection.confirmTransaction(refundSig, "confirmed");
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
      if (isWalletCancellation(err)) {
        setInstantRefundLoading(false);
        return;
      }
      const { logs, programErr } = extractSimulationDetails(err);
      const msg = formatVestingErrorWithLogs(err, logs, programErr);
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

      // Build the transaction (separated from sending so we can simulate first)
      const tx: Transaction = isNativeSol(treeState.mint)
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
            return new Transaction().add(withdrawIx);
          })()
        : await (async () => {
            const [vaultAuthority] = derivePda(["vault_authority", treePubkey.toBuffer()]);
            const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
            const beneficiaryAta = getAssociatedTokenAddressSync(treeState!.mint, publicKey);

            const withdrawIx = await program.methods
              .withdraw(args)
              .accounts({
                beneficiary: publicKey,
                vestingTree: treePubkey,
                claimRecord,
                vaultAuthority,
                vault: treeState!.vault,
                beneficiaryAta,
                mint: treeState!.mint,
              })
              .instruction();
            return new Transaction().add(withdrawIx);
          })();

      // Simulate to surface program errors (InvalidProof, UnauthorizedClaimer, etc.) before sending
      const anchorProvider = program.provider as {
        simulate?: (tx: Transaction, signers?: unknown[]) => Promise<unknown>;
      };
      if (anchorProvider.simulate) {
        try {
          await anchorProvider.simulate(tx, []);
        } catch (simErr: unknown) {
          if (isWalletCancellation(simErr)) {
            setTxStatus({ type: "idle" });
            return;
          }
          const { logs: simLogs, programErr } = extractSimulationDetails(simErr);
          console.error("[handleWithdraw] simulation failed", { simErr, simLogs });
          const simMsg = formatVestingErrorWithLogs(simErr, simLogs, programErr);
          setTxStatus({ type: "error", msg: simMsg });
          toast(simMsg, "error");
          return;
        }
      }

      const sig = await sendTransaction(tx, connection);

      if (!isE2eMockTx) await connection.confirmTransaction(sig, "confirmed");

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
        await fetch("/api/events/sync", {
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
      if (isWalletCancellation(err)) {
        setTxStatus({ type: "idle" });
        return;
      }
      const { logs, programErr } = extractSimulationDetails(err);
      if (logs.length > 0) console.error("[handleWithdraw] tx failure logs:", logs);
      const msg = formatVestingErrorWithLogs(err, logs, programErr);
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
      <div className="mx-auto max-w-5xl min-h-screen space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="h-4 w-1/4" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="rounded-xl">
              <CardContent className="px-4 py-3">
                <Skeleton className="h-2.5 w-1/2" />
                <Skeleton className="mt-2 h-5 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="rounded-xl">
          <CardContent className="px-4 py-3">
            <Skeleton className="h-2.5 w-1/4" />
            <Skeleton className="mt-3 h-2 w-full" />
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
          <p className="text-[13px] text-red-700 dark:text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  /* -- No wallet -- */
  if (!publicKey) {
    return (
      <div className="mx-auto max-w-5xl flex flex-col items-center justify-center py-32">
        <p className="text-[15px] text-muted-foreground">Connect your wallet to view and claim tokens</p>
      </div>
    );
  }

  /* -- No tree data -- */
  if (!treeState) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-10 pb-16">

      {/* ── Header ───────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[24px] font-bold tracking-tight text-foreground">{pageTitle}</h1>
          <Badge variant="outline" className={cn("h-auto rounded-full px-3 py-1 text-[12px] font-semibold", statusBadgeClass)}>
            {statusLabel}
          </Badge>
          <Badge variant="outline" className={cn("h-auto rounded-full px-3 py-1 text-[12px] font-medium", getVestingTypeBadgeColor(releaseType))}>
            {getVestingTypeLabel(releaseType)}
          </Badge>
          {isCliff && cliffTime && nowTs < cliffTsBigint && (
            <Badge variant="outline" className="h-auto rounded-full border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-[12px] font-medium text-indigo-700 dark:text-indigo-400">
              Unlocks in {formatCountdown(cliffTsBigint, nowTs)}
            </Badge>
          )}
          {isMilestone && (
            <Badge variant="outline" className={cn("h-auto rounded-full px-3 py-1 text-[12px] font-medium", milestoneTriggered ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border-foreground/[0.08] bg-foreground/[0.02] text-muted-foreground")}>
              {milestoneLifecycleLabel}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground">
          <span>ID #{treeState.campaignId.toString()}</span>
          <span className="text-foreground/15">·</span>
          <span className="flex items-center gap-1.5">
            By{" "}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default font-mono text-foreground/70 transition-colors hover:text-foreground">{truncateAddress(treeState.creator.toBase58())}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="font-mono text-[11px]">{treeState.creator.toBase58()}</p></TooltipContent>
            </Tooltip>
          </span>
          <span className="text-foreground/15">·</span>
          <span>{treeState.leafCount} {treeState.leafCount === 1 ? "recipient" : "recipients"}</span>
          <span className="text-foreground/15">·</span>
          <span>{formatTokenAmount(totalSupply)} total</span>
          {mintLabel && (
            <>
              <span className="text-foreground/15">·</span>
              <span className="text-foreground/70">{mintLabel}</span>
            </>
          )}
        </div>
      </div>

      {/* Recipient claim indicator — only visible to recipients, not creators */}
      {isWalletRecipient && !isCreator && (
        <RecipientClaimBanner
          displayClaimable={displayClaimable}
          displayProgress={displayProgress}
          paused={treeState.paused}
          cancelledAt={cancelledAtBigint}
          claimFundingDisabledReason={claimFundingDisabledReason}
          withdrawDisabledReason={withdrawDisabledReason}
          waitCountdown={waitCountdown}
          formatTokenAmount={formatTokenAmount}
          mintLabel={mintLabel}
        />
      )}

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
        <div className="rounded-lg border border-red-500/15 bg-red-500/5 px-4 py-3 text-[12px] text-red-600 dark:text-red-300">
          {fundingStatus.msg}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════ */}
      {/*  SECTION 1: Campaign Overview                      */}
      {/* ═══════════════════════════════════════════════════ */}
      <section className="space-y-6">
        <SectionDivider title="Campaign Overview" />

        <StatGrid stats={[
          { label: "Total Allocation", value: formatTokenAmount(totalSupply) },
          { label: "Vested",           value: campaignVestedLabel },
          { label: "Claimed",          value: formatTokenAmount(treeTotalClaimed) },
          { label: "Recipients",       value: String(treeState.leafCount) },
        ]} />

        {/* Campaign Vesting Curve */}
        {!isMilestone && cliffTime && endTime && !campaignDetailQuery.data?.vestingCurve && (
          <Card className="relative overflow-hidden rounded-2xl border-foreground/[0.06]">
            <CardContent className="px-5 py-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-[14px] font-semibold text-foreground">Vesting Curve</p>
                  {isMultiWallet && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground/60">Aggregated across all recipients</p>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-[22px] font-bold tabular-nums leading-none tracking-tight text-foreground">{campaignProgress}%</span>
                  {campaignProgress >= 100 && (
                    <p className="mt-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">Fully vested</p>
                  )}
                </div>
              </div>
              <Progress value={Math.min(campaignProgress, 100)} className="h-1 mb-4" />
              <VestingChart
                releaseType={releaseType}
                startTs={datetimeLocalToUnix(startTime || cliffTime)}
                cliffTs={datetimeLocalToUnix(cliffTime)}
                endTs={datetimeLocalToUnix(endTime)}
                totalAmount={totalSupply}
                vestedAmount={campaignTotalVested}
                cancelledAt={cancelledAtBigint ? Number(cancelledAtBigint) : null}
                milestoneCount={isMilestone ? (treeState?.leafCount ?? 1) : undefined}
                formatAmount={formatTokenAmount}
              />
            </CardContent>
            {campaignProgress >= 100 && (
              <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-emerald-500/10" />
            )}
          </Card>
        )}

        {/* Aggregate campaign curve for multi-recipient campaigns */}
        {campaignDetailQuery.data?.vestingCurve && campaignDetailQuery.data.vestingCurve.samples.length > 0 && (
          <Card className="relative overflow-hidden rounded-2xl border-foreground/[0.06]">
            <CardContent className="px-5 py-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-[14px] font-semibold text-foreground">Vesting Curve</p>
                  {isMultiWallet && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground/60">Aggregated across all recipients</p>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-[22px] font-bold tabular-nums leading-none tracking-tight text-foreground">{campaignProgress}%</span>
                  {campaignProgress >= 100 && (
                    <p className="mt-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">Fully vested</p>
                  )}
                </div>
              </div>
              <Progress value={Math.min(campaignProgress, 100)} className="h-1 mb-4" />
              <VestingChart
                releaseType={releaseType}
                startTs={campaignDetailQuery.data.vestingCurve.minStartTime}
                cliffTs={campaignDetailQuery.data.vestingCurve.minStartTime}
                endTs={campaignDetailQuery.data.vestingCurve.maxEndTime}
                totalAmount={totalSupply}
                vestedAmount={campaignTotalVested}
                cancelledAt={cancelledAtBigint ? Number(cancelledAtBigint) : null}
                formatAmount={formatTokenAmount}
                aggregateSamples={campaignDetailQuery.data.vestingCurve.samples}
              />
            </CardContent>
            {campaignProgress >= 100 && (
              <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-emerald-500/10" />
            )}
          </Card>
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

        {/* Campaign Vesting Schedule */}
        {(cliffTime && endTime) || campaignDetailQuery.data?.vestingCurve ? (
          <VestingScheduleTimeline
            isCliff={isCliff}
            isLinear={isLinear}
            isMilestone={isMilestone}
            startTime={campaignDetailQuery.data?.vestingCurve
              ? unixToDatetimeLocal(campaignDetailQuery.data.vestingCurve.minStartTime)
              : startTime}
            cliffTime={cliffTime || (campaignDetailQuery.data?.vestingCurve
              ? unixToDatetimeLocal(campaignDetailQuery.data.vestingCurve.minStartTime)
              : "")}
            endTime={campaignDetailQuery.data?.vestingCurve
              ? unixToDatetimeLocal(campaignDetailQuery.data.vestingCurve.maxEndTime)
              : endTime}
            nowTs={Number(nowTs)}
            cancelledAt={cancelledAtBigint !== null ? Number(cancelledAtBigint) : null}
            aggregateSamples={campaignDetailQuery.data?.vestingCurve?.samples}
            title="Vesting Schedule"
            subtitle={isMultiWallet ? "Aggregated across all recipients" : undefined}
          />
        ) : null}

        <BeneficiariesSection
          isSingleLeaf={isSingleLeaf}
          expectedBeneficiary={expectedBeneficiary}
          campaignRecipients={campaignRecipients}
          leafCount={treeState.leafCount}
          viewer={publicKey?.toBase58()}
          onViewAll={() => setRecipientsOpen(true)}
        />

        <CampaignTimeline treeAddress={treeAddress} mintDecimals={mintDecimals} />

        <RootVersionSection
          currentRootHex={currentMerkleRootHex}
          rootVersions={rootVersions}
          leafCount={treeState.leafCount}
          treeAddress={treeAddress}
          canRotate={canShowRootRotation}
        />
      </section>

      {/* ═══════════════════════════════════════════════════ */}
      {/*  SECTION 2: Your Position                          */}
      {/* ═══════════════════════════════════════════════════ */}
      {isWalletRecipient && (
        <section className="space-y-6">
          <SectionDivider title="Your Position" accent />

          {isRecipientMetricsLoading ? (
            <MetricSkeletonGroup />
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-4">
                <StatGrid cols={3} stats={[
                  { label: "Your Allocation", value: formatTokenAmount(displaySupply), accent: true },
                  { label: "Claimed",         value: formatTokenAmount(displayClaimed) },
                  { label: "Progress",        value: `${displayProgress}%` },
                ]} />

                {scheduleSource === "url" && (
                  <div className="rounded-lg border border-amber-500/15 bg-amber-500/5 px-3.5 py-2.5 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
                    <strong>Unverified:</strong> Schedule from URL — amounts may differ from on-chain state.
                  </div>
                )}
                {isSingleLeaf && beneficiaryMismatch && expectedBeneficiary && (
                  <div className="rounded-lg border border-amber-500/15 bg-amber-500/5 px-3.5 py-2.5 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
                    Connected wallet doesn&apos;t match the beneficiary.
                  </div>
                )}
                {isSingleLeaf && !expectedBeneficiary && scheduleSource !== "api" && scheduleSource !== "url" && (
                  <div className="rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] px-3.5 py-2.5 text-[11px] leading-5 text-muted-foreground/70">
                    Beneficiary could not be verified from indexed data.
                  </div>
                )}

                {isSingleLeaf && (
                  <MilestoneStatusBadge
                    isMilestoneType={isMilestone}
                    alreadyTriggered={milestoneTriggered}
                    milestoneReleased={milestoneReleased}
                    milestoneIdx={Number(milestoneIdx)}
                    cliffTime={cliffTsBigint}
                    nowTs={nowTs}
                  />
                )}
              </div>

              {/* Claim panel (sticky) */}
              <div className="space-y-4">
                <div id="campaign-actions" className="lg:sticky lg:top-6 space-y-4">
                  <Card className="overflow-hidden rounded-2xl border-emerald-500/15 shadow-sm shadow-emerald-500/5">
                    <CardContent className="p-0">
                      <div className="px-5 pt-5 pb-4 border-b border-emerald-500/10 bg-emerald-500/[0.02]">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-emerald-600/70 dark:text-emerald-400/70 mb-1.5">Your Claimable</p>
                        <p className="text-[32px] font-bold tabular-nums tracking-tight leading-none text-emerald-600 dark:text-emerald-400">
                          {formatTokenAmount(displayClaimable)}
                        </p>
                        {mintLabel && <p className="mt-1.5 text-[12px] text-muted-foreground/60">{mintLabel}</p>}
                      </div>

                      <div className="px-5 py-4 space-y-3">
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
                          <button type="button" disabled className="w-full cursor-not-allowed rounded-xl bg-foreground px-5 py-3.5 text-[15px] font-semibold text-background opacity-50">
                            {claimFundingDisabledReason}
                          </button>
                        ) : (
                          <button
                            onClick={handleWithdraw}
                            disabled={!!withdrawDisabledReason || !!claimFundingDisabledReason}
                            className="w-full rounded-xl bg-emerald-600 px-5 py-3.5 text-[15px] font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-foreground disabled:text-background"
                          >
                            {txStatus.type === "loading" ? "Claiming..." : claimActionLabel}
                          </button>
                        )}

                        {waitCountdown && (
                          <div className="flex items-center justify-between rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] px-3.5 py-2.5">
                            <span className="text-[11px] text-muted-foreground/70">Next unlock</span>
                            <span className="text-[12px] font-medium tabular-nums text-foreground">{waitCountdown}</span>
                          </div>
                        )}

                        {txStatus.type === "success" && (
                          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                            <p className="text-[12px] font-medium text-emerald-700 dark:text-emerald-400">Transaction submitted.</p>
                            <p className="mt-1.5 break-all font-mono text-[10px] text-muted-foreground/70">{txStatus.sig}</p>
                            {isWrappedSolStream && (
                              <div className="mt-2.5 flex items-center gap-2 rounded-md border border-amber-500/15 bg-amber-500/5 p-2.5">
                                <span className="text-[11px] text-amber-700 dark:text-amber-300">Claimed wSOL.</span>
                                <button type="button" onClick={() => setWrapModalOpen(true)} className="rounded-md bg-amber-500/20 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300 transition hover:bg-amber-500/30">
                                  Unwrap to SOL
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {txStatus.type === "error" && (
                          <div className="rounded-lg border border-red-500/15 bg-red-500/5 px-4 py-2.5 text-[12px] text-red-600 dark:text-red-400">
                            {txStatus.msg}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ═══════════════════════════════════════════════════ */}
      {/*  Campaign Management                               */}
      {/* ═══════════════════════════════════════════════════ */}
      {program && (
        <section className="space-y-6">
          <SectionDivider title={hasCampaignControls ? "Campaign Management" : "Account"} />
          <Card className="rounded-2xl border-foreground/[0.06]">
            <CardContent className="px-5 py-5 space-y-3">
              {treeState.pauseAuthority && treeState.creator && !treeState.pauseAuthority.equals(treeState.creator) && (
                <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80">Pause authority differs from creator. Pausing blocks all claims.</p>
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
              {isSingleLeaf && program && (
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
              {canShowInstantRefund && (
                <button onClick={() => setCancelOpen(true)} className="w-full rounded-lg border border-amber-500/15 px-4 py-2.5 text-[13px] font-medium text-amber-700 dark:text-amber-400 transition hover:border-amber-500/30 hover:bg-amber-500/5">
                  Instant Refund
                </button>
              )}
              {canShowCancel && !canShowInstantRefund && (
                <button onClick={() => setCancelOpen(true)} className="w-full rounded-lg border border-red-500/15 px-4 py-2.5 text-[13px] font-medium text-red-700 dark:text-red-400 transition hover:border-red-500/30 hover:bg-red-500/5">
                  {isSingleLeaf ? "Cancel Stream" : "Cancel Campaign"}
                </button>
              )}
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
              {claimRecordQuery.data && (
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
            </CardContent>
          </Card>
        </section>
      )}

      {/* Advanced Details */}
      <AdvancedDetailsPanel
        treeAddress={treeAddress}
        creator={treeState.creator.toBase58()}
        mintLabel={mintLabel ?? treeState.mint.toBase58()}
        mintIsMono={mintLabel === null || mintLabel === treeState.mint.toBase58()}
        campaignId={treeState.campaignId.toString()}
        createdAt={formatDate(treeState.createdAt.toNumber())}
        isSingleLeaf={isSingleLeaf}
        scheduleLocked={scheduleLocked}
        showManualSchedule={showManualSchedule}
        onShowManual={() => setShowManualSchedule(true)}
        onHideManual={() => setShowManualSchedule(false)}
        releaseType={releaseType}
        setReleaseType={setReleaseType}
        startTime={startTime}
        setStartTime={setStartTime}
        cliffTime={cliffTime}
        setCliffTime={setCliffTime}
        endTime={endTime}
        setEndTime={setEndTime}
        milestoneIdx={milestoneIdx}
        setMilestoneIdx={setMilestoneIdx}
        isCliff={isCliff}
        isMilestone={isMilestone}
        showReadOnlySchedule={showReadOnlySchedule}
        proofQueryLoading={proofQuery.isLoading}
      />

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
      <h2 className="text-[14px] font-semibold text-foreground">{title}</h2>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{caption}</p>
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
      <label className="mb-2 block text-[12px] font-medium text-muted-foreground">{label}</label>
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
    <Card className="rounded-xl">
      <CardContent className="px-4 py-3">
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
        <p className={cn("mt-1 text-lg font-semibold tabular-nums sm:text-xl", accent ? "text-violet-700 dark:text-violet-400" : "text-foreground")}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function MetricSkeletonGroup() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="grid grid-cols-3 rounded-xl border border-foreground/[0.06] overflow-hidden bg-foreground/[0.04] gap-px">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-background px-5 py-4">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="mt-3 h-6 w-24" />
          </div>
        ))}
      </div>
      <MetricCardSkeleton tall />
    </div>
  );
}

function MetricCardSkeleton({ tall }: { tall?: boolean }) {
  return (
    <Card className="rounded-xl border-foreground/[0.06]">
      <CardContent className={cn("px-4", tall ? "py-8" : "py-3.5")}>
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="mt-3 h-7 w-24" />
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
    <div className="flex items-start justify-between gap-3 sm:gap-4">
      <span className="shrink-0 text-[11px] sm:text-[12px] text-muted-foreground">{label}</span>
      {mono ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default text-right font-mono text-[12px] sm:text-[13px] text-foreground truncate max-w-[140px] sm:max-w-none">
              {truncateAddress(value)}
            </span>
          </TooltipTrigger>
          <TooltipContent side="left">
            <p className="max-w-xs break-all font-mono text-[11px]">{value}</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className="text-right text-[12px] sm:text-[13px] text-foreground">{value}</span>
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
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 border-b border-foreground/[0.05] px-6 py-5">
          <div>
            <div className="flex items-center gap-2.5">
              <DialogTitle className="text-[16px] font-semibold leading-none text-foreground">Recipients</DialogTitle>
              <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground/70">
                {recipients.length}
              </span>
            </div>
            <DialogDescription className="mt-1.5 text-[12px] text-muted-foreground/50">
              Current campaign root — latest allocation snapshot
            </DialogDescription>
          </div>
        </div>

        {/* ── Search ─────────────────────────────────────────── */}
        <div className="border-b border-foreground/[0.04] px-6 py-3">
          <div className="relative">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40"
            >
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by wallet address…"
              className="w-full rounded-xl border border-foreground/[0.07] bg-foreground/[0.02] py-2.5 pl-9 pr-4 text-[13px] text-foreground placeholder:text-muted-foreground/40 outline-none transition focus:border-foreground/[0.15] focus:bg-foreground/[0.03]"
            />
          </div>
        </div>

        {/* ── Recipient rows ─────────────────────────────────── */}
        <ScrollArea className="max-h-[56vh]">
          {filteredRecipients.length > 0 ? (
            <div className="divide-y divide-foreground/[0.04]">
              {filteredRecipients.map((recipient) => {
                const allocation = BigInt(recipient.allocation);
                const claimedAmount = BigInt(recipient.claimedAmount);
                const fullyClaimed = claimedAmount >= allocation && allocation > 0n;
                const partiallyClaimed = claimedAmount > 0n && claimedAmount < allocation;
                const isViewer = viewer === recipient.beneficiary;
                const isCopied = copied === recipient.beneficiary;

                return (
                  <div
                    key={recipient.beneficiary}
                    className={cn(
                      "group flex items-center gap-4 px-6 py-4 transition-colors hover:bg-foreground/[0.02]",
                      isViewer && "bg-violet-500/[0.03]",
                    )}
                  >
                    {/* Primary: address + metadata */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-default font-mono text-[13px] text-foreground">
                              {truncateAddress(recipient.beneficiary, 8)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <p className="max-w-xs break-all font-mono text-[11px]">{recipient.beneficiary}</p>
                          </TooltipContent>
                        </Tooltip>
                        {isViewer && (
                          <Badge variant="outline" className="h-auto rounded-full border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">
                            You
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/60">
                        <span>{recipient.leafCount} {recipient.leafCount === 1 ? "alloc." : "allocs."}</span>
                        <span className="text-foreground/[0.08]">·</span>
                        <span>
                          <span className="text-muted-foreground/40">Allocated</span>{" "}
                          <span className="tabular-nums text-foreground/70">{formatAmount(recipient.allocation)}</span>
                        </span>
                        <span className="text-foreground/[0.08]">·</span>
                        <span>
                          <span className="text-muted-foreground/40">Claimed</span>{" "}
                          <span className="tabular-nums text-foreground/70">{formatAmount(recipient.claimedAmount)}</span>
                        </span>
                      </div>
                    </div>

                    {/* Secondary: status badge + copy icon */}
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          "h-auto rounded-full px-2 py-0.5 text-[10px] font-medium",
                          fullyClaimed
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : partiallyClaimed
                              ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                              : "border-foreground/[0.08] bg-foreground/[0.03] text-muted-foreground/60",
                        )}
                      >
                        {fullyClaimed ? "Claimed" : partiallyClaimed ? "Partial" : "Pending"}
                      </Badge>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => handleCopy(recipient.beneficiary)}
                            className={cn(
                              "flex h-8 w-8 items-center justify-center rounded-lg border transition",
                              isCopied
                                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "border-foreground/[0.07] bg-foreground/[0.02] text-muted-foreground/40 hover:bg-foreground/[0.06] hover:text-foreground/70",
                            )}
                          >
                            {isCopied ? (
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 6 9 17l-5-5" />
                              </svg>
                            ) : (
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                              </svg>
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          <p className="text-[11px]">{isCopied ? "Copied!" : "Copy address"}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground/[0.04] text-muted-foreground/30">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                </svg>
              </div>
              <p className="mt-3 text-[13px] text-muted-foreground/60">No recipient matched that address</p>
            </div>
          )}
        </ScrollArea>

        {/* ── Footer count ───────────────────────────────────── */}
        {filteredRecipients.length > 0 && filteredRecipients.length < recipients.length && (
          <div className="border-t border-foreground/[0.04] px-6 py-3 text-[11px] text-muted-foreground/50">
            Showing {filteredRecipients.length} of {recipients.length} recipients
          </div>
        )}
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

/* ─── RecipientClaimBanner ────────────────────────────────────────────── */
function RecipientClaimBanner({
  displayClaimable,
  displayProgress,
  paused,
  cancelledAt,
  claimFundingDisabledReason,
  withdrawDisabledReason,
  waitCountdown,
  formatTokenAmount,
  mintLabel,
}: {
  displayClaimable: bigint;
  displayProgress: number;
  paused: boolean;
  cancelledAt: bigint | null;
  claimFundingDisabledReason: string | null;
  withdrawDisabledReason: string | null | undefined;
  waitCountdown: string | null;
  formatTokenAmount: (v: bigint) => string;
  mintLabel: string | null;
}) {
  const canClaim =
    displayClaimable > 0n &&
    !claimFundingDisabledReason &&
    !withdrawDisabledReason;
  const fullyDone =
    displayProgress >= 100 && displayClaimable === 0n && cancelledAt === null;
  const notFunded = claimFundingDisabledReason === "Campaign not funded yet";

  let pill: React.ReactNode = null;

  if (cancelledAt !== null && displayClaimable === 0n) {
    pill = (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/[0.07] bg-foreground/[0.03] px-3 py-1 text-[12px] text-muted-foreground/50">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
        Campaign cancelled — nothing left to claim
      </span>
    );
  } else if (fullyDone) {
    pill = (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1 text-[12px] text-emerald-600 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Fully claimed
      </span>
    );
  } else if (paused) {
    pill = (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/5 px-3 py-1 text-[12px] text-amber-600 dark:text-amber-400">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Campaign paused — claims temporarily disabled
      </span>
    );
  } else if (notFunded) {
    pill = (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/5 px-3 py-1 text-[12px] text-amber-600 dark:text-amber-400">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Waiting for funding — claims open once funded
      </span>
    );
  } else if (waitCountdown && !paused) {
    pill = (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/20 bg-violet-500/5 px-3 py-1 text-[12px] text-violet-600 dark:text-violet-400">
        <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
        Next unlock in {waitCountdown}
      </span>
    );
  } else if (canClaim) {
    pill = (
      <a
        href="#campaign-actions"
        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/8 px-3 py-1 text-[12px] font-medium text-emerald-600 transition hover:bg-emerald-500/15 dark:text-emerald-400"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {formatTokenAmount(displayClaimable)}{mintLabel ? ` ${mintLabel}` : ""} claimable — claim now
      </a>
    );
  }

  if (!pill) return null;

  return <div className="mt-3">{pill}</div>;
}

/* ─── SectionDivider ──────────────────────────────────────────────────── */
function SectionDivider({ title, accent }: { title: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-4">
      <h2 className={cn("shrink-0 text-[15px] font-semibold tracking-tight", accent ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>{title}</h2>
      <div className={cn("h-px flex-1", accent ? "bg-emerald-500/15" : "bg-foreground/[0.06]")} />
    </div>
  );
}

/* ─── StatGrid ────────────────────────────────────────────────────────── */
function StatGrid({
  stats,
  cols = 4,
}: {
  stats: Array<{ label: string; value: string; accent?: boolean; green?: boolean }>;
  cols?: 2 | 3 | 4;
}) {
  const gridClass =
    cols === 3
      ? "grid-cols-1 sm:grid-cols-3"
      : cols === 4
        ? "grid-cols-2 lg:grid-cols-4"
        : "grid-cols-2";
  return (
    <div className={cn("grid rounded-xl border border-foreground/[0.06] bg-foreground/[0.05] overflow-hidden gap-px", gridClass)}>
      {stats.map((stat) => (
        <div key={stat.label} className="bg-background px-5 py-4">
          <p className="text-[10px] uppercase tracking-[0.13em] text-muted-foreground/60">{stat.label}</p>
          <p className={cn(
            "mt-2 text-[20px] font-bold tabular-nums leading-none tracking-tight",
            stat.green ? "text-emerald-600 dark:text-emerald-400" :
            stat.accent ? "text-violet-600 dark:text-violet-400" :
            "text-foreground",
          )}>
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ─── KpiCard ─────────────────────────────────────────────────────────── */
function KpiCard({
  label,
  value,
  accent,
  green,
}: {
  label: string;
  value: string;
  accent?: boolean;
  green?: boolean;
}) {
  return (
    <Card className={cn("rounded-xl border-foreground/[0.06]", green && "border-emerald-500/15 bg-emerald-500/[0.03]")}>
      <CardContent className="px-4 py-3.5">
        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">{label}</p>
        <p className={cn(
          "mt-2 text-[22px] font-bold tabular-nums leading-none tracking-tight",
          green ? "text-emerald-600 dark:text-emerald-400" : accent ? "text-violet-600 dark:text-violet-400" : "text-foreground",
        )}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

/* ─── VestingScheduleTimeline ─────────────────────────────────────────── */
function VestingScheduleTimeline({
  isCliff,
  isLinear,
  isMilestone,
  startTime,
  cliffTime,
  endTime,
  nowTs,
  cancelledAt,
  aggregateSamples,
  title,
  subtitle,
}: {
  isCliff: boolean;
  isLinear: boolean;
  isMilestone: boolean;
  startTime: string;
  cliffTime: string;
  endTime: string;
  nowTs: number;
  cancelledAt: number | null;
  aggregateSamples?: Array<{ t: number; vested: string }> | null;
  title?: string;
  subtitle?: string;
}) {
  const startTs = startTime ? datetimeLocalToUnix(startTime) : datetimeLocalToUnix(cliffTime);
  const cliffTs = datetimeLocalToUnix(cliffTime);
  const endTs = datetimeLocalToUnix(endTime);

  type TimelineNode = { label: string; ts: number; sub?: string; highlight?: boolean };
  const nodes: TimelineNode[] = [];

  nodes.push({ label: "Start", ts: startTs });

  if (isCliff || isMilestone) {
    nodes.push({ label: isMilestone ? "Milestone Unlock" : "Cliff Unlock", ts: cliffTs, highlight: true });
  } else if (isLinear) {
    let midTs: number;
    if (aggregateSamples && aggregateSamples.length >= 2) {
      // Find the true 50% vested timestamp from aggregate curve samples
      const finalVested = Number(BigInt(aggregateSamples[aggregateSamples.length - 1].vested));
      const halfTarget = finalVested / 2;
      midTs = Math.round((startTs + endTs) / 2); // fallback
      for (let i = 1; i < aggregateSamples.length; i++) {
        const v0 = Number(BigInt(aggregateSamples[i - 1].vested));
        const v1 = Number(BigInt(aggregateSamples[i].vested));
        if (v1 >= halfTarget) {
          const frac = v1 === v0 ? 0 : (halfTarget - v0) / (v1 - v0);
          midTs = Math.round(aggregateSamples[i - 1].t + frac * (aggregateSamples[i].t - aggregateSamples[i - 1].t));
          break;
        }
      }
    } else {
      midTs = Math.round((startTs + endTs) / 2);
    }
    nodes.push({ label: "50% Vested", ts: midTs });
  }

  if (cancelledAt !== null) {
    nodes.push({ label: "Cancelled", ts: cancelledAt, sub: "stream ended", highlight: true });
  }

  nodes.push({ label: "End", ts: endTs });

  nodes.sort((a, b) => a.ts - b.ts);

  const allPast = nodes.length > 0 && nowTs >= nodes[nodes.length - 1].ts;

  return (
    <Card className={cn("rounded-2xl border-foreground/[0.06]", allPast && "border-emerald-500/10")}>
      <CardContent className="px-5 py-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[14px] font-semibold text-foreground">{title ?? "Vesting Schedule"}</p>
            {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground/60">{subtitle}</p>}
          </div>
          {allPast && (
            <Badge variant="outline" className="h-auto rounded-full border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              Completed
            </Badge>
          )}
        </div>
        <div className="relative flex items-start gap-0">
          {nodes.map((node, i) => {
            const isPast = nowTs >= node.ts;
            const isCurrent = isPast && (i === nodes.length - 1 || nowTs < nodes[i + 1]?.ts);
            const isLast = i === nodes.length - 1;
            return (
              <div key={node.label + i} className="flex flex-1 flex-col items-center">
                <div className="relative flex w-full items-center">
                  {i > 0 && (
                    <div className={cn("h-[2px] flex-1 transition-colors", isPast ? "bg-violet-500/50" : "bg-foreground/[0.06]")} />
                  )}
                  <div className={cn(
                    "relative z-10 flex shrink-0 rounded-full transition-all",
                    isCurrent ? "h-4 w-4 border-[3px] border-violet-500 bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.3)]" :
                    isPast
                      ? node.highlight ? "h-3.5 w-3.5 border-2 border-violet-500 bg-violet-500" : "h-3.5 w-3.5 border-2 border-violet-500/50 bg-violet-500/20"
                      : "h-3.5 w-3.5 border-2 border-foreground/15 bg-background",
                  )} />
                  {!isLast && (
                    <div className={cn("h-[2px] flex-1 transition-colors", nowTs >= nodes[i + 1]?.ts ? "bg-violet-500/50" : "bg-foreground/[0.06]")} />
                  )}
                </div>
                <div className="mt-2.5 px-1 text-center">
                  <p className={cn("text-[11px] font-semibold", isCurrent ? "text-violet-600 dark:text-violet-400" : isPast ? "text-foreground" : "text-muted-foreground/70")}>{node.label}</p>
                  <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground/60">{formatDate(node.ts)}</p>
                  {node.sub && <p className="text-[9px] text-muted-foreground/50">{node.sub}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── BeneficiariesSection ────────────────────────────────────────────── */
function BeneficiariesSection({
  isSingleLeaf,
  expectedBeneficiary,
  campaignRecipients,
  leafCount,
  viewer,
  onViewAll,
}: {
  isSingleLeaf: boolean;
  expectedBeneficiary: string | null | undefined;
  campaignRecipients: Array<{ beneficiary: string; allocation: string; leafCount: number; claimedAmount: string }>;
  leafCount: number;
  viewer?: string;
  onViewAll: () => void;
}) {
  if (isSingleLeaf && expectedBeneficiary) {
    return (
      <Card className="rounded-2xl border-foreground/[0.06]">
        <CardContent className="flex items-center gap-4 px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-400">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">Beneficiary</p>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="mt-0.5 cursor-default truncate font-mono text-[13px] text-foreground">
                  {expectedBeneficiary}
                </p>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="font-mono text-[11px]">{expectedBeneficiary}</p></TooltipContent>
            </Tooltip>
          </div>
          {viewer === expectedBeneficiary && (
            <Badge variant="outline" className="h-auto shrink-0 rounded-full border-violet-500/20 bg-violet-500/10 px-2.5 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">
              You
            </Badge>
          )}
        </CardContent>
      </Card>
    );
  }

  if (!isSingleLeaf) {
    const preview = campaignRecipients.slice(0, 5);
    return (
      <Card className="rounded-2xl border-foreground/[0.06]">
        <CardContent className="px-5 py-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <p className="text-[14px] font-semibold text-foreground">Recipients</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/60">{leafCount} wallet{leafCount !== 1 ? "s" : ""} in this campaign</p>
            </div>
            <button
              type="button"
              onClick={onViewAll}
              className="shrink-0 rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] px-3 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-foreground/[0.05] hover:border-foreground/[0.12]"
            >
              View All
            </button>
          </div>
          <div className="space-y-0.5">
            {preview.map((r) => {
              const isViewer = viewer === r.beneficiary;
              const claimed = BigInt(r.claimedAmount);
              const alloc = BigInt(r.allocation);
              const isFullyClaimed = alloc > 0n && claimed >= alloc;
              return (
                <div key={r.beneficiary} className={cn("flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-foreground/[0.03]", isViewer && "bg-violet-500/[0.04]")}>
                  <span className="font-mono text-[12px] text-foreground/80 truncate flex-1">{truncateAddress(r.beneficiary)}</span>
                  {isFullyClaimed ? (
                    <span className="shrink-0 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">Claimed</span>
                  ) : claimed > 0n ? (
                    <span className="shrink-0 text-[10px] font-medium text-amber-600 dark:text-amber-400">Partial</span>
                  ) : (
                    <span className="shrink-0 text-[10px] text-muted-foreground/50">Pending</span>
                  )}
                  {isViewer && (
                    <Badge variant="outline" className="h-auto rounded-full border-violet-500/20 bg-violet-500/10 px-1.5 py-0 text-[10px] text-violet-700 dark:text-violet-300">
                      You
                    </Badge>
                  )}
                </div>
              );
            })}
            {campaignRecipients.length > 5 && (
              <p className="px-3 pt-1 text-[11px] text-muted-foreground/60">+{campaignRecipients.length - 5} more</p>
            )}
            {campaignRecipients.length === 0 && (
              <div className="flex flex-col items-center py-6 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground/[0.04] text-muted-foreground/40">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                  </svg>
                </div>
                <p className="mt-2 text-[12px] text-muted-foreground/60">No recipients indexed yet</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}

/* ─── RootVersionSection ──────────────────────────────────────────────── */
function RootVersionSection({
  currentRootHex,
  rootVersions,
  leafCount,
  treeAddress,
  canRotate,
}: {
  currentRootHex: string | null;
  rootVersions: Array<{ id: number; version: number; merkleRoot: string; leafCount: number; createdAt: number; ipfsCid: string | null }>;
  leafCount: number;
  treeAddress: string;
  canRotate: boolean;
}) {
  if (!canRotate && rootVersions.length === 0) return null;

  const current = rootVersions[0];

  return (
    <Card className="rounded-2xl border-foreground/[0.06]">
      <CardContent className="px-5 py-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <p className="text-[14px] font-semibold text-foreground">Distribution</p>
            {currentRootHex && (
              <Badge variant="outline" className="h-auto rounded-full border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="mr-1"><path d="M20 6 9 17l-5-5"/></svg>
                Verified
              </Badge>
            )}
          </div>
          {canRotate && (
            <a
              href={`/campaign/${treeAddress}/allocations`}
              className="rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] px-3 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-foreground/[0.05] hover:border-foreground/[0.12]"
            >
              Edit Allocations
            </a>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-foreground/[0.04] pt-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/50">Merkle Root</p>
              {current && (
                <span className="text-[10px] tabular-nums text-muted-foreground/40">v{current.version}</span>
              )}
              {rootVersions.length > 1 && (
                <span className="text-[10px] text-muted-foreground/40">· {rootVersions.length - 1} prev</span>
              )}
            </div>
            <p className="font-mono text-[12px] text-foreground/60 truncate">
              {currentRootHex ? `${currentRootHex.slice(0, 16)}…${currentRootHex.slice(-8)}` : "—"}
            </p>
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/50">{leafCount} leaves</span>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── AdvancedDetailsPanel ────────────────────────────────────────────── */
function AdvancedDetailsPanel({
  treeAddress,
  creator,
  mintLabel,
  mintIsMono,
  campaignId,
  createdAt,
  isSingleLeaf,
  scheduleLocked,
  showManualSchedule,
  onShowManual,
  onHideManual,
  releaseType,
  setReleaseType,
  startTime,
  setStartTime,
  cliffTime,
  setCliffTime,
  endTime,
  setEndTime,
  milestoneIdx,
  setMilestoneIdx,
  isCliff,
  isMilestone,
  showReadOnlySchedule,
  proofQueryLoading,
}: {
  treeAddress: string;
  creator: string;
  mintLabel: string;
  mintIsMono: boolean;
  campaignId: string;
  createdAt: string;
  isSingleLeaf: boolean;
  scheduleLocked: boolean;
  showManualSchedule: boolean;
  onShowManual: () => void;
  onHideManual: () => void;
  releaseType: number;
  setReleaseType: (v: number) => void;
  startTime: string;
  setStartTime: (v: string) => void;
  cliffTime: string;
  setCliffTime: (v: string) => void;
  endTime: string;
  setEndTime: (v: string) => void;
  milestoneIdx: string;
  setMilestoneIdx: (v: string) => void;
  isCliff: boolean;
  isMilestone: boolean;
  showReadOnlySchedule: boolean;
  proofQueryLoading: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="rounded-2xl border-foreground/[0.06]">
      <CardContent className="px-5 py-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-3"
        >
          <p className="text-[13px] font-medium text-muted-foreground">Advanced Details</p>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {open && (
          <div className="mt-4 divide-y divide-foreground/[0.05]">

            {/* ── Identifiers ─────────────────────────────── */}
            <div className="pb-4">
              <p className="mb-2.5 text-[10px] uppercase tracking-[0.13em] text-muted-foreground/40">Identifiers</p>
              <div className="space-y-2">
                <DetailRow label="Campaign ID" value={campaignId} />
                <DetailRow label="Tree Address" value={treeAddress} mono />
                <DetailRow label="Created" value={createdAt} />
              </div>
            </div>

            {/* ── Participants ─────────────────────────────── */}
            <div className="py-4">
              <p className="mb-2.5 text-[10px] uppercase tracking-[0.13em] text-muted-foreground/40">Participants</p>
              <div className="space-y-2">
                <DetailRow label="Creator" value={creator} mono />
                <DetailRow label="Mint" value={mintLabel} mono={mintIsMono} />
              </div>
            </div>

            {/* ── Schedule (single leaf only) ──────────────── */}
            {isSingleLeaf && (
              <div className="pt-4">
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <p className="text-[10px] uppercase tracking-[0.13em] text-muted-foreground/40">On-chain Schedule</p>
                  {scheduleLocked && !showManualSchedule && (
                    <button type="button" onClick={onShowManual} className="text-[11px] text-muted-foreground underline underline-offset-4 hover:text-foreground">
                      Edit manually
                    </button>
                  )}
                  {showManualSchedule && (
                    <button type="button" onClick={onHideManual} className="text-[11px] text-muted-foreground underline underline-offset-4 hover:text-foreground">
                      Back
                    </button>
                  )}
                </div>

                {proofQueryLoading && (
                  <p className="text-[12px] text-muted-foreground/60">Loading schedule…</p>
                )}

                {!showReadOnlySchedule && (
                  <div className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
                    These values are only used locally to reconstruct a claim — they don&apos;t change on-chain state.
                  </div>
                )}

                {showReadOnlySchedule ? (
                  <div className="space-y-2">
                    <DetailRow label="Vesting Type" value={getVestingTypeLabel(releaseType)} />
                    <DetailRow label="Start Time" value={startTime ? formatDate(datetimeLocalToUnix(startTime)) : "—"} />
                    <DetailRow label={isMilestone ? "Unlock Time" : isCliff ? "Unlock Time" : "Cliff Time"} value={cliffTime ? formatDate(datetimeLocalToUnix(cliffTime)) : "—"} />
                    <DetailRow label="End Time" value={endTime ? formatDate(datetimeLocalToUnix(endTime)) : "—"} />
                    {isMilestone && <DetailRow label="Milestone Index" value={milestoneIdx} />}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <FieldRow
                      label="Vesting Type"
                      input={(
                        <Select value={String(releaseType)} onValueChange={(v) => setReleaseType(Number(v))} disabled={scheduleLocked}>
                          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">Cliff</SelectItem>
                            <SelectItem value="1">Linear</SelectItem>
                            <SelectItem value="2">Milestone</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <div className="grid gap-3 md:grid-cols-3">
                      <FieldRow label="Start Time" input={(
                        <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={scheduleLocked}
                          className="w-full rounded-xl border border-foreground/[0.08] bg-muted px-3 py-2.5 text-[13px] text-foreground outline-none transition focus:border-foreground/20 disabled:opacity-50" />
                      )} />
                      <FieldRow label={isMilestone ? "Unlock Time" : isCliff ? "Unlock Time" : "Cliff Time"} input={(
                        <input type="datetime-local" value={cliffTime} onChange={(e) => setCliffTime(e.target.value)} disabled={scheduleLocked}
                          className="w-full rounded-xl border border-foreground/[0.08] bg-muted px-3 py-2.5 text-[13px] text-foreground outline-none transition focus:border-foreground/20 disabled:opacity-50" />
                      )} />
                      <FieldRow label="End Time" input={(
                        <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={scheduleLocked}
                          className="w-full rounded-xl border border-foreground/[0.08] bg-muted px-3 py-2.5 text-[13px] text-foreground outline-none transition focus:border-foreground/20 disabled:opacity-50" />
                      )} />
                    </div>
                    {isMilestone && (
                      <FieldRow label="Milestone Index" input={(
                        <input type="number" min="0" max="255" value={milestoneIdx} onChange={(e) => setMilestoneIdx(e.target.value)} disabled={scheduleLocked}
                          className="w-full rounded-xl border border-foreground/[0.08] bg-muted px-3 py-2.5 text-[13px] text-foreground outline-none transition focus:border-foreground/20 disabled:opacity-50" />
                      )} />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
