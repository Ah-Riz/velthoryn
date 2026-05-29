"use client";

import { useCallback } from "react";
import { PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram, Transaction } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useVestingProgram } from "@/hooks/useVestingProgram";
import { derivePda } from "@/lib/anchor/client";
import { formatVestingError } from "@/lib/anchor/errors";
import { toRawAmount } from "@/lib/campaign/bulk";
import {
  buildCreateStreamIndexPayload,
  indexCampaign,
  saveStreamScheduleLocal,
} from "@/lib/stream/persist";
import { buildWrapSolInstructions, isNativeSol, solToLamports } from "@/lib/sol/auto-wrap";

export interface CreateStreamParams {
  beneficiary: string;
  mintAddress: string;
  amount: string;
  mintDecimals: number | null;
  campaignId: string;
  releaseType: number;
  startTime: number;
  cliffTime: number;
  endTime: number;
  milestoneIdx: number;
  cancellable: boolean;
  autoWrap?: boolean;
}

export interface CreateStreamResult {
  sig: string;
  treeAddress: string;
  shareUrl: string;
  indexWarning: string | null;
}

export function useCreateStream() {
  const program = useVestingProgram();
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const createStream = useCallback(
    async (params: CreateStreamParams): Promise<CreateStreamResult> => {
      if (!program || !publicKey) throw new Error("Wallet not connected");

      const beneficiaryKey = new PublicKey(params.beneficiary);
      const mintKey = new PublicKey(params.mintAddress);
      const nativeSol = isNativeSol(mintKey);
      const rawAmount =
        params.mintDecimals !== null
          ? toRawAmount(params.amount, params.mintDecimals)
          : params.amount;
      const campaignIdBN = new BN(params.campaignId);

      const [vestingTree] = derivePda([
        "tree",
        publicKey.toBuffer(),
        mintKey.toBuffer(),
        campaignIdBN.toArrayLike(Buffer, "le", 8),
      ]);
      const [vaultAuthority] = derivePda(["vault_authority", vestingTree.toBuffer()]);
      const sourceAta = getAssociatedTokenAddressSync(mintKey, publicKey);
      const vault = getAssociatedTokenAddressSync(mintKey, vaultAuthority, true);

      const needsWrap = params.autoWrap === true && !nativeSol;
      const args = {
        campaignId: campaignIdBN,
        beneficiary: beneficiaryKey,
        amount: new BN(rawAmount),
        releaseType: params.releaseType,
        startTime: new BN(params.startTime),
        cliffTime: new BN(params.cliffTime),
        endTime: new BN(params.endTime),
        milestoneIdx: params.milestoneIdx,
        cancellable: params.cancellable,
        cancelAuthority: params.cancellable ? publicKey : null,
        pauseAuthority: publicKey,
      };

      let sig: string;

      if (nativeSol) {
        const createIx = await program.methods
          .createStreamNative(args)
          .accounts({
            creator: publicKey,
            vestingTree,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .instruction();
        const createTx = new Transaction().add(createIx);
        sig = await sendTransaction(createTx, connection);
        await connection.confirmTransaction(sig, "confirmed");
      } else if (needsWrap) {
        const lamports = solToLamports(rawAmount, 0);
        const wrapIxs = await buildWrapSolInstructions(connection, publicKey, lamports);

        const createStreamIx = await program.methods
          .createStream(args)
          .accounts({
            creator: publicKey,
            vestingTree,
            vaultAuthority,
            vault,
            sourceAta,
            mint: mintKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .instruction();

        const tx = new Transaction();
        for (const ix of wrapIxs) tx.add(ix);
        tx.add(createStreamIx);

        sig = await sendTransaction(tx, connection);
        await connection.confirmTransaction(sig, "confirmed");
      } else {
        const createIx = await program.methods
          .createStream(args)
          .accounts({
            creator: publicKey,
            vestingTree,
            vaultAuthority,
            vault,
            sourceAta,
            mint: mintKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .instruction();
        const createTx = new Transaction().add(createIx);
        sig = await sendTransaction(createTx, connection);
        await connection.confirmTransaction(sig, "confirmed");
      }

      const treeAddress = vestingTree.toBase58();

      saveStreamScheduleLocal(treeAddress, {
        releaseType: params.releaseType,
        startTime: params.startTime,
        cliffTime: params.cliffTime,
        endTime: params.endTime,
        milestoneIdx: params.milestoneIdx,
        beneficiary: beneficiaryKey.toBase58(),
        amount: rawAmount,
      });

      let indexWarning: string | null = null;

      try {
        await indexCampaign(
          buildCreateStreamIndexPayload({
            treeAddress,
            creator: publicKey.toBase58(),
            mint: mintKey.toBase58(),
            campaignId: Number(params.campaignId),
            beneficiary: beneficiaryKey.toBase58(),
            amount: rawAmount,
            releaseType: params.releaseType,
            startTime: params.startTime,
            cliffTime: params.cliffTime,
            endTime: params.endTime,
            milestoneIdx: params.milestoneIdx,
            cancellable: params.cancellable,
            cancelAuthority: params.cancellable ? publicKey.toBase58() : null,
            pauseAuthority: publicKey.toBase58(),
          }),
        );
      } catch (error) {
        indexWarning =
          error instanceof Error
            ? `Stream created on-chain, but DB indexing failed and was queued for retry: ${error.message}`
            : "Stream created on-chain, but DB indexing failed and was queued for retry.";
      }

      const urlParams = new URLSearchParams({
        rt: String(params.releaseType),
        st: String(params.startTime),
        ct: String(params.cliffTime),
        et: String(params.endTime),
        mi: String(params.milestoneIdx),
        bf: beneficiaryKey.toBase58(),
      });

      return {
        sig,
        treeAddress,
        shareUrl: `/campaign/${treeAddress}?${urlParams}`,
        indexWarning,
      };
    },
    [program, publicKey, connection, sendTransaction],
  );

  return { createStream, formatVestingError };
}
