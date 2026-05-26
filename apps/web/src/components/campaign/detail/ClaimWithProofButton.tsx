"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { type Program } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useClaimRecord } from "@/hooks/useClaimRecord";
import { toAnchorLeaf } from "@/lib/anchor/adapters";
import { derivePda } from "@/lib/anchor/client";
import { formatVestingError } from "@/lib/anchor/errors";
import { isNativeSol, isWrappedSol } from "@/lib/sol/auto-wrap";
import { formatCountdown } from "@/lib/vesting/display";
import { isMilestoneTriggered } from "@/lib/vesting/milestone";

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
  paused: boolean;
  milestoneReleasedFlags: Uint8Array;
  isCreator?: boolean;
  onSuccess: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
};

type UnknownRecord = Record<string, unknown>;

function fmtAmount(raw: number | string, decimals: number | null): string {
  if (!decimals) return String(raw);
  const n = Number(raw) / 10 ** decimals;
  return n % 1 === 0 ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function vestedForLeaf(leaf: ProofLeaf, nowUnix: number, milestoneReleasedFlags?: Uint8Array): bigint {
  const amount = BigInt(String(leaf.amount));
  const now = BigInt(nowUnix);
  const cliff = BigInt(leaf.cliffTime);
  const end = BigInt(leaf.endTime);

  if (leaf.releaseType === 2) {
    const released = milestoneReleasedFlags
      ? isMilestoneTriggered(milestoneReleasedFlags, leaf.milestoneIdx)
      : false;
    return released && now >= cliff ? amount : 0n;
  }

  if (leaf.releaseType === 0) {
    return now >= cliff ? amount : 0n;
  }

  if (now >= end) return amount;
  if (now <= cliff) return 0n;
  const elapsed = now - cliff;
  const duration = end - cliff;
  return duration > 0n ? (amount * elapsed) / duration : 0n;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function extractSimulationDetails(err: unknown): {
  logs: string[];
  programErr: unknown;
  message: string;
} {
  const logs: string[] = [];
  const seen = new Set<unknown>();
  let programErr: unknown;

  function visit(value: unknown) {
    if (!isRecord(value) && !Array.isArray(value)) return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      if (value.every((entry) => typeof entry === "string")) {
        logs.push(...(value as string[]));
        return;
      }
      for (const entry of value) visit(entry);
      return;
    }

    for (const [key, nested] of Object.entries(value)) {
      if ((key === "logs" || key === "transactionLogs") && Array.isArray(nested)) {
        for (const entry of nested) {
          if (typeof entry === "string") logs.push(entry);
        }
      }
      if (programErr === undefined && key === "err" && nested !== undefined) {
        programErr = nested;
      }
      visit(nested);
    }
  }

  visit(err);

  return {
    logs,
    programErr,
    message: err instanceof Error ? err.message : String(err),
  };
}

function getRelevantProgramLog(logs: string[]): string | null {
  const interesting = logs.filter((log) =>
    log.includes("Program log:") ||
    log.includes("AnchorError") ||
    log.includes("custom program error") ||
    log.includes("failed:") ||
    log.includes("Error"),
  );
  return interesting.at(-1) ?? null;
}

function stringifyForToast(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function relabelInstructionKeys(
  ix: TransactionInstruction,
  namedAccounts: Record<string, string>,
) {
  const labels = Object.entries(namedAccounts);
  return ix.keys.map((meta, index) => {
    const label =
      labels.find(([, pubkey]) => pubkey === meta.pubkey.toBase58())?.[0] ?? "unknown";
    return {
      index,
      label,
      pubkey: meta.pubkey.toBase58(),
      isSigner: meta.isSigner,
      isWritable: meta.isWritable,
    };
  });
}

function isWalletCancellation(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return /User rejected|Connection rejected|Transaction cancelled|rejected by user|denied/i.test(raw);
}

function toWalletApprovalMessage(message: string): string {
  return message === "Transaction cancelled in wallet."
    ? "Wallet approval did not complete."
    : message;
}

function isWalletInternalSendError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return /WalletSendTransactionError|Internal error/i.test(raw);
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
  paused,
  milestoneReleasedFlags,
  isCreator,
  onSuccess,
  toast,
}: Props) {
  const { sendTransaction, signTransaction } = useWallet();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [myClaimedAmount, setMyClaimedAmount] = useState(0n);
  const [nowUnix, setNowUnix] = useState(() => Math.floor(Date.now() / 1000));

  const beneficiaryAddress = publicKey.toBase58();
  const claimRecordQuery = useClaimRecord(treeAddress, beneficiaryAddress);
  const claimedAmountFromQuery = claimRecordQuery.data
    ? BigInt(claimRecordQuery.data.claimedAmount.toString())
    : 0n;
  const beneficiaryClaimedAmount =
    claimedAmountFromQuery > myClaimedAmount ? claimedAmountFromQuery : myClaimedAmount;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowUnix(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

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
    if (isCreator) return null;
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[13px] text-[#555d73]">
        No allocation found for your wallet in this campaign.
      </div>
    );
  }

  const leaves = allLeavesQuery.data;
  const selected = leaves[selectedIdx] ?? leaves[0];
  const selectedLeaf = selected.leaf;
  const waitBeforeUnlock = nowUnix < selectedLeaf.cliffTime;
  const waitCountdown = waitBeforeUnlock
    ? formatCountdown(BigInt(selectedLeaf.cliffTime), BigInt(nowUnix))
    : null;
  const waitLabel = waitCountdown
    ? selectedLeaf.releaseType === 0
      ? `Wait for cliff ${waitCountdown}`
      : selectedLeaf.releaseType === 1
        ? `Wait for vesting ${waitCountdown}`
        : `Wait for milestone ${waitCountdown}`
    : null;
  const milestoneNotReleased = selectedLeaf.releaseType === 2
    && !isMilestoneTriggered(milestoneReleasedFlags, selectedLeaf.milestoneIdx);

  const leafClaimedTotals = leaves.reduce<bigint[]>(
    (claimedTotals, entry) => {
      const alreadyAssigned = claimedTotals.reduce((sum, claimed) => sum + claimed, 0n);
      const remainingClaimed = beneficiaryClaimedAmount > alreadyAssigned
        ? beneficiaryClaimedAmount - alreadyAssigned
        : 0n;
      const leafAmount = BigInt(String(entry.leaf.amount));
      const claimedForLeaf = remainingClaimed > leafAmount ? leafAmount : remainingClaimed;
      claimedTotals.push(claimedForLeaf);
      return claimedTotals;
    },
    [],
  );
  const leafClaimableAmounts = leaves.map((entry, index) => {
    const vestedNow = vestedForLeaf(entry.leaf, nowUnix, milestoneReleasedFlags);
    const claimedForLeaf = leafClaimedTotals[index] ?? 0n;
    return vestedNow > claimedForLeaf ? vestedNow - claimedForLeaf : 0n;
  });
  const leafFullyClaimed = leaves.map((entry, index) => {
    const leafAmount = BigInt(String(entry.leaf.amount));
    return (leafClaimedTotals[index] ?? 0n) >= leafAmount;
  });
  const selectedClaimableAmount = leafClaimableAmounts[selectedIdx] ?? 0n;

  async function handleClaim() {
    if (paused) {
      toast("Campaign is paused. Contact the creator.", "error");
      return;
    }
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
      const connection = program.provider.connection;
      const nativeSol = isNativeSol(mint);

      console.log("[ClaimWithProofButton] leaf:", JSON.stringify(selected.leaf));
      console.log("[ClaimWithProofButton] proof entries:", selected.proof.length, "each length:", selected.proof[0]?.length);

      let claimIx: TransactionInstruction;
      let namedAccounts: Record<string, string>;

      if (nativeSol) {
        const placeholder = program.programId;
        namedAccounts = {
          beneficiary: publicKey.toBase58(),
          vestingTree: treePubkey.toBase58(),
          claimRecord: claimRecord.toBase58(),
          vaultAuthority: placeholder.toBase58(),
          vault: placeholder.toBase58(),
          mint: placeholder.toBase58(),
          beneficiaryAta: placeholder.toBase58(),
          tokenProgram: placeholder.toBase58(),
          associatedTokenProgram: placeholder.toBase58(),
          systemProgram: SystemProgram.programId.toBase58(),
        };

        console.log("[ClaimWithProofButton] accounts:", namedAccounts);

        const claimData = program.coder.instruction.encode("claim", {
          leaf: anchorLeaf,
          proof: proofBytes,
        });

        claimIx = new TransactionInstruction({
          programId: program.programId,
          keys: [
            { pubkey: publicKey, isSigner: true, isWritable: true },
            { pubkey: treePubkey, isSigner: false, isWritable: true },
            { pubkey: claimRecord, isSigner: false, isWritable: true },
            { pubkey: placeholder, isSigner: false, isWritable: false }, // vault_authority
            { pubkey: placeholder, isSigner: false, isWritable: true }, // vault
            { pubkey: placeholder, isSigner: false, isWritable: false }, // mint
            { pubkey: placeholder, isSigner: false, isWritable: true }, // beneficiary_ata
            { pubkey: placeholder, isSigner: false, isWritable: false }, // token_program
            { pubkey: placeholder, isSigner: false, isWritable: false }, // associated_token_program
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: claimData,
        });
      } else {
        const beneficiaryAta = getAssociatedTokenAddressSync(mint, publicKey);
        const beneficiaryAtaInfo = await connection.getAccountInfo(beneficiaryAta);
        if (!beneficiaryAtaInfo) {
          const [beneficiaryLamports, ataRentLamports] = await Promise.all([
            connection.getBalance(publicKey),
            connection.getMinimumBalanceForRentExemption(165),
          ]);
          if (beneficiaryLamports < ataRentLamports) {
            toast(
              `Insufficient SOL to create token account. Wallet has ${beneficiaryLamports} lamports, needs ${ataRentLamports}. Airdrop SOL to the recipient wallet first.`,
              "error",
            );
            return;
          }
        }

        console.log("[ClaimWithProofButton] accounts:", {
          beneficiary: publicKey.toBase58(),
          vestingTree: treePubkey.toBase58(),
          claimRecord: claimRecord.toBase58(),
          vaultAuthority: vaultAuthority.toBase58(),
          vault: vault.toBase58(),
          mint: mint.toBase58(),
          beneficiaryAta: beneficiaryAta.toBase58(),
        });

        namedAccounts = {
          beneficiary: publicKey.toBase58(),
          vestingTree: treePubkey.toBase58(),
          claimRecord: claimRecord.toBase58(),
          vaultAuthority: vaultAuthority.toBase58(),
          vault: vault.toBase58(),
          mint: mint.toBase58(),
          beneficiaryAta: beneficiaryAta.toBase58(),
          tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
          systemProgram: SystemProgram.programId.toBase58(),
        };

        // Temporary devnet compatibility path for SPL/wSOL claims.
        const claimData = program.coder.instruction.encode("claim", {
          leaf: anchorLeaf,
          proof: proofBytes,
        });

        claimIx = new TransactionInstruction({
          programId: program.programId,
          keys: [
            { pubkey: publicKey, isSigner: true, isWritable: true },
            { pubkey: treePubkey, isSigner: false, isWritable: true },
            { pubkey: claimRecord, isSigner: false, isWritable: true },
            { pubkey: vaultAuthority, isSigner: false, isWritable: false },
            { pubkey: vault, isSigner: false, isWritable: true },
            { pubkey: beneficiaryAta, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: claimData,
        });
      }

      const claimTx = new Transaction().add(claimIx);

      console.table(
        relabelInstructionKeys(claimIx, namedAccounts),
      );

      const provider = program.provider as {
        connection: typeof connection;
        simulate: (tx: Transaction, signers?: unknown[], commitment?: unknown) => Promise<unknown>;
        sendAndConfirm: (tx: Transaction, signers?: unknown[]) => Promise<string>;
      };

      try {
        const simResult = await provider.simulate(claimTx, []);
        console.log("[ClaimWithProofButton] simulate OK, logs:", simResult);
      } catch (simErr: unknown) {
        const { logs: simLogs, programErr, message } = extractSimulationDetails(simErr);
        console.error("[ClaimWithProofButton] simulate FAILED:", simErr);
        console.dir(simErr);
        console.error("[ClaimWithProofButton] simulation logs:", simLogs);
        console.error("[ClaimWithProofButton] simulation err:", programErr);

        const logsStr = simLogs?.join("\n") ?? "";
        const fullStr = [
          message,
          logsStr,
        ].join("\n");

        const formatted = formatVestingError({ message: fullStr });
        if (formatted !== "Transaction failed. Please try again.") {
          toast(stringifyForToast(formatted), "error");
          return;
        }
        const lastLog = getRelevantProgramLog(simLogs);
        toast(stringifyForToast(`Claim simulation failed: ${lastLog ?? fullStr.slice(0, 200)}`), "error");
        return;
      }

      claimTx.feePayer = publicKey;
      const latestBlockhash = await connection.getLatestBlockhash("confirmed");
      claimTx.recentBlockhash = latestBlockhash.blockhash;

      let sig: string;
      if (signTransaction) {
        console.log("[ClaimWithProofButton] using signTransaction + sendRawTransaction path");
        const signedTx = await signTransaction(claimTx);
        const rawTx = signedTx.serialize();
        sig = await connection.sendRawTransaction(rawTx, {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });
      } else {
        try {
          if (sendTransaction) {
            sig = await sendTransaction(claimTx, connection, {
              skipPreflight: false,
              preflightCommitment: "confirmed",
            });
          } else {
            sig = await provider.sendAndConfirm(claimTx, []);
          }
        } catch (sendErr: unknown) {
          if (isWalletInternalSendError(sendErr)) {
            console.warn(
              "[ClaimWithProofButton] sendTransaction internal error without signTransaction fallback",
              sendErr,
            );
          }
          throw sendErr;
        }
      }

      await connection.confirmTransaction(
        {
          signature: sig,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        "confirmed",
      );

      const wrappedSol = isWrappedSol(mint);
      toast(
        nativeSol
          ? "SOL claimed successfully!"
          : wrappedSol
          ? "wSOL claimed! Use Wrap/Unwrap to convert to SOL."
          : "Tokens claimed successfully!",
        "success",
      );
      setMyClaimedAmount((prev) => {
        const next = prev + selectedClaimableAmount;
        return next > beneficiaryClaimedAmount ? next : beneficiaryClaimedAmount;
      });
      void queryClient.invalidateQueries({
        queryKey: ["claimRecord", treeAddress, beneficiaryAddress],
      });
      void queryClient.invalidateQueries({
        queryKey: ["beneficiaryCampaigns"],
      });
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
      if (isWalletCancellation(err)) {
        toast("Wallet approval did not complete.", "info");
        return;
      }
      const { logs, programErr, message } = extractSimulationDetails(err);
      console.error("[ClaimWithProofButton] claim failed:", err);
      console.dir(err);
      if (logs.length > 0) {
        console.error("[ClaimWithProofButton] claim failure logs:", logs);
      }
      if (programErr !== undefined) {
        console.error("[ClaimWithProofButton] claim failure err field:", programErr);
      }
      console.error("[ClaimWithProofButton] leaf data:", JSON.stringify(selected.leaf));
      console.error("[ClaimWithProofButton] proof length:", selected.proof.length);
      const fullStr = [message, logs.join("\n")].filter(Boolean).join("\n");
      const formatted = toWalletApprovalMessage(formatVestingError({ message: fullStr || message }));
      if (formatted !== "Transaction failed. Please try again.") {
        toast(stringifyForToast(formatted), "error");
        return;
      }
      const lastLog = getRelevantProgramLog(logs);
      toast(stringifyForToast(lastLog ?? formatted), "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Leaf selector (only show if multiple) */}
      {leaves.length > 1 && (
        <LeafSelector
          leaves={leaves}
          selectedIdx={selectedIdx}
          onSelect={setSelectedIdx}
          leafFullyClaimed={leafFullyClaimed}
          leafClaimableAmounts={leafClaimableAmounts}
          mintDecimals={mintDecimals}
          milestoneReleasedFlags={milestoneReleasedFlags}
        />
      )}

      <button
        onClick={handleClaim}
        disabled={loading || leafFullyClaimed[selectedIdx] || waitBeforeUnlock || paused || milestoneNotReleased || selectedClaimableAmount === 0n}
        className="w-full rounded-xl bg-violet-600 py-3.5 text-[15px] font-semibold text-white transition hover:bg-violet-500 active:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {leafFullyClaimed[selectedIdx]
          ? "Already Claimed"
          : loading
          ? "Claiming..."
          : paused
          ? "Campaign Paused"
          : waitLabel
          ? waitLabel
          : milestoneNotReleased
          ? "Milestone not released yet"
          : selectedClaimableAmount === 0n
          ? "Nothing to claim yet"
          : `Claim ${fmtAmount(selectedClaimableAmount.toString(), mintDecimals)} Tokens`}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  LeafSelector — compact grid for large leaf counts                 */
/* ------------------------------------------------------------------ */

const LEAF_PAGE_SIZE = 12;

function LeafSelector({
  leaves,
  selectedIdx,
  onSelect,
  leafFullyClaimed,
  leafClaimableAmounts,
  mintDecimals,
  milestoneReleasedFlags,
}: {
  leaves: LeafWithProof[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
  leafFullyClaimed: boolean[];
  leafClaimableAmounts: bigint[];
  mintDecimals: number | null;
  milestoneReleasedFlags: Uint8Array;
}) {
  const [page, setPage] = useState(0);
  const hasMilestones = leaves.some((l) => l.leaf.releaseType === 2);
  const claimedCount = leafFullyClaimed.filter(Boolean).length;
  const useCompact = leaves.length > 6;

  const totalPages = useCompact ? Math.ceil(leaves.length / LEAF_PAGE_SIZE) : 1;
  const pageStart = useCompact ? page * LEAF_PAGE_SIZE : 0;
  const pageEnd = useCompact ? Math.min(pageStart + LEAF_PAGE_SIZE, leaves.length) : leaves.length;
  const visibleLeaves = leaves.slice(pageStart, pageEnd);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-medium text-[#8b92a5]">
          {hasMilestones ? "Select milestone to claim" : "Select allocation to claim"}
        </p>
        <span className="text-[11px] text-[#6f7c95]">
          {claimedCount}/{leaves.length} claimed
        </span>
      </div>

      {useCompact ? (
        <>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            {visibleLeaves.map((entry, pageI) => {
              const i = pageStart + pageI;
              const claimed = leafFullyClaimed[i];
              const claimableNow = leafClaimableAmounts[i] ?? 0n;
              const isMilestone = entry.leaf.releaseType === 2;
              const milestoneReleased = isMilestone
                ? isMilestoneTriggered(milestoneReleasedFlags, entry.leaf.milestoneIdx)
                : true;
              return (
                <button
                  key={entry.leaf.leafIndex}
                  type="button"
                  onClick={() => !claimed && onSelect(i)}
                  disabled={claimed}
                  title={
                    claimed
                      ? `Leaf #${entry.leaf.leafIndex} — claimed`
                      : `Leaf #${entry.leaf.leafIndex} — ${fmtAmount(claimableNow.toString(), mintDecimals)} claimable`
                  }
                  className={`flex flex-col items-center justify-center rounded-lg border px-1 py-2 text-center transition ${
                    claimed
                      ? "border-emerald-500/20 bg-emerald-500/5 cursor-default"
                      : i === selectedIdx
                        ? "border-violet-500/40 bg-violet-500/10"
                        : "border-white/[0.06] bg-white/[0.02] hover:border-violet-500/30 hover:bg-violet-500/5"
                  }`}
                >
                  <span className={`text-[11px] font-semibold ${
                    claimed ? "text-emerald-400" : i === selectedIdx ? "text-violet-400" : "text-white"
                  }`}>
                    {isMilestone ? `#${entry.leaf.milestoneIdx}` : `#${entry.leaf.leafIndex}`}
                  </span>
                  <span className={`mt-0.5 text-[9px] ${
                    claimed
                      ? "text-emerald-400/60"
                      : !milestoneReleased
                        ? "text-amber-400/60"
                        : claimableNow > 0n
                          ? "text-violet-400/80"
                          : "text-[#555d73]"
                  }`}>
                    {claimed ? "done" : !milestoneReleased ? "locked" : claimableNow > 0n ? "ready" : "pending"}
                  </span>
                </button>
              );
            })}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-md border border-white/[0.08] px-2 py-1 text-[11px] text-[#8b92a5] transition hover:bg-white/[0.04] disabled:opacity-30"
              >
                Prev
              </button>
              <span className="text-[11px] text-[#6f7c95]">{page + 1}/{totalPages}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-md border border-white/[0.08] px-2 py-1 text-[11px] text-[#8b92a5] transition hover:bg-white/[0.04] disabled:opacity-30"
              >
                Next
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-1.5">
          {leaves.map((entry, i) => {
            const claimed = leafFullyClaimed[i];
            const claimableNow = leafClaimableAmounts[i] ?? 0n;
            return (
              <button
                key={entry.leaf.leafIndex}
                type="button"
                onClick={() => !claimed && onSelect(i)}
                disabled={claimed}
                className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-left text-[12px] transition ${
                  claimed
                    ? "border-white/[0.04] bg-white/[0.01] text-[#555d73] cursor-not-allowed"
                    : i === selectedIdx
                    ? "border-violet-500/40 bg-violet-500/10 text-white"
                    : "border-white/[0.06] text-[#8b92a5] hover:border-white/[0.12]"
                }`}
              >
                <span>
                  {entry.leaf.releaseType === 2 ? `Milestone #${entry.leaf.milestoneIdx}` : `Leaf #${entry.leaf.leafIndex}`} — {fmtAmount(claimableNow.toString(), mintDecimals)} claimable
                </span>
                {claimed ? (
                  <span className="text-[10px] text-emerald-400">Claimed</span>
                ) : (
                  <span className="text-[10px]">{entry.leaf.releaseType === 0 ? "Cliff" : entry.leaf.releaseType === 1 ? "Linear" : "Milestone"}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
