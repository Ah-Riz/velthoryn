"use client";

import { useState } from "react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { type Program } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { getGracePeriodState } from "@/lib/vesting/display";
import { isNativeSol } from "@/lib/sol/auto-wrap";

type Props = {
  program: Program;
  publicKey: PublicKey;
  treePubkey: PublicKey;
  mint: PublicKey;
  vaultAuthority: PublicKey;
  vault: PublicKey;
  cancelledAt: bigint | null;
  isCreator: boolean;
  nowTs: bigint;
  onSuccess: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
};

export function WithdrawUnvestedButton({
  program,
  publicKey,
  treePubkey,
  mint,
  vaultAuthority,
  vault,
  cancelledAt,
  isCreator,
  nowTs,
  onSuccess,
  toast,
}: Props) {
  const { sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!isCreator || cancelledAt === null) return null;

  const grace = getGracePeriodState(cancelledAt, nowTs);

  async function handleWithdraw() {
    setLoading(true);
    try {
      if (isNativeSol(mint)) {
        const ix = await program.methods
          .withdrawUnvested()
          .accountsPartial({
            creator: publicKey,
            vestingTree: treePubkey,
            systemProgram: SystemProgram.programId,
          })
          .instruction();
        const tx = new Transaction().add(ix);
        await sendTransaction(tx, connection);
      } else {
        const creatorAta = getAssociatedTokenAddressSync(mint, publicKey);

        const ix = await program.methods
          .withdrawUnvested()
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
        const tx = new Transaction().add(ix);
        await sendTransaction(tx, connection);
      }

      toast("Unvested tokens withdrawn.", "success");
      setConfirmOpen(false);
      onSuccess();
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        /User rejected|Connection rejected/i.test(err.message)
      ) {
        return;
      }
      toast(
        err instanceof Error ? err.message : "Failed to withdraw unvested",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }

  if (grace.status === "grace_active") {
    return (
      <button
        disabled
        className="cursor-not-allowed w-full rounded-xl border border-white/[0.06] py-2.5 text-[13px] font-medium text-[#555d73]"
      >
        Withdraw Unvested — available in {grace.countdown}
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => setConfirmOpen(true)}
        className="w-full rounded-xl border border-amber-500/20 py-2.5 text-[13px] font-medium text-amber-400 transition hover:border-amber-500/40 hover:bg-amber-500/5"
      >
        Withdraw Unvested Tokens
      </button>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md space-y-4 rounded-2xl border border-white/[0.08] bg-[#0d1017] p-6">
            <h3 className="text-[15px] font-medium text-amber-400">
              Withdraw Unvested Tokens?
            </h3>
            <p className="text-[13px] text-[#8b92a5]">
              This will transfer all remaining unvested tokens from the vault back to your wallet.
              Recipients can still claim any tokens that were vested before cancellation.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={loading}
                className="flex-1 rounded-xl border border-white/[0.08] py-2.5 text-[13px] text-[#8b92a5] transition hover:bg-white/[0.04] disabled:opacity-50"
              >
                Go Back
              </button>
              <button
                onClick={handleWithdraw}
                disabled={loading}
                className="flex-1 rounded-xl bg-amber-600 py-2.5 text-[13px] font-medium text-white transition hover:bg-amber-500 disabled:opacity-50"
              >
                {loading ? "Withdrawing..." : "Confirm Withdraw"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
