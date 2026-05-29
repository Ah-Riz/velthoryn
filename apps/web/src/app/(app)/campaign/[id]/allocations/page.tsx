"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { AllocationEditor, emptyRow, type RecipientRow } from "@/components/campaign/detail/AllocationEditor";
import { useCampaignDetail } from "@/hooks/useCampaignDetail";
import { useVestingProgram } from "@/hooks/useVestingProgram";
import { useUpdateRoot } from "@/hooks/useUpdateRoot";
import { useMintInfo } from "@/hooks/useMintInfo";
import { useToast } from "@/components/shell/Toast";
import { canRotateRoot } from "@/lib/campaign/authority";

type OnChainTreeState = {
  merkleRoot: number[];
  leafCount: number;
  cancellable: boolean;
  cancelAuthority: PublicKey | null;
  cancelledAt: BN | null;
};

function truncateHash(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

export default function CampaignAllocationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: treeAddress } = use(params);
  const { publicKey } = useWallet();
  const program = useVestingProgram();
  const { toast } = useToast();
  const { updateRoot, formatVestingError } = useUpdateRoot();
  const campaignDetailQuery = useCampaignDetail(treeAddress);
  const [treeState, setTreeState] = useState<OnChainTreeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTree = useCallback(async () => {
    if (!program) return;
    setLoading(true);
    setError(null);
    try {
      const treePubkey = new PublicKey(treeAddress);
      const account = await (program.account as any).vestingTree.fetch(treePubkey);
      setTreeState({
        merkleRoot: account.merkleRoot,
        leafCount: account.leafCount,
        cancellable: account.cancellable,
        cancelAuthority: account.cancelAuthority ?? null,
        cancelledAt: account.cancelledAt ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load campaign state.");
    } finally {
      setLoading(false);
    }
  }, [program, treeAddress]);

  useEffect(() => { void fetchTree(); }, [fetchTree]);

  const detail = campaignDetailQuery.data;
  const { mintDecimals } = useMintInfo(detail?.mint ?? "");
  const decimals = mintDecimals ?? 9; // default SOL decimals

  // Fetch full leaf data (with schedule) for the editor
  const [fullLeaves, setFullLeaves] = useState<Array<{
    beneficiary: string; amount: string; releaseType: number;
    startTime: string; cliffTime: string; endTime: string; milestoneIdx: number;
  }>>([]);

  useEffect(() => {
    if (!detail?.recipients?.length) return;
    // Fetch proof data for each recipient to get schedule info
    async function fetchLeaves() {
      try {
        const allLeaves: typeof fullLeaves = [];
        for (const r of detail!.recipients) {
          const res = await fetch(`/api/campaigns/${treeAddress}/proof?beneficiary=${r.beneficiary}&all=true`);
          if (!res.ok) continue;
          const data = await res.json() as { leaves: Array<{ leaf: { beneficiary: string; amount: string | number; releaseType: number; startTime: string | number; cliffTime: string | number; endTime: string | number; milestoneIdx: number } }> };
          for (const l of data.leaves) {
            allLeaves.push({
              beneficiary: l.leaf.beneficiary,
              amount: String(l.leaf.amount),
              releaseType: l.leaf.releaseType,
              startTime: String(l.leaf.startTime),
              cliffTime: String(l.leaf.cliffTime),
              endTime: String(l.leaf.endTime),
              milestoneIdx: l.leaf.milestoneIdx,
            });
          }
        }
        setFullLeaves(allLeaves);
      } catch { /* ignore */ }
    }
    void fetchLeaves();
  }, [detail?.recipients, treeAddress]);

  const canRotate = canRotateRoot({
    viewer: publicKey,
    cancelAuthority: treeState?.cancelAuthority,
    cancellable: treeState?.cancellable ?? false,
    cancelledAt: treeState?.cancelledAt ? BigInt(treeState.cancelledAt.toString()) : null,
    leafCount: treeState?.leafCount ?? detail?.leafCount ?? 0,
  });

  const currentMerkleRoot = treeState
    ? Array.from(treeState.merkleRoot).map((b) => b.toString(16).padStart(2, "0")).join("")
    : detail?.merkleRoot ?? "";

  // Build initial rows from full leaf data (with schedule) or fallback to aggregated recipients
  const leavesLoading = detail?.recipients?.length && fullLeaves.length === 0;
  const initialRows: RecipientRow[] = fullLeaves.length > 0
    ? fullLeaves.map((l, i) => ({
        id: `leaf-${i}`,
        beneficiary: l.beneficiary,
        amount: (Number(l.amount) / 10 ** decimals).toString(),
        releaseType: l.releaseType,
        startTime: l.startTime,
        cliffTime: l.cliffTime,
        endTime: l.endTime,
        milestoneIdx: l.milestoneIdx,
      }))
    : [];

  async function handleSubmit(rows: RecipientRow[]) {
    if (!detail || !publicKey) return;

    setSubmitting(true);
    try {
      // Step 1: Call prepare API to build new Merkle tree
      const recipients = rows.map((r) => ({
        beneficiary: r.beneficiary,
        amount: Math.round(Number(r.amount) * 10 ** decimals).toString(),
        releaseType: r.releaseType,
        startTime: r.startTime,
        cliffTime: r.cliffTime,
        endTime: r.endTime,
        milestoneIdx: r.milestoneIdx,
      }));

      if (recipients.some((r) => !r.startTime || !r.cliffTime || !r.endTime)) {
        toast("Schedule data missing. Cannot update allocations without complete schedule.", "error");
        setSubmitting(false);
        return;
      }

      const prepareRes = await fetch("/api/campaigns/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients,
          mint: detail.mint,
          creator: detail.creator,
          campaignId: detail.campaignId,
          cancellable: detail.cancellable,
          cancelAuthority: publicKey.toBase58(),
        }),
      });

      if (!prepareRes.ok) {
        const body = await prepareRes.text();
        throw new Error(`Prepare failed: ${body}`);
      }

      const prepared = await prepareRes.json() as {
        merkleRoot: string;
        leafCount: number;
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
      };

      // Step 2: Submit root rotation on-chain + index
      const result = await updateRoot({
        treeAddress,
        payload: {
          merkleRoot: prepared.merkleRoot,
          leafCount: prepared.leafCount,
          leaves: prepared.leaves,
        },
      });

      toast(
        result.version !== null
          ? `Allocations updated! Version ${result.version} indexed.`
          : "Allocations updated on-chain!",
        "success",
      );
      if (result.indexWarning) toast(result.indexWarning, "info");

      // Refresh data
      void fetchTree();
      void campaignDetailQuery.refetch();
    } catch (err) {
      if (err instanceof Error && /User rejected|Connection rejected/i.test(err.message)) return;
      toast(formatVestingError(err), "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      {/* Header */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0d1117] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <Link
              href={`/campaign/${treeAddress}`}
              className="inline-flex items-center gap-2 text-[12px] font-medium text-[#8b92a5] transition hover:text-white"
            >
              <span aria-hidden="true">←</span> Back to campaign
            </Link>
            <h1 className="text-[24px] font-semibold text-white">Allocation Editor</h1>
            <p className="max-w-3xl text-[14px] leading-7 text-[#8b92a5]">
              Add, remove, or update recipients. Changes take effect after you approve the transaction.
            </p>
          </div>
          {currentMerkleRoot && (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#6f7c95]">Active Root</p>
              <p className="mt-2 font-mono text-[12px] text-white">{truncateHash(currentMerkleRoot)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Info cards */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#6f7c95]">Step 1</p>
          <p className="mt-2 text-[13px] font-medium text-white">Edit recipients</p>
          <p className="mt-1 text-[12px] text-[#8b92a5]">Add, remove, or change amounts below.</p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#6f7c95]">Step 2</p>
          <p className="mt-2 text-[13px] font-medium text-white">Click Update</p>
          <p className="mt-1 text-[12px] text-[#8b92a5]">We rebuild the Merkle tree automatically.</p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#6f7c95]">Step 3</p>
          <p className="mt-2 text-[13px] font-medium text-white">Approve transaction</p>
          <p className="mt-1 text-[12px] text-[#8b92a5]">Sign once — old proofs are replaced.</p>
        </div>
      </div>

      {/* States */}
      {!publicKey && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 text-[13px] text-[#8b92a5]">
          Connect your wallet to edit allocations.
        </div>
      )}

      {publicKey && loading && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 text-[13px] text-[#8b92a5]">
          Loading…
        </div>
      )}

      {publicKey && error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-[13px] text-red-400">
          {error}
        </div>
      )}

      {/* Editor */}
      {publicKey && !loading && !error && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
          {leavesLoading ? (
            <p className="text-[13px] text-[#8b92a5]">Loading recipient data…</p>
          ) : (
            <AllocationEditor
              initialRecipients={initialRows.length > 0 ? initialRows : [emptyRow()]}
              loading={submitting}
              onSubmit={handleSubmit}
              canRotate={canRotate}
            />
          )}
        </div>
      )}
    </div>
  );
}
