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
      const ix = await program.methods
        .closeClaimRecord()
        .accounts({
          beneficiary: publicKey,
          vestingTree: treePubkey,
          claimRecord: claimRecordPda,
        })
        .instruction();
      const tx = new Transaction().add(ix);
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
      className="w-full rounded-xl border border-white/[0.06] py-2.5 text-[12px] font-medium text-[#8b92a5] transition hover:border-white/[0.12] hover:text-white disabled:opacity-50"
    >
      {loading ? "Closing..." : "Close Record & Reclaim Rent (~0.002 SOL)"}
    </button>
  );
}
