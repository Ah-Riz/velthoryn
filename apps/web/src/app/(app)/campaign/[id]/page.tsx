"use client";

import { useEffect, useState, useCallback, use, useMemo } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { useVestingProgram } from "@/hooks/useVestingProgram";
import { useProofLookup } from "@/hooks/useProofLookup";
import { useClaimRecord } from "@/hooks/useClaimRecord";
import { useCampaignDetail } from "@/hooks/useCampaignDetail";
import { derivePda } from "@/lib/anchor/client";
import { formatVestingError } from "@/lib/anchor/errors";
import { unixToDatetimeLocal, datetimeLocalToUnix } from "@/lib/stream/datetime";
import { loadStreamScheduleLocal } from "@/lib/stream/persist";
import { CancelConfirmDialog } from "@/components/campaign/detail/CancelConfirmDialog";
import { MilestoneStatusBadge } from "@/components/campaign/detail/MilestoneStatusBadge";
import { PauseToggleButton } from "@/components/campaign/detail/PauseToggleButton";
import { TriggerMilestoneButton } from "@/components/campaign/detail/TriggerMilestoneButton";
import { MilestoneReleasePanel } from "@/components/campaign/detail/MilestoneReleasePanel";
import { CloseClaimRecordButton } from "@/components/campaign/detail/CloseClaimRecordButton";
import { WithdrawUnvestedButton } from "@/components/campaign/detail/WithdrawUnvestedButton";
import { ClaimWithProofButton } from "@/components/campaign/detail/ClaimWithProofButton";
import { RootRotationCard } from "@/components/campaign/detail/RootRotationCard";
import { VestingChart } from "@/components/campaign/detail/VestingChart";
import { useToast } from "@/components/shell/Toast";
import {
  getVestingTypeLabel,
  getVestingTypeBadgeColor,
  formatCountdown,
  getWithdrawDisabledReason,
} from "@/lib/vesting/display";
import { isMilestoneTriggered } from "@/lib/vesting/milestone";
import {
  canCancelCampaign,
  canCancelStream,
  canPauseCampaign,
  canReleaseMilestone,
  canRotateRoot,
  canWithdrawUnvested,
} from "@/lib/campaign/authority";

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
  bump: number;
};

type ScheduleSource = "none" | "api" | "local" | "url" | "manual";
type MilestoneUiMeta = {
  name: string | null;
  owner: string | null;
  mode: string | null;
  evidence: string | null;
};
type UrlScheduleLoadResult = {
  loaded: boolean;
  beneficiary: string | null;
  milestoneUi: MilestoneUiMeta;
};

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
      return effectiveNow >= cliffTs ? amount : 0n;
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

/* ------------------------------------------------------------------ */
/*  Page component                                                    */
/* ------------------------------------------------------------------ */

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: treeAddress } = use(params);
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const program = useVestingProgram();
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

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [manualBeneficiary, setManualBeneficiary] = useState("");
  const treeMint = treeState?.mint;

  const isSingleLeaf = treeState?.leafCount === 1;
  const beneficiaryKey = publicKey?.toBase58();
  const localSchedule = useMemo(
    () => loadStreamScheduleLocal(treeAddress),
    [treeAddress],
  );
  const proofBeneficiary = useMemo(() => {
    if (!beneficiaryKey) return undefined;
    if (isSingleLeaf) {
      if (localSchedule?.beneficiary && localSchedule.beneficiary !== beneficiaryKey) {
        return undefined;
      }
    }
    return beneficiaryKey;
  }, [beneficiaryKey, isSingleLeaf, localSchedule]);
  const proofQuery = useProofLookup(
    treeAddress,
    proofBeneficiary,
  );
  const campaignDetailQuery = useCampaignDetail(treeAddress);

  const claimRecordQuery = useClaimRecord(treeAddress, beneficiaryKey);

  const scheduleLocked =
    isSingleLeaf &&
    (scheduleSource === "api" || scheduleSource === "local" || scheduleSource === "url") &&
    !showManualSchedule;

  /* ---- Fetch on-chain tree state ---- */

  const fetchTree = useCallback(async () => {
    if (!program) return;
    setLoading(true);
    try {
      const treePubkey = new PublicKey(treeAddress);
      const account = await (program.account as any).vestingTree.fetch(treePubkey);
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
        bump: account.bump,
      });
      setError(null);
      // Invalidate campaign list caches so My Campaigns page shows updated status
      void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      void queryClient.invalidateQueries({ queryKey: ["beneficiaryCampaigns"] });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch campaign");
    } finally {
      setLoading(false);
    }
  }, [program, treeAddress, queryClient]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // Real-time: subscribe to on-chain account changes for auto-refresh
  useEffect(() => {
    if (!treeAddress) return;
    let subId: number | undefined;
    try {
      const treePubkey = new PublicKey(treeAddress);
      subId = connection.onAccountChange(treePubkey, () => {
        fetchTree();
      }, "confirmed");
    } catch { /* invalid address, skip */ }
    return () => {
      if (subId !== undefined) connection.removeAccountChangeListener(subId);
    };
  }, [treeAddress, connection, fetchTree]);

  useEffect(() => {
    if (!treeMint) return;
    connection.getParsedAccountInfo(treeMint).then((info) => {
      const parsed = (info.value?.data as any)?.parsed;
      if (parsed?.type === "mint") {
        setMintDecimals(parsed.info.decimals);
      }
    }).catch(() => {});
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
        { setReleaseType, setStartTime, setCliffTime, setEndTime, setMilestoneIdx },
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

  const nowTs = BigInt(Math.floor(Date.now() / 1000));
  const totalSupply = treeState ? BigInt(treeState.totalSupply.toString()) : 0n;
  const totalClaimed = treeState ? BigInt(treeState.totalClaimed.toString()) : 0n;
  const cancelledAtBigint = treeState?.cancelledAt
    ? BigInt(treeState.cancelledAt.toString())
    : null;

  const cliffTsBigint = cliffTime ? BigInt(datetimeLocalToUnix(cliffTime)) : 0n;
  const endTsBigint = endTime ? BigInt(datetimeLocalToUnix(endTime)) : 0n;

  const vested = cliffTime && endTime
    ? vestedAmount(totalSupply, releaseType, cliffTsBigint, endTsBigint, cancelledAtBigint, nowTs)
    : 0n;
  const claimable = vested > totalClaimed ? vested - totalClaimed : 0n;
  const progress = progressPercent(vested, totalSupply);

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
  const canShowWithdrawUnvested = canWithdrawUnvested({
    viewer: publicKey,
    creator: treeState?.creator,
    cancelledAt: cancelledAtBigint,
  });
  const canShowRootRotation = canRotateRoot({
    viewer: publicKey,
    cancelAuthority: treeState?.cancelAuthority,
    cancellable: treeState?.cancellable ?? false,
    cancelledAt: cancelledAtBigint,
    leafCount: treeState?.leafCount ?? 0,
  });
  const canShowReleaseMilestone = canReleaseMilestone({
    viewer: publicKey,
    creator: treeState?.creator,
    cancelledAt: cancelledAtBigint,
    releaseType,
  });
  const isCliff = releaseType === 0;
  const isLinear = releaseType === 1;
  const isMilestone = releaseType === 2;
  const beneficiaryMismatch =
    !!publicKey && !!expectedBeneficiary && publicKey.toBase58() !== expectedBeneficiary;
  const isMultiRecipient = (treeState?.leafCount ?? 0) > 1;
  const milestoneBitmap = claimRecordQuery.data?.milestoneBitmap
    ? new Uint8Array(claimRecordQuery.data.milestoneBitmap)
    : new Uint8Array(32);
  const milestoneTriggered = isMilestoneTriggered(milestoneBitmap, Number(milestoneIdx));
  const milestoneReleased = isMilestoneTriggered(
    treeState?.milestoneReleasedFlags ?? new Uint8Array(32),
    Number(milestoneIdx),
  );
  const milestoneLifecycleLabel = milestoneTriggered
    ? "Claimed"
    : nowTs >= cliffTsBigint
      ? "Ready To Claim"
      : "Awaiting Unlock";
  const milestoneModeLabel = milestoneUi.mode
    ? ({
      manual_review: "Manual Review",
      ops_signoff: "Ops Signoff",
      dao_vote: "DAO Vote",
    } as const)[milestoneUi.mode as "manual_review" | "ops_signoff" | "dao_vote"] ?? milestoneUi.mode
    : "Time-gated milestone";

  const withdrawDisabledReason = beneficiaryMismatch && isSingleLeaf
    ? `Only beneficiary ${truncateAddress(expectedBeneficiary)} can claim`
    : getWithdrawDisabledReason({
    loading: txStatus.type === "loading",
    paused: treeState?.paused ?? false,
    claimable,
    cancelledAt: cancelledAtBigint,
    releaseType,
    nowTs,
    cliffTs: cliffTsBigint,
    milestoneIdx: Number(milestoneIdx),
    milestoneBitmap,
  });
  const claimableLabel =
    isSingleLeaf && beneficiaryMismatch ? "Beneficiary Claimable" : "Claimable";
  const scheduleSummary =
    isCliff
      ? "Full release at a single time."
      : isLinear
        ? "Gradual release from cliff to end."
        : "Single indexed release with milestone context.";
  const claimActionLabel = beneficiaryMismatch && expectedBeneficiary
    ? `Only ${truncateAddress(expectedBeneficiary)} can claim`
    : withdrawDisabledReason ?? `Claim ${formatTokenAmount(claimable)}`;
  const currentMerkleRootHex = treeState ? Buffer.from(treeState.merkleRoot).toString("hex") : "";
  const rootVersions = campaignDetailQuery.data?.rootVersions ?? [];
  const scheduleSectionTitle = isSingleLeaf
    ? scheduleLocked
      ? "Claim Parameters"
      : "Manual Claim Parameters"
    : "Schedule Reference";
  const scheduleSectionCaption = isSingleLeaf
    ? scheduleLocked
      ? "Loaded from indexed or local schedule data. Switch to manual parameters only if you need to reconstruct a single-stream claim. This does not update the campaign on-chain."
      : "These manual parameters only affect local claim preview and single-stream withdraw submission. They do not update the campaign on-chain."
    : "Reference parameters for the campaign schedule. Proof-backed claims still use indexed leaf data rather than edits in this panel.";

  /* ---- Status helpers ---- */

  const statusLabel = treeState?.paused
    ? "Paused"
    : treeState?.cancelledAt
      ? "Cancelled"
      : totalSupply > 0n && totalClaimed >= totalSupply
        ? "Claimed"
        : "Active";

  const statusBadgeClass = treeState?.paused
    ? "border-amber-500/20 bg-amber-500/10 text-amber-400"
    : treeState?.cancelledAt
      ? "border-red-500/20 bg-red-500/10 text-red-400"
      : totalSupply > 0n && totalClaimed >= totalSupply
        ? "border-sky-500/20 bg-sky-500/10 text-sky-400"
        : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400";

  /* ---- Cancel handler ---- */

  async function handleCancel() {
    if (!program || !publicKey || !treeState) return;
    setCancelLoading(true);
    try {
      const treePubkey = new PublicKey(treeAddress);

      const sig = await program.methods
        .cancelCampaign()
        .accounts({
          cancelAuthority: publicKey,
          vestingTree: treePubkey,
        })
        .rpc();

      setTxStatus({ type: "success", sig });
      setCancelOpen(false);
      toast("Stream cancelled successfully.", "success");
      fetchTree();
      void campaignDetailQuery.refetch();

      const cancelTs = Math.floor(Date.now() / 1000);
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
    try {
      const treePubkey = new PublicKey(treeAddress);
      const beneficiary = new PublicKey(resolvedBeneficiary);
      const [claimRecord] = derivePda(["claim", treePubkey.toBuffer(), beneficiary.toBuffer()]);
      const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
      const beneficiaryAta = getAssociatedTokenAddressSync(treeState.mint, beneficiary);
      const creatorAta = getAssociatedTokenAddressSync(treeState.mint, publicKey);

      const startTs = startTime ? new BN(datetimeLocalToUnix(startTime)) : new BN(0);

      await program.methods
        .cancelStream({
          releaseType,
          startTime: startTs,
          cliffTime: new BN(datetimeLocalToUnix(cliffTime)),
          endTime: new BN(datetimeLocalToUnix(endTime)),
          milestoneIdx: Number(milestoneIdx),
        })
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
        .rpc();

      toast("Stream cancelled and settled.", "success");
      setCancelOpen(false);
      setTxStatus({ type: "success", sig: "" });
      fetchTree();
      void campaignDetailQuery.refetch();

      const cancelTs = Math.floor(Date.now() / 1000);
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
        body: JSON.stringify({ cancelledAt: cancelTs }),
      }).catch(() => {});
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

    try {
      const treePubkey = new PublicKey(treeAddress);
      const [vaultAuthority] = derivePda(["vault_authority", treePubkey.toBuffer()]);
      const [claimRecord] = derivePda([
        "claim",
        treePubkey.toBuffer(),
        publicKey.toBuffer(),
      ]);

      const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
      const beneficiaryAta = getAssociatedTokenAddressSync(treeState.mint, publicKey);

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

      const sig = await program.methods
        .withdraw({
          releaseType,
          startTime: startTs,
          cliffTime: cliffTs,
          endTime: endTs,
          milestoneIdx: Number(milestoneIdx),
        })
        .accounts({
          beneficiary: publicKey,
          vestingTree: treePubkey,
          claimRecord,
          vaultAuthority,
          vault: treeState.vault,
          beneficiaryAta,
          mint: treeState.mint,
        })
        .rpc();

      setTxStatus({ type: "success", sig });
      toast(`Claimed ${formatTokenAmount(claimable)} tokens successfully!`, "success");
      fetchTree();
      void campaignDetailQuery.refetch();
      void fetch("/api/claims/sync", {
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

      const newClaimed = (totalClaimed + claimable).toString();
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
      <div className="mx-auto max-w-5xl flex flex-col items-center justify-center py-32 space-y-4">
        <Spinner />
        <p className="text-[13px] text-[#555d73]">Loading campaign...</p>
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
      <div className="rounded-2xl border border-white/[0.08] bg-[#0d1117] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-[24px] font-semibold text-white">Vesting Stream</h1>
            <p className="mt-2 max-w-3xl text-[14px] text-[#8b92a5]">
              Review the stream status, schedule, and claim actions.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-[12px] font-medium ${statusBadgeClass}`}
            >
              {statusLabel}
            </span>
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-[12px] font-medium ${getVestingTypeBadgeColor(releaseType)}`}
            >
              {getVestingTypeLabel(releaseType)}
            </span>
            {isCliff && cliffTime && nowTs < cliffTsBigint && (
              <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[12px] font-medium text-amber-400">
                Unlocks in {formatCountdown(cliffTsBigint, nowTs)}
              </span>
            )}
            {isMilestone && (
              <span
                className={`inline-flex items-center rounded-full border px-3 py-1 text-[12px] font-medium ${
                  milestoneTriggered
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                    : "border-white/[0.08] bg-white/[0.02] text-[#8b92a5]"
                }`}
              >
                {milestoneLifecycleLabel}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <MetricCard label="Total Supply" value={formatTokenAmount(totalSupply)} />
            <MetricCard label="Total Claimed" value={formatTokenAmount(totalClaimed)} />
            <MetricCard label="Vested" value={isMilestone ? milestoneLifecycleLabel : `${progress}%`} />
            <MetricCard label={claimableLabel} value={formatTokenAmount(claimable)} accent />
          </div>

          {!isMilestone && cliffTime && endTime && (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
              <SectionHeader
                title="Progress"
                caption={scheduleSummary}
              />
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-[12px] text-[#8b92a5]">
                  <span>Vested</span>
                  <span className="font-medium text-white">{progress}%</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.05]">
                  <div
                    className="h-full rounded-full bg-white transition-all duration-500"
                    style={{ width: `${Math.min(progress, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Vesting Curve Chart */}
          {cliffTime && endTime && (
            <VestingChart
              releaseType={releaseType}
              startTs={datetimeLocalToUnix(startTime || cliffTime)}
              cliffTs={datetimeLocalToUnix(cliffTime)}
              endTs={datetimeLocalToUnix(endTime)}
              totalAmount={totalSupply}
              vestedAmount={vested}
              cancelledAt={cancelledAtBigint ? Number(cancelledAtBigint) : null}
              milestoneCount={isMilestone ? (treeState?.leafCount ?? 1) : undefined}
            />
          )}

          {isMilestone && (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
              <SectionHeader
                title={milestoneUi.name ?? `Milestone #${milestoneIdx}`}
                caption="Milestone release details."
              />
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Milestone Index" value={`#${milestoneIdx}`} />
                <MetricCard label="Trigger Style" value={milestoneModeLabel} />
                <MetricCard label="Unlock" value={nowTs >= cliffTsBigint ? "Reached" : "Pending"} />
                <MetricCard label="Claim State" value={milestoneTriggered ? "Claimed" : "Open"} accent />
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <WorkflowStep
                  step="Evidence"
                  title={milestoneUi.evidence ? "Recorded" : "Not provided"}
                  body={milestoneUi.evidence ?? "No milestone notes were attached to this stream."}
                />
                <WorkflowStep
                  step="Approval"
                  title={milestoneUi.owner ?? "Not specified"}
                  body={milestoneUi.owner ?? "No approval owner was attached to this stream."}
                />
                <WorkflowStep
                  step="Claim"
                  title={
                    milestoneTriggered
                      ? "Completed"
                      : nowTs >= cliffTsBigint
                        ? "Available now"
                        : `Opens in ${formatCountdown(cliffTsBigint, nowTs)}`
                  }
                  body={
                    nowTs >= cliffTsBigint
                      ? "The beneficiary can submit the claim."
                      : "Claim becomes available at the configured unlock time."
                  }
                />
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
            <SectionHeader
              title="Details"
              caption="Core stream information."
            />
            <div className="mt-5 grid gap-3">
              <DetailRow label="Tree Address" value={treeAddress} mono />
              <DetailRow label="Creator" value={treeState.creator.toBase58()} mono />
              <DetailRow label="Mint" value={treeState.mint.toBase58()} mono />
              {expectedBeneficiary && (
                <DetailRow label="Beneficiary" value={expectedBeneficiary} mono />
              )}
              <DetailRow label="Campaign ID" value={treeState.campaignId.toString()} />
              <DetailRow label="Created" value={formatDate(treeState.createdAt.toNumber())} />
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
            <div className="flex items-start justify-between gap-4">
              <SectionHeader
                title={scheduleSectionTitle}
                caption={scheduleSectionCaption}
              />
              {isSingleLeaf && scheduleLocked && (
                <button
                  type="button"
                  onClick={() => setShowManualSchedule(true)}
                  className="text-[12px] font-medium text-white underline underline-offset-4"
                >
                  Use Manual Parameters
                </button>
              )}
            </div>

            {proofQuery.isLoading && isSingleLeaf && (
              <p className="mt-4 text-[12px] text-[#8b92a5]">Loading schedule...</p>
            )}

            {((isSingleLeaf && !scheduleLocked) || !isSingleLeaf) && (
              <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[12px] leading-6 text-amber-200">
                Editing these values does not mutate the campaign on-chain. They are only used for local claim
                preview and, for single-stream claims, to reconstruct the withdraw parameters.
              </div>
            )}

            <div className="mt-5 space-y-4">
              <FieldRow
                label="Vesting Type"
                input={(
                  <select
                    value={releaseType}
                    onChange={(e) => setReleaseType(Number(e.target.value))}
                    disabled={scheduleLocked}
                    className="w-full rounded-xl border border-white/[0.08] bg-[#11161f] px-4 py-3 text-[13px] text-white outline-none transition focus:border-white/20 disabled:opacity-50"
                  >
                    <option value={0}>Cliff</option>
                    <option value={1}>Linear</option>
                    <option value={2}>Milestone</option>
                  </select>
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
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 lg:sticky lg:top-6">
            <SectionHeader
              title="Actions"
              caption="Claim and manage this stream."
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
              {isMultiRecipient && program ? (
                <ClaimWithProofButton
                  program={program}
                  publicKey={publicKey}
                  treePubkey={new PublicKey(treeAddress)}
                  treeAddress={treeAddress}
                  mint={treeState.mint}
                  vault={treeState.vault}
                  vaultAuthority={treeState.vaultAuthority}
                  mintDecimals={mintDecimals}
                  onSuccess={fetchTree}
                  toast={toast}
                />
              ) : (
                <button
                  onClick={handleWithdraw}
                  disabled={!!withdrawDisabledReason}
                  className="w-full rounded-xl bg-white px-4 py-3 text-[14px] font-semibold text-[#0d1117] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {txStatus.type === "loading" ? "Claiming..." : claimActionLabel}
                </button>
              )}

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
                  onSuccess={fetchTree}
                  toast={toast}
                />
              )}

              {program && (
                <MilestoneReleasePanel
                  program={program}
                  publicKey={publicKey}
                  treePubkey={new PublicKey(treeAddress)}
                  milestoneReleasedFlags={treeState.milestoneReleasedFlags}
                  leafCount={treeState.leafCount}
                  canRelease={canShowReleaseMilestone}
                  onSuccess={fetchTree}
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
                    fetchTree();
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

              {canShowCancel && (
                <button
                  onClick={() => setCancelOpen(true)}
                  className="w-full rounded-xl border border-red-500/20 px-4 py-3 text-[13px] font-medium text-red-400 transition hover:border-red-500/40 hover:bg-red-500/5"
                >
                  Cancel Stream
                </button>
              )}

              {program && (
                <WithdrawUnvestedButton
                  program={program}
                  publicKey={publicKey}
                  treePubkey={new PublicKey(treeAddress)}
                  mint={treeState.mint}
                  vaultAuthority={treeState.vaultAuthority}
                  vault={treeState.vault}
                  cancelledAt={cancelledAtBigint}
                  isCreator={canShowWithdrawUnvested}
                  nowTs={nowTs}
                  onSuccess={fetchTree}
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
                  onSuccess={fetchTree}
                  toast={toast}
                />
              )}

              {program && (
                <RootRotationCard
                  treeAddress={treeAddress}
                  canRotate={canShowRootRotation}
                  currentMerkleRoot={currentMerkleRootHex}
                  currentLeafCount={treeState.leafCount}
                  rootVersions={rootVersions}
                  onSuccess={() => {
                    fetchTree();
                    void campaignDetailQuery.refetch();
                  }}
                  toast={toast}
                />
              )}
            </div>

            {txStatus.type === "success" && (
              <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <p className="text-[12px] font-medium text-emerald-400">Transaction submitted.</p>
                <p className="mt-2 break-all font-mono text-[11px] text-[#8b92a5]">{txStatus.sig}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cancel confirmation dialog */}
      <CancelConfirmDialog
        isOpen={cancelOpen}
        onConfirm={handleCancel}
        onConfirmStream={handleCancelStream}
        onClose={() => setCancelOpen(false)}
        isLoading={cancelLoading}
        isStreamLoading={cancelLoading}
        isSingleStream={isSingleLeaf && canCancelStream({
          viewer: publicKey,
          creator: treeState?.creator,
          cancellable: treeState?.cancellable ?? false,
          cancelledAt: cancelledAtBigint,
          totalSupply,
          totalClaimed,
          leafCount: treeState?.leafCount ?? 0,
        })}
        scheduleLoaded={scheduleSource !== "none" && !!cliffTime && !!endTime}
        beneficiaryUnknown={!expectedBeneficiary}
        manualBeneficiary={manualBeneficiary}
        onManualBeneficiaryChange={setManualBeneficiary}
        totalSupply={totalSupply}
        totalClaimed={totalClaimed}
        vestedAmount={vested}
        mintDecimals={mintDecimals}
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
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <p className="text-[11px] uppercase tracking-[0.12em] text-[#555d73]">{label}</p>
      <p
        className={`mt-2 text-2xl font-semibold ${
          accent ? "text-violet-400" : "text-white"
        }`}
      >
        {value}
      </p>
    </div>
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
      <span className="shrink-0 text-[12px] text-[#555d73]">{label}</span>
      <span
        className={`text-right text-[13px] text-white ${mono ? "font-mono" : ""}`}
        title={value}
      >
        {mono ? truncateAddress(value) : value}
      </span>
    </div>
  );
}

function WorkflowStep({
  step,
  title,
  body,
}: {
  step: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-4">
      <p className="text-[10px] uppercase tracking-[0.16em] text-[#7e8fb1]">{step}</p>
      <p className="mt-2 text-[15px] font-semibold text-white">{title}</p>
      <p className="mt-2 text-[12px] leading-6 text-[#aabbe0]">{body}</p>
    </div>
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
