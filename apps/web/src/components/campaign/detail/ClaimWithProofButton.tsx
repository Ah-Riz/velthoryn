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
import {
  formatVestingError,
  extractSimulationDetails,
  getRelevantProgramLog,
  isWalletCancellation,
} from "@/lib/anchor/errors";
import { isNativeSol, isWrappedSol } from "@/lib/sol/auto-wrap";
import { formatCountdown } from "@/lib/vesting/display";
import { isMilestoneTriggered } from "@/lib/vesting/milestone";


interface ProofLeaf {
  leafIndex: number;
  beneficiary: string;
  amount: string;
  releaseType: number;
  startTime: string;
  cliffTime: string;
  endTime: string;
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
  cancelledAt?: bigint | null;
  isCreator?: boolean;
  onSuccess: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
};

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

function toWalletApprovalMessage(message: string): string {
  return message === "Transaction cancelled in wallet."
    ? "Wallet approval did not complete."
    : message;
}

function isWalletInternalSendError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return /WalletSendTransactionError|Internal error/i.test(raw);
}

function waitForLoadingPaint() {
  return new Promise<void>((resolve) => setTimeout(resolve, 250));
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
  cancelledAt,
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
      <button disabled className="cursor-not-allowed w-full rounded-xl bg-violet-700/50 dark:bg-violet-600/50 py-3.5 text-[15px] font-semibold text-white/60">
        Loading proof...
      </button>
    );
  }

  if (allLeavesQuery.isError || !allLeavesQuery.data?.length) {
    if (isCreator) return null;
    return (
      <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] px-4 py-3 text-[13px] text-muted-foreground">
        No allocation found for your wallet in this campaign.
      </div>
    );
  }

  const leaves = allLeavesQuery.data;
  const selected = leaves[selectedIdx] ?? leaves[0];
  const selectedLeaf = selected.leaf;
  const waitBeforeUnlock = nowUnix < Number(selectedLeaf.cliffTime);
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

  // On-chain milestone bitmap: each bit represents whether that milestone_idx was claimed.
  // This is the authoritative per-milestone claimed state, immune to out-of-order claiming.
  const milestoneBitmap = claimRecordQuery.data?.milestoneBitmap
    ? new Uint8Array(claimRecordQuery.data.milestoneBitmap)
    : new Uint8Array(32);

  // Greedy allocation of cumulative claimedAmount across leaves (only used for cliff/linear).
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
  const effectiveNowUnix = cancelledAt !== null && cancelledAt !== undefined
    ? Math.min(nowUnix, Number(cancelledAt))
    : nowUnix;
  const leafClaimableAmounts = leaves.map((entry, index) => {
    if (entry.leaf.releaseType === 2) {
      // Milestone: use on-chain bitmap (authoritative, per-milestone-idx).
      // Avoids the greedy allocation bug where out-of-order claiming marks
      // intermediate milestones as "fully claimed" in the UI.
      const alreadyClaimed = isMilestoneTriggered(milestoneBitmap, entry.leaf.milestoneIdx);
      if (alreadyClaimed) return 0n;
      const released = isMilestoneTriggered(milestoneReleasedFlags, entry.leaf.milestoneIdx);
      const nowPastCliff = effectiveNowUnix >= Number(entry.leaf.cliffTime);
      return released && nowPastCliff ? BigInt(String(entry.leaf.amount)) : 0n;
    }
    // Cliff/Linear: use greedy allocation against cumulative claimedAmount.
    const vestedNow = vestedForLeaf(entry.leaf, effectiveNowUnix, milestoneReleasedFlags);
    const claimedForLeaf = leafClaimedTotals[index] ?? 0n;
    return vestedNow > claimedForLeaf ? vestedNow - claimedForLeaf : 0n;
  });
  const leafFullyClaimed = leaves.map((entry, index) => {
    if (entry.leaf.releaseType === 2) {
      // Milestone: check on-chain bitmap, not greedy allocation.
      return isMilestoneTriggered(milestoneBitmap, entry.leaf.milestoneIdx);
    }
    // Cliff/Linear: use greedy allocation.
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
    await waitForLoadingPaint();
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
        const [beneficiaryLamports, claimRecordRent] = await Promise.all([
          connection.getBalance(publicKey),
          connection.getMinimumBalanceForRentExemption(240),
        ]);
        const claimRecordExists = await connection.getAccountInfo(claimRecord);
        const minRequired = (claimRecordExists ? 0 : claimRecordRent) + 10_000;
        if (beneficiaryLamports < minRequired) {
          toast(
            `Insufficient SOL for transaction fees${!claimRecordExists ? " and claim account rent" : ""}. ` +
            `Wallet has ${(beneficiaryLamports / 1e9).toFixed(4)} SOL, needs ~${(minRequired / 1e9).toFixed(4)} SOL. ` +
            `Fund your wallet first.`,
            "error",
          );
          return;
        }

        const noneMarker = program.programId;
        namedAccounts = {
          beneficiary: publicKey.toBase58(),
          vestingTree: treePubkey.toBase58(),
          claimRecord: claimRecord.toBase58(),
          vaultAuthority: noneMarker.toBase58(),
          vault: noneMarker.toBase58(),
          beneficiaryAta: noneMarker.toBase58(),
          mint: noneMarker.toBase58(),
          tokenProgram: noneMarker.toBase58(),
          associatedTokenProgram: noneMarker.toBase58(),
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
            { pubkey: noneMarker, isSigner: false, isWritable: false },     // vault_authority (None)
            { pubkey: noneMarker, isSigner: false, isWritable: false },     // vault (None)
            { pubkey: noneMarker, isSigner: false, isWritable: false },     // beneficiary_ata (None)
            { pubkey: noneMarker, isSigner: false, isWritable: false },     // mint (None)
            { pubkey: noneMarker, isSigner: false, isWritable: false },     // token_program (None)
            { pubkey: noneMarker, isSigner: false, isWritable: false },     // associated_token_program (None)
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: claimData,
        });
      } else {
        const beneficiaryAta = getAssociatedTokenAddressSync(mint, publicKey);
        // Derive vault as the ATA of vaultAuthority for this mint.
        // The prop may point to the wrong account for recipients added after a root
        // rotation whose vault address was never fetched from chain. Deriving here
        // guarantees the correct SPL token account regardless of what the caller passed.
        const derivedVault = getAssociatedTokenAddressSync(mint, vaultAuthority, true);
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
          vault: derivedVault.toBase58(),
          mint: mint.toBase58(),
          beneficiaryAta: beneficiaryAta.toBase58(),
        });

        namedAccounts = {
          beneficiary: publicKey.toBase58(),
          vestingTree: treePubkey.toBase58(),
          claimRecord: claimRecord.toBase58(),
          vaultAuthority: vaultAuthority.toBase58(),
          vault: derivedVault.toBase58(),
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
            { pubkey: derivedVault, isSigner: false, isWritable: true },
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

        if (
          programErr === "AccountNotFound" ||
          (typeof message === "string" && message.includes("AccountNotFound"))
        ) {
          toast(
            "Transaction failed: wallet account not found on-chain. " +
            "Ensure your wallet has SOL for transaction fees.",
            "error",
          );
          return;
        }

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
      if (sendTransaction) {
        console.log("[ClaimWithProofButton] using sendTransaction path");
        try {
          sig = await sendTransaction(claimTx, connection, {
            skipPreflight: false,
            preflightCommitment: "confirmed",
          });
        } catch (sendErr: unknown) {
          if (isWalletInternalSendError(sendErr) && signTransaction) {
            console.warn("[ClaimWithProofButton] sendTransaction failed, falling back to signTransaction", sendErr);
            const signedTx = await signTransaction(claimTx);
            sig = await connection.sendRawTransaction(signedTx.serialize(), {
              skipPreflight: false,
              preflightCommitment: "confirmed",
            });
          } else {
            throw sendErr;
          }
        }
      } else if (signTransaction) {
        console.log("[ClaimWithProofButton] using signTransaction + sendRawTransaction path");
        const signedTx = await signTransaction(claimTx);
        sig = await connection.sendRawTransaction(signedTx.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });
      } else {
        sig = await provider.sendAndConfirm(claimTx, []);
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
      const claimedAfterCurrent = (leafClaimedTotals[selectedIdx] ?? 0n) + selectedClaimableAmount;
      const currentLeafAmount = BigInt(String(selectedLeaf.amount));
      if (claimedAfterCurrent >= currentLeafAmount) {
        const nextUnclaimed = leaves.findIndex((_, i) => i !== selectedIdx && !leafFullyClaimed[i]);
        if (nextUnclaimed !== -1) setSelectedIdx(nextUnclaimed);
      }
      void queryClient.invalidateQueries({
        queryKey: ["claimRecord", treeAddress, beneficiaryAddress],
      });
      void queryClient.invalidateQueries({
        queryKey: ["beneficiaryCampaigns"],
      });
      const syncClaim = async (retries = 5) => {
        for (let i = 0; i < retries; i++) {
          try {
            const res = await fetch(`/api/events/sync`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ signature: sig }),
            });
            if (res.ok) {
              const data = (await res.json()) as { processed?: number };
              if ((data.processed ?? 0) > 0) {
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: ["campaign", treeAddress] }),
                  queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
                  queryClient.invalidateQueries({ queryKey: ["beneficiaryCampaigns"] }),
                  queryClient.invalidateQueries({ queryKey: ["claimHistory", treeAddress] }),
                ]);
                return;
              }
              console.warn("[ClaimWithProofButton] claim sync returned no events, retrying", {
                signature: sig,
                attempt: i + 1,
              });
            }
          } catch { /* retry */ }
          if (i < retries - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["campaign", treeAddress] }),
          queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
          queryClient.invalidateQueries({ queryKey: ["beneficiaryCampaigns"] }),
          queryClient.invalidateQueries({ queryKey: ["claimHistory", treeAddress] }),
        ]);
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
        className="w-full rounded-xl bg-violet-700 dark:bg-violet-600 py-3.5 text-[15px] font-semibold text-white transition hover:bg-violet-600 dark:hover:bg-violet-500 active:bg-violet-800 dark:active:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
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
        <p className="text-[12px] font-medium text-muted-foreground">
          {hasMilestones ? "Select milestone to claim" : "Select allocation to claim"}
        </p>
        <span className="text-[11px] text-muted-foreground">
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
                        : "border-foreground/[0.06] bg-foreground/[0.02] hover:border-violet-500/30 hover:bg-violet-500/5"
                  }`}
                >
                  <span className={`text-[11px] font-semibold ${
                    claimed ? "text-emerald-700 dark:text-emerald-400" : i === selectedIdx ? "text-violet-700 dark:text-violet-400" : "text-foreground"
                  }`}>
                    {isMilestone ? `#${entry.leaf.milestoneIdx}` : `#${entry.leaf.leafIndex}`}
                  </span>
                  <span className={`mt-0.5 text-[9px] ${
                    claimed
                      ? "text-emerald-700/60 dark:text-emerald-400/60"
                      : !milestoneReleased
                        ? "text-amber-700/60 dark:text-amber-400/60"
                        : claimableNow > 0n
                          ? "text-violet-700/80 dark:text-violet-400/80"
                          : "text-muted-foreground"
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
                className="rounded-md border border-foreground/[0.08] px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-foreground/[0.04] disabled:opacity-30"
              >
                Prev
              </button>
              <span className="text-[11px] text-muted-foreground">{page + 1}/{totalPages}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-md border border-foreground/[0.08] px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-foreground/[0.04] disabled:opacity-30"
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
                    ? "border-foreground/[0.04] bg-foreground/[0.01] text-muted-foreground cursor-not-allowed"
                    : i === selectedIdx
                    ? "border-violet-500/40 bg-violet-500/10 text-foreground"
                    : "border-foreground/[0.06] text-muted-foreground hover:border-foreground/[0.12]"
                }`}
              >
                <span>
                  {entry.leaf.releaseType === 2 ? `Milestone #${entry.leaf.milestoneIdx}` : `Leaf #${entry.leaf.leafIndex}`} — {fmtAmount(claimableNow.toString(), mintDecimals)} claimable
                </span>
                {claimed ? (
                  <span className="text-[10px] text-emerald-700 dark:text-emerald-400">Claimed</span>
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
