"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { useVestingProgram } from "@/hooks/useVestingProgram";
import { useProofLookup } from "@/hooks/useProofLookup";
import { useClaimRecord } from "@/hooks/useClaimRecord";
import { derivePda } from "@/lib/anchor/client";
import { formatVestingError } from "@/lib/anchor/errors";
import { unixToDatetimeLocal, datetimeLocalToUnix } from "@/lib/stream/datetime";
import { loadStreamScheduleLocal } from "@/lib/stream/persist";
import { CancelConfirmDialog } from "@/components/campaign/CancelConfirmDialog";
import { MilestoneStatusBadge } from "@/components/campaign/TriggerMilestoneButton";
import { PauseToggleButton } from "@/components/campaign/PauseToggleButton";
import { WithdrawUnvestedButton } from "@/components/campaign/WithdrawUnvestedButton";
import { ClaimWithProofButton } from "@/components/campaign/ClaimWithProofButton";
import { useToast } from "@/components/shell/Toast";
import {
  getVestingTypeLabel,
  getVestingTypeBadgeColor,
  formatCountdown,
  getWithdrawDisabledReason,
} from "@/lib/vesting/display";
import { isMilestoneTriggered } from "@/lib/vesting/milestone";

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
  bump: number;
};

type ScheduleSource = "none" | "api" | "local" | "manual";

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
  },
) {
  setters.setReleaseType(leaf.releaseType);
  setters.setStartTime(unixToDatetimeLocal(leaf.startTime));
  setters.setCliffTime(unixToDatetimeLocal(leaf.cliffTime));
  setters.setEndTime(unixToDatetimeLocal(leaf.endTime));
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

  const [treeState, setTreeState] = useState<TreeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mintDecimals, setMintDecimals] = useState<number | null>(null);

  const [releaseType, setReleaseType] = useState(1);
  const [startTime, setStartTime] = useState("");
  const [cliffTime, setCliffTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [milestoneIdx, setMilestoneIdx] = useState("0");
  const [scheduleSource, setScheduleSource] = useState<ScheduleSource>("none");
  const [showManualSchedule, setShowManualSchedule] = useState(false);

  const [txStatus, setTxStatus] = useState<
    { type: "idle" } | { type: "loading" } | { type: "success"; sig: string } | { type: "error"; msg: string }
  >({ type: "idle" });

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);

  const isSingleLeaf = treeState?.leafCount === 1;
  const beneficiaryKey = publicKey?.toBase58();
  const proofQuery = useProofLookup(
    isSingleLeaf ? treeAddress : undefined,
    isSingleLeaf ? beneficiaryKey : undefined,
  );

  const claimRecordQuery = useClaimRecord(treeAddress, beneficiaryKey);

  const scheduleLocked =
    isSingleLeaf &&
    (scheduleSource === "api" || scheduleSource === "local") &&
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
        bump: account.bump,
      });
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch campaign");
    } finally {
      setLoading(false);
    }
  }, [program, treeAddress]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  useEffect(() => {
    if (!treeState) return;
    connection.getParsedAccountInfo(treeState.mint).then((info) => {
      const parsed = (info.value?.data as any)?.parsed;
      if (parsed?.type === "mint") {
        setMintDecimals(parsed.info.decimals);
      }
    }).catch(() => {});
  }, [treeState?.mint?.toBase58(), connection]);

  /* ---- Load schedule from API / local / URL / manual ---- */

  function tryLoadFromUrl(): boolean {
    if (typeof window === "undefined") return false;
    const url = new URL(window.location.href);
    const rt = url.searchParams.get("rt");
    const st = url.searchParams.get("st");
    const ct = url.searchParams.get("ct");
    const et = url.searchParams.get("et");
    const mi = url.searchParams.get("mi");
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
      return true;
    }
    return false;
  }

  useEffect(() => {
    if (!isSingleLeaf || !publicKey) return;

    if (proofQuery.data?.leaf) {
      applyScheduleToForm(proofQuery.data.leaf, {
        setReleaseType,
        setStartTime,
        setCliffTime,
        setEndTime,
        setMilestoneIdx,
      });
      setScheduleSource("api");
      return;
    }

    if (proofQuery.isError && scheduleSource !== "api") {
      const local = loadStreamScheduleLocal(treeAddress);
      if (local) {
        applyScheduleToForm(
          {
            releaseType: local.releaseType,
            startTime: local.startTime,
            cliffTime: local.cliffTime,
            endTime: local.endTime,
            milestoneIdx: local.milestoneIdx,
          },
          {
            setReleaseType,
            setStartTime,
            setCliffTime,
            setEndTime,
            setMilestoneIdx,
          },
        );
        setScheduleSource("local");
      } else if (tryLoadFromUrl()) {
        setScheduleSource("local");
      } else if (scheduleSource === "none") {
        setScheduleSource("manual");
      }
    }
  }, [
    isSingleLeaf,
    publicKey,
    proofQuery.data,
    proofQuery.isError,
    treeAddress,
    scheduleSource,
  ]);

  /* ---- Derived values ---- */

  function formatTokenAmount(raw: bigint): string {
    if (mintDecimals === null) return raw.toString();
    if (mintDecimals === 0) return raw.toLocaleString();
    const divisor = 10n ** BigInt(mintDecimals);
    const whole = raw / divisor;
    const frac = raw % divisor;
    const fracStr = frac.toString().padStart(mintDecimals, "0").replace(/0+$/, "");
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

  const isCreator = publicKey && treeState ? publicKey.equals(treeState.creator) : false;
  const isCancelAuthority =
    publicKey && treeState?.cancelAuthority ? publicKey.equals(treeState.cancelAuthority) : false;
  const isPauseAuthority =
    publicKey && treeState?.pauseAuthority ? publicKey.equals(treeState.pauseAuthority) : false;
  const isMultiRecipient = (treeState?.leafCount ?? 0) > 1;
  const milestoneBitmap = claimRecordQuery.data?.milestoneBitmap
    ? new Uint8Array(claimRecordQuery.data.milestoneBitmap)
    : new Uint8Array(32);
  const milestoneTriggered = isMilestoneTriggered(milestoneBitmap, Number(milestoneIdx));

  const withdrawDisabledReason = getWithdrawDisabledReason({
    loading: txStatus.type === "loading",
    paused: treeState?.paused ?? false,
    claimable,
    cancelledAt: cancelledAtBigint,
    releaseType,
    nowTs,
    cliffTs: cliffTsBigint,
  });

  /* ---- Status helpers ---- */

  const statusLabel = treeState?.paused
    ? "Paused"
    : treeState?.cancelledAt
      ? "Cancelled"
      : "Active";

  const statusBadgeClass = treeState?.paused
    ? "border-amber-500/20 bg-amber-500/10 text-amber-400"
    : treeState?.cancelledAt
      ? "border-red-500/20 bg-red-500/10 text-red-400"
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

      const startTs = startTime
        ? new BN(datetimeLocalToUnix(startTime))
        : new BN(0);
      const cliffTs = new BN(datetimeLocalToUnix(cliffTime));
      const endTs = new BN(datetimeLocalToUnix(endTime));

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

  /* ---- Schedule source hint ---- */

  const scheduleHint =
    scheduleSource === "api"
      ? "Schedule loaded from indexer."
      : scheduleSource === "local"
        ? "Schedule loaded from this browser (saved at create time)."
        : isSingleLeaf
          ? "Schedule not found. Ask the stream creator for the share link, or enter the exact parameters manually."
          : "Enter your vesting parameters to compute claimable amount.";

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
    <div className="mx-auto max-w-5xl space-y-6">

      {/* ============================================================ */}
      {/*  1. HEADER ROW                                               */}
      {/* ============================================================ */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-semibold text-white">Vesting Stream</h1>

        {/* Status badge */}
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusBadgeClass}`}
        >
          {statusLabel}
        </span>

        {/* Vesting type badge (only shown once schedule is available) */}
        {cliffTime && (
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${getVestingTypeBadgeColor(releaseType)}`}
          >
            {getVestingTypeLabel(releaseType)}
          </span>
        )}

        {/* Cliff countdown -- prominent display for cliff vesting */}
        {releaseType === 0 && cliffTime && nowTs < cliffTsBigint && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[13px] font-medium text-amber-400">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            Cliff in {formatCountdown(cliffTsBigint, nowTs)}
          </span>
        )}

        {/* Milestone status */}
        {releaseType === 2 && cliffTime && (
          <span
            className={`ml-auto inline-flex items-center gap-1.5 rounded-xl border px-3 py-1 text-[13px] font-medium ${
              milestoneTriggered
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                : "border-white/[0.06] bg-white/[0.02] text-[#555d73]"
            }`}
          >
            {milestoneTriggered ? "Milestone unlocked" : "Milestone locked"}
          </span>
        )}
      </div>

      {/* ============================================================ */}
      {/*  2. METRIC CARDS ROW                                         */}
      {/* ============================================================ */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Total Supply" value={formatTokenAmount(totalSupply)} />
        <MetricCard label="Total Claimed" value={formatTokenAmount(totalClaimed)} />
        <MetricCard label="Vested" value={`${progress}%`} />
        <MetricCard label="Claimable" value={formatTokenAmount(claimable)} accent />
      </div>

      {/* ============================================================ */}
      {/*  3. PROGRESS BAR                                             */}
      {/* ============================================================ */}
      {cliffTime && endTime && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-[0.12em] text-[#555d73]">
              Vesting Progress
            </span>
            <span className="text-[13px] font-medium text-white">{progress}%</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-white/[0.04]">
            <div
              className="h-full rounded-full bg-violet-600 transition-all duration-500"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/*  4. CAMPAIGN DETAILS CARD                                    */}
      {/* ============================================================ */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 space-y-4">
        <h2 className="text-[15px] font-medium text-white">Campaign Details</h2>

        <div className="grid gap-3">
          <DetailRow label="Tree Address" value={treeAddress} mono />
          <DetailRow label="Creator" value={treeState.creator.toBase58()} mono />
          <DetailRow label="Mint" value={treeState.mint.toBase58()} mono />
          <DetailRow label="Campaign ID" value={treeState.campaignId.toString()} />
          <DetailRow label="Created" value={formatDate(treeState.createdAt.toNumber())} />
        </div>
      </div>

      {/* ============================================================ */}
      {/*  5. VESTING SCHEDULE CARD                                    */}
      {/* ============================================================ */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-medium text-white">Vesting Schedule</h2>
          {isSingleLeaf && scheduleLocked && (
            <button
              type="button"
              onClick={() => setShowManualSchedule(true)}
              className="text-[11px] text-violet-400 hover:text-violet-300 underline underline-offset-2 transition-colors"
            >
              Edit manually
            </button>
          )}
        </div>

        <p className="text-[11px] text-[#555d73] leading-relaxed">{scheduleHint}</p>

        {proofQuery.isLoading && isSingleLeaf && (
          <p className="text-[11px] text-[#555d73]">Loading schedule...</p>
        )}

        {/* Release type select */}
        <div>
          <label className="block text-[12px] text-[#555d73] mb-1.5">Release Type</label>
          <select
            value={releaseType}
            onChange={(e) => setReleaseType(Number(e.target.value))}
            disabled={scheduleLocked}
            className="w-full rounded-xl border border-white/[0.08] bg-[#11141c] px-4 py-2.5 text-[13px] text-white outline-none focus:border-violet-500/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value={0}>Cliff</option>
            <option value={1}>Linear</option>
            <option value={2}>Milestone</option>
          </select>
        </div>

        {/* Time fields */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-[12px] text-[#555d73] mb-1.5">Start</label>
            <input
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              disabled={scheduleLocked}
              className="w-full rounded-xl border border-white/[0.08] bg-[#11141c] px-3 py-2.5 text-[13px] text-white outline-none focus:border-violet-500/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-[12px] text-[#555d73] mb-1.5">Cliff</label>
            <input
              type="datetime-local"
              value={cliffTime}
              onChange={(e) => setCliffTime(e.target.value)}
              disabled={scheduleLocked}
              required
              className="w-full rounded-xl border border-white/[0.08] bg-[#11141c] px-3 py-2.5 text-[13px] text-white outline-none focus:border-violet-500/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-[12px] text-[#555d73] mb-1.5">End</label>
            <input
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              disabled={scheduleLocked}
              required
              className="w-full rounded-xl border border-white/[0.08] bg-[#11141c] px-3 py-2.5 text-[13px] text-white outline-none focus:border-violet-500/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
        </div>

        {/* Milestone index (conditional) */}
        {releaseType === 2 && (
          <div>
            <label className="block text-[12px] text-[#555d73] mb-1.5">Milestone Index</label>
            <input
              type="number"
              min="0"
              max="255"
              value={milestoneIdx}
              onChange={(e) => setMilestoneIdx(e.target.value)}
              disabled={scheduleLocked}
              className="w-full rounded-xl border border-white/[0.08] bg-[#11141c] px-4 py-2.5 text-[13px] text-white outline-none focus:border-violet-500/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/*  6. ACTIONS CARD                                             */}
      {/* ============================================================ */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 space-y-4">
        <h2 className="text-[15px] font-medium text-white">Actions</h2>

        {/* Primary: Claim Tokens — single vs multi-recipient */}
        {isMultiRecipient && program ? (
          <ClaimWithProofButton
            program={program}
            publicKey={publicKey}
            treePubkey={new PublicKey(treeAddress)}
            treeAddress={treeAddress}
            mint={treeState.mint}
            vault={treeState.vault}
            vaultAuthority={treeState.vaultAuthority}
            onSuccess={fetchTree}
            toast={toast}
          />
        ) : (
          <button
            onClick={handleWithdraw}
            disabled={!!withdrawDisabledReason}
            className="w-full rounded-xl bg-violet-600 py-3.5 text-[15px] font-semibold text-white transition hover:bg-violet-500 active:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {txStatus.type === "loading" ? (
              <span className="inline-flex items-center gap-2">
                <Spinner size={16} />
                Claiming...
              </span>
            ) : (
              withdrawDisabledReason ?? `Claim ${formatTokenAmount(claimable)} Tokens`
            )}
          </button>
        )}

        {/* Milestone status badge */}
        <MilestoneStatusBadge
          isMilestoneType={releaseType === 2}
          alreadyTriggered={milestoneTriggered}
          milestoneIdx={Number(milestoneIdx)}
          cliffTime={cliffTsBigint}
          nowTs={nowTs}
        />

        {/* Pause/Unpause toggle */}
        {program && (
          <PauseToggleButton
            program={program}
            publicKey={publicKey}
            treePubkey={new PublicKey(treeAddress)}
            paused={treeState.paused}
            isPauseAuthority={isPauseAuthority}
            cancelledAt={cancelledAtBigint}
            onSuccess={fetchTree}
            toast={toast}
          />
        )}

        {/* Cancel Stream */}
        {(isCreator || isCancelAuthority) && !treeState.cancelledAt && (
          <button
            onClick={() => setCancelOpen(true)}
            className="w-full rounded-xl border border-red-500/20 py-2.5 text-[13px] font-medium text-red-400 transition hover:border-red-500/40 hover:bg-red-500/5 active:bg-red-500/10"
          >
            Cancel Stream
          </button>
        )}

        {/* Withdraw Unvested (post-cancel, creator only) */}
        {program && (
          <WithdrawUnvestedButton
            program={program}
            publicKey={publicKey}
            treePubkey={new PublicKey(treeAddress)}
            mint={treeState.mint}
            vaultAuthority={treeState.vaultAuthority}
            vault={treeState.vault}
            cancelledAt={cancelledAtBigint}
            isCreator={isCreator}
            nowTs={nowTs}
            onSuccess={fetchTree}
            toast={toast}
          />
        )}

        {/* Transaction status */}
        {txStatus.type === "success" && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <p className="text-[12px] text-[#555d73]">Transaction signature</p>
            <p className="mt-1 break-all font-mono text-[11px] text-emerald-400">
              {txStatus.sig}
            </p>
          </div>
        )}
      </div>

      {/* Cancel confirmation dialog */}
      <CancelConfirmDialog
        isOpen={cancelOpen}
        onConfirm={handleCancel}
        onClose={() => setCancelOpen(false)}
        isLoading={cancelLoading}
        totalSupply={totalSupply}
        totalClaimed={totalClaimed}
        vestedAmount={vested}
      />
    </div>
  );
}

/* ================================================================== */
/*  Sub-components                                                    */
/* ================================================================== */

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
