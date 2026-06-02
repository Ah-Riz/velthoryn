"use client";

import { useCallback } from "react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useVestingProgram } from "@/hooks/useVestingProgram";
import { type CreateRootVersionRequest } from "@/lib/api/validators";
import { formatVestingError } from "@/lib/anchor/errors";

export interface UpdateRootParams {
  treeAddress: string;
  payload: CreateRootVersionRequest;
}

export interface UpdateRootResult {
  sig: string;
  version: number | null;
  indexWarning: string | null;
}

export function useUpdateRoot() {
  const program = useVestingProgram();
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const updateRoot = useCallback(
    async (params: UpdateRootParams): Promise<UpdateRootResult> => {
      if (!program || !publicKey) throw new Error("Wallet not connected");

      const treePubkey = new PublicKey(params.treeAddress);
      const ix = await program.methods
        .updateRoot(Array.from(Buffer.from(params.payload.merkleRoot, "hex")), params.payload.leafCount)
        .accounts({
          cancelAuthority: publicKey,
          vestingTree: treePubkey,
        })
        .instruction();
      const tx = new Transaction().add(ix);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      let version: number | null = null;
      let indexWarning: string | null = null;

      try {
        const res = await fetch(`/api/campaigns/${params.treeAddress}/root-versions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params.payload),
        });

        if (!res.ok) {
          const body = await res.text();
          indexWarning = `Root updated on-chain, but indexing failed: ${body}`;
        } else {
          const body = (await res.json()) as { version?: number };
          version = typeof body.version === "number" ? body.version : null;
        }
      } catch (error) {
        indexWarning =
          error instanceof Error
            ? `Root updated on-chain, but indexing failed: ${error.message}`
            : "Root updated on-chain, but indexing failed.";
      }

      return { sig, version, indexWarning };
    },
    [program, publicKey, connection, sendTransaction],
  );

  return { updateRoot, formatVestingError };
}
