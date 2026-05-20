"use client";

import { useState } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { type Program } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { useProofLookup } from "@/hooks/useProofLookup";
import { toAnchorLeaf } from "@/lib/anchor/adapters";
import { derivePda } from "@/lib/anchor/client";
import { formatVestingError } from "@/lib/anchor/errors";

type Props = {
  program: Program;
  publicKey: PublicKey;
  treePubkey: PublicKey;
  treeAddress: string;
  mint: PublicKey;
  vault: PublicKey;
  vaultAuthority: PublicKey;
  onSuccess: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
};

export function ClaimWithProofButton({
  program,
  publicKey,
  treePubkey,
  treeAddress,
  mint,
  vault,
  vaultAuthority,
  onSuccess,
  toast,
}: Props) {
  const [loading, setLoading] = useState(false);
  const proofQuery = useProofLookup(treeAddress, publicKey.toBase58());

  if (proofQuery.isLoading) {
    return (
      <button disabled className="w-full rounded-xl bg-violet-600/50 py-3.5 text-[15px] font-semibold text-white/60 cursor-not-allowed">
        Loading proof...
      </button>
    );
  }

  if (proofQuery.isError || !proofQuery.data) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[13px] text-[#555d73]">
        Merkle proof not available — contact campaign creator to index recipients.
      </div>
    );
  }

  const { leaf, proof } = proofQuery.data;

  async function handleClaim() {
    setLoading(true);
    try {
      const anchorLeaf = toAnchorLeaf({
        ...leaf,
        amount: String(leaf.amount),
      });

      const proofBytes: number[][] = proof.map((p: number[]) =>
        Array.isArray(p) ? p : Array.from(p),
      );

      const [claimRecord] = derivePda([
        "claim",
        treePubkey.toBuffer(),
        publicKey.toBuffer(),
      ]);

      const beneficiaryAta = getAssociatedTokenAddressSync(mint, publicKey);

      await program.methods
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
      onSuccess();
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        /User rejected|Connection rejected/i.test(err.message)
      )
        return;
      const msg = formatVestingError(err);
      toast(msg, "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClaim}
      disabled={loading}
      className="w-full rounded-xl bg-violet-600 py-3.5 text-[15px] font-semibold text-white transition hover:bg-violet-500 active:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {loading ? "Claiming..." : "Claim Tokens (Merkle)"}
    </button>
  );
}
