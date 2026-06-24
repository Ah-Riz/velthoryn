"use client";

import { useState } from "react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { type Program } from "@coral-xyz/anchor";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { derivePda } from "@/lib/anchor/client";
import { formatVestingError, isWalletCancellation } from "@/lib/anchor/errors";
import { isNativeSol } from "@/lib/sol/auto-wrap";

type Props = {
  program: Program;
  publicKey: PublicKey;
  treePubkey: PublicKey;
  mint: PublicKey;
  totalEntitled: bigint;
  claimedAmount: bigint;
  cancelledAt: bigint | null;
  nowTs: bigint;
  onSuccess: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
};

const GRACE_PERIOD = 604800n; // 7 days

export function CloseClaimRecordButton({
  program,
  publicKey,
  treePubkey,
  mint,
  totalEntitled,
  claimedAmount,
  cancelledAt,
  nowTs,
  onSuccess,
  toast,
}: Props) {
  const { sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [loading, setLoading] = useState(false);

  const fullyClaimed = totalEntitled > 0n && claimedAmount >= totalEntitled;
  const postGrace = cancelledAt !== null && nowTs >= cancelledAt + GRACE_PERIOD;

  if (!fullyClaimed && !postGrace) return null;

  async function handleClose() {
    setLoading(true);
    try {
      const [claimRecordPda] = derivePda(["claim", treePubkey.toBuffer(), publicKey.toBuffer()]);

      // Check both accounts in parallel
      const [claimRecordInfo, vestingTreeInfo] = await Promise.all([
        connection.getAccountInfo(claimRecordPda),
        connection.getAccountInfo(treePubkey),
      ]);

      // Claim record checks
      if (!claimRecordInfo) {
        toast("Claim record not found on-chain. It may have already been closed.", "info");
        return;
      }
      if (!claimRecordInfo.owner.equals(program.programId)) {
        toast("Claim record has already been closed. Rent was already reclaimed.", "info");
        return;
      }

      // VestingTree must exist — if it doesn't, the SC instruction will fail with
      // AccountNotInitialized (3012) because vesting_tree is a required account.
      // This happens specifically with native SOL campaigns: the final claim drains
      // ALL lamports from the VestingTree PDA to zero, which destroys the account.
      // SPL campaigns are not affected since VestingTree keeps its own rent.
      if (!vestingTreeInfo || !vestingTreeInfo.owner.equals(program.programId)) {
        if (isNativeSol(mint)) {
          toast(
            "This campaign's SOL vault was fully claimed. The campaign account was destroyed in the process, " +
            "which is a known limitation of native SOL campaigns — claim record rent (~0.002 SOL) cannot be reclaimed on-chain.",
            "error",
          );
        } else {
          toast(
            "Campaign account not found on-chain. The claim record cannot be closed.",
            "error",
          );
        }
        return;
      }

      const ix = await program.methods
        .closeClaimRecord()
        .accounts({
          beneficiary: publicKey,
          vestingTree: treePubkey,
          claimRecord: claimRecordPda,
        })
        .instruction();
      const tx = new Transaction().add(ix);

      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
      tx.feePayer = publicKey;
      const sim = await connection.simulateTransaction(tx);
      if (sim.value.err) {
        const logs = sim.value.logs ?? [];
        const logsStr = logs.join("\n");
        const errStr = JSON.stringify(sim.value.err);

        if (logsStr.includes("AccountNotInitialized") || errStr.includes("AccountNotInitialized")) {
          toast("Campaign account no longer exists on-chain. Claim record rent cannot be reclaimed.", "error");
          return;
        }

        const formatted = formatVestingError({ message: [logsStr, errStr].join("\n") });
        if (formatted !== "Transaction failed. Please try again.") {
          toast(formatted, "error");
          return;
        }
        toast("Close record failed. The record may not be eligible for closing yet.", "error");
        return;
      }

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      toast("Claim record closed. Rent reclaimed.", "success");
      onSuccess();
    } catch (err: unknown) {
      if (isWalletCancellation(err)) return;
      toast(formatVestingError(err), "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClose}
      disabled={loading}
      className="w-full rounded-xl border border-foreground/[0.06] py-2.5 text-[12px] font-medium text-muted-foreground transition hover:border-foreground/[0.12] hover:text-foreground disabled:opacity-50"
    >
      {loading ? "Closing..." : "Close Record & Reclaim Rent (~0.002 SOL)"}
    </button>
  );
}
