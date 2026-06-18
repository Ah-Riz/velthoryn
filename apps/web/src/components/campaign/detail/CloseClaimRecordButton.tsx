"use client";

import { useState } from "react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { type Program } from "@coral-xyz/anchor";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { derivePda } from "@/lib/anchor/client";
import { formatVestingError } from "@/lib/anchor/errors";

type Props = {
  program: Program;
  publicKey: PublicKey;
  treePubkey: PublicKey;
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

      // Verify claim record exists on-chain before sending
      const accountInfo = await connection.getAccountInfo(claimRecordPda);
      if (!accountInfo) {
        toast("Claim record not found on-chain. It may already be closed.", "error");
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

      // Simulate first to get detailed error logs
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
      tx.feePayer = publicKey;
      const sim = await connection.simulateTransaction(tx);
      if (sim.value.err) {
        const logs = sim.value.logs ?? [];
        const programLog = logs.find((l) => l.includes("Error Code:") || l.includes("error:"));
        const msg = programLog
          ? programLog.replace(/^.*Error Code:\s*/, "").replace(/^.*error:\s*/, "")
          : "Transaction simulation failed";
        toast(msg, "error");
        return;
      }

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      toast("Claim record closed. Rent reclaimed.", "success");
      onSuccess();
    } catch (err: unknown) {
      if (err instanceof Error && /User rejected|Connection rejected/i.test(err.message)) return;
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
