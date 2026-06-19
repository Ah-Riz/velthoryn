"use client";

import { useCallback } from "react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import BN from "bn.js";
import { useVestingProgram } from "@/hooks/useVestingProgram";
import { type CreateRootVersionRequest } from "@/lib/api/validators";
import { formatVestingError } from "@/lib/anchor/errors";
import { createAuthHeader } from "@/lib/api/client-auth";

export interface UpdateRootParams {
  treeAddress: string;
  payload: CreateRootVersionRequest;
}

export interface UpdateRootResult {
  sig: string;
  version: number | null;
  indexWarning: string | null;
}

/** Builds and sends `updateRoot` to rotate the campaign Merkle root, then saves the new root version to the API. */
export function useUpdateRoot() {
  const program = useVestingProgram();
  const { publicKey, sendTransaction, signMessage } = useWallet();
  const { connection } = useConnection();
  const queryClient = useQueryClient();

  const updateRoot = useCallback(
    async (params: UpdateRootParams): Promise<UpdateRootResult> => {
      if (!program || !publicKey) throw new Error("Wallet not connected");
      if (!signMessage) throw new Error("Your wallet does not support message signing. Use Phantom or Backpack.");

      const treePubkey = new PublicKey(params.treeAddress);
      const ix = await program.methods
        .updateRoot(
          Array.from(Buffer.from(params.payload.merkleRoot, "hex")),
          params.payload.leafCount,
          new BN(params.payload.minCliffTime),
        )
        .accounts({
          cancelAuthority: publicKey,
          vestingTree: treePubkey,
        })
        .instruction();
      const tx = new Transaction().add(ix);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      // Once the root rotates on-chain, every proof from the old root is invalid.
      // Evict the proof cache for all beneficiaries so ClaimWithProofButton and
      // "Your Position" both refetch from the new root_version.
      void queryClient.invalidateQueries({ queryKey: ["proof-all", params.treeAddress] });
      void queryClient.invalidateQueries({ queryKey: ["proof", params.treeAddress] });

      // Generate auth token AFTER on-chain confirmation so the nonce is fresh
      // at the moment of the POST. Generating it before a slow tx risks TTL expiry.
      const authHeader = await createAuthHeader({ publicKey, signMessage });

      let version: number | null = null;
      let indexWarning: string | null = null;

      try {
        const res = await fetch(`/api/campaigns/${params.treeAddress}/root-versions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify(params.payload),
        });

        if (!res.ok) {
          const body = await res.text();
          indexWarning = `Root updated on-chain, but indexing failed: ${body}`;
        } else {
          const body = (await res.json()) as { version?: number };
          version = typeof body.version === "number" ? body.version : null;

          try {
            await fetch("/api/events/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ signature: sig }),
            });
          } catch {
            indexWarning = "Root updated on-chain, but event sync failed.";
          }
        }
      } catch (error) {
        indexWarning =
          error instanceof Error
            ? `Root updated on-chain, but indexing failed: ${error.message}`
            : "Root updated on-chain, but indexing failed.";
      }

      return { sig, version, indexWarning };
    },
    [program, publicKey, signMessage, connection, sendTransaction, queryClient],
  );

  return { updateRoot, formatVestingError };
}
