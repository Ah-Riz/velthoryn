"use client";

import { useState } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { type Program } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { useQuery } from "@tanstack/react-query";
import { useClaimRecord } from "@/hooks/useClaimRecord";
import { toAnchorLeaf } from "@/lib/anchor/adapters";
import { derivePda } from "@/lib/anchor/client";
import { formatVestingError } from "@/lib/anchor/errors";

interface ProofLeaf {
  leafIndex: number;
  beneficiary: string;
  amount: number;
  releaseType: number;
  startTime: number;
  cliffTime: number;
  endTime: number;
  milestoneIdx: number;
}

interface LeafWithProof {
  leaf: ProofLeaf;
  proof: number[][];
}

type Props = {
  program: Program;
  publicKey: PublicKey;
  treePubkey: PublicKey;
  treeAddress: string;
  mint: PublicKey;
  vault: PublicKey;
  vaultAuthority: PublicKey;
  mintDecimals: number | null;
  onSuccess: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
};

function fmtAmount(raw: number | string, decimals: number | null): string {
  if (!decimals) return String(raw);
  const n = Number(raw) / 10 ** decimals;
  return n % 1 === 0 ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function ClaimWithProofButton({
  program,
  publicKey,
  treePubkey,
  treeAddress,
  mint,
  vault,
  vaultAuthority,
  mintDecimals,
  onSuccess,
  toast,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [myClaimedAmount, setMyClaimedAmount] = useState(0n);

  const claimRecordQuery = useClaimRecord(treeAddress, publicKey.toBase58());
  const beneficiaryClaimedAmount = claimRecordQuery.data
    ? BigInt(claimRecordQuery.data.claimedAmount.toString())
    : myClaimedAmount;

  const allLeavesQuery = useQuery<LeafWithProof[]>({
    queryKey: ["proof-all", treeAddress, publicKey.toBase58()],
    queryFn: async () => {
      const params = new URLSearchParams({ beneficiary: publicKey.toBase58(), all: "true" });
      const res = await fetch(`/api/campaigns/${treeAddress}/proof?${params}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      return data.leaves ?? [{ leaf: data.leaf, proof: data.proof }];
    },
    enabled: !!treeAddress,
    staleTime: 30_000,
  });

  if (allLeavesQuery.isLoading) {
    return (
      <button disabled className="cursor-not-allowed w-full rounded-xl bg-violet-600/50 py-3.5 text-[15px] font-semibold text-white/60">
        Loading proof...
      </button>
    );
  }

  if (allLeavesQuery.isError || !allLeavesQuery.data?.length) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[13px] text-[#555d73]">
        Merkle proof not available — contact campaign creator to index recipients.
      </div>
    );
  }

  const leaves = allLeavesQuery.data;
  const selected = leaves[selectedIdx] ?? leaves[0];

  // Determine which leaves are already claimed based on this beneficiary's ClaimRecord
  let runningTotal = 0n;
  const leafClaimedStatus = leaves.map((entry) => {
    const amt = BigInt(entry.leaf.amount);
    runningTotal += amt;
    return runningTotal <= beneficiaryClaimedAmount;
  });

  async function handleClaim() {
    setLoading(true);
    try {
      const anchorLeaf = toAnchorLeaf({
        ...selected.leaf,
        amount: String(selected.leaf.amount),
      });

      const proofBytes: number[][] = selected.proof.map((p: number[]) =>
        Array.isArray(p) ? p : Array.from(p),
      );

      const [claimRecord] = derivePda([
        "claim",
        treePubkey.toBuffer(),
        publicKey.toBuffer(),
      ]);

      const beneficiaryAta = getAssociatedTokenAddressSync(mint, publicKey);

      const sig = await program.methods
        .claim(anchorLeaf, proofBytes)
        .accounts({
          beneficiary: publicKey,
          vestingTree: treePubkey,
          claimRecord,
          vaultAuthority,
          vault,
          mint,
          beneficiaryAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      toast("Tokens claimed successfully!", "success");
      setMyClaimedAmount((prev) => prev + BigInt(selected.leaf.amount));
      // Sync claim event to DB with retry
      const syncClaim = async (retries = 3) => {
        for (let i = 0; i < retries; i++) {
          try {
            const res = await fetch(`/api/claims/sync`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ signature: sig }),
            });
            if (res.ok) return;
          } catch { /* retry */ }
          if (i < retries - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
        }
      };
      syncClaim().catch(() => {});
      onSuccess();
    } catch (err: unknown) {
      if (err instanceof Error && /User rejected|Connection rejected/i.test(err.message)) return;
      toast(formatVestingError(err), "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Leaf selector (only show if multiple) */}
      {leaves.length > 1 && (
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-[#8b92a5]">Select allocation to claim</p>
          {leaves.length > 1 && leaves.every((l) => l.leaf.beneficiary === leaves[0].leaf.beneficiary) && (
            <p className="text-[11px] text-amber-400">Note: Multiple allocations for your wallet. Each can only be claimed sequentially.</p>
          )}
          <div className="space-y-1.5">
            {leaves.map((entry, i) => {
              const claimed = leafClaimedStatus[i];
              return (
                <button
                  key={entry.leaf.leafIndex}
                  type="button"
                  onClick={() => !claimed && setSelectedIdx(i)}
                  disabled={claimed}
                  className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-left text-[12px] transition ${
                    claimed
                      ? "border-white/[0.04] bg-white/[0.01] text-[#555d73] cursor-not-allowed"
                      : i === selectedIdx
                      ? "border-violet-500/40 bg-violet-500/10 text-white"
                      : "border-white/[0.06] text-[#8b92a5] hover:border-white/[0.12]"
                  }`}
                >
                  <span>Leaf #{entry.leaf.leafIndex} — {fmtAmount(entry.leaf.amount, mintDecimals)}</span>
                  {claimed ? (
                    <span className="text-[10px] text-emerald-400">Claimed ✓</span>
                  ) : (
                    <span className="text-[10px]">{entry.leaf.releaseType === 0 ? "Cliff" : entry.leaf.releaseType === 1 ? "Linear" : "Milestone"}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <button
        onClick={handleClaim}
        disabled={loading || leafClaimedStatus[selectedIdx]}
        className="w-full rounded-xl bg-violet-600 py-3.5 text-[15px] font-semibold text-white transition hover:bg-violet-500 active:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {leafClaimedStatus[selectedIdx]
          ? "Already Claimed"
          : loading
          ? "Claiming..."
          : `Claim ${fmtAmount(selected.leaf.amount, mintDecimals)} Tokens`}
      </button>
    </div>
  );
}
