"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  NATIVE_MINT,
  getAssociatedTokenAddressSync,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import {
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  PublicKey,
} from "@solana/web3.js";

export function useWrapSol() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [solBalance, setSolBalance] = useState<number>(0);
  const [wsolBalance, setWsolBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBalances = useCallback(async () => {
    if (!publicKey) return;
    try {
      const sol = await connection.getBalance(publicKey);
      setSolBalance(sol / LAMPORTS_PER_SOL);

      const ata = getAssociatedTokenAddressSync(NATIVE_MINT, publicKey);
      try {
        const account = await getAccount(connection, ata);
        setWsolBalance(Number(account.amount) / LAMPORTS_PER_SOL);
      } catch {
        setWsolBalance(0);
      }
    } catch {
      // ignore
    }
  }, [connection, publicKey]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  const wrapSol = useCallback(
    async (amount: number): Promise<boolean> => {
      if (!publicKey || !sendTransaction) {
        setError("Wallet not connected");
        return false;
      }
      if (amount <= 0) {
        setError("Amount must be greater than 0");
        return false;
      }
      if (amount > solBalance - 0.003) {
        setError("Insufficient SOL (need ~0.003 SOL for rent + fees)");
        return false;
      }

      setIsLoading(true);
      setError(null);

      try {
        const ata = getAssociatedTokenAddressSync(NATIVE_MINT, publicKey);
        const lamports = Math.floor(amount * LAMPORTS_PER_SOL);

        const tx = new Transaction();

        // Check if ATA exists, if not create it
        const ataInfo = await connection.getAccountInfo(ata);
        if (!ataInfo) {
          const { createAssociatedTokenAccountInstruction } = await import("@solana/spl-token");
          tx.add(createAssociatedTokenAccountInstruction(publicKey, ata, publicKey, NATIVE_MINT));
        }

        // Transfer SOL to ATA
        tx.add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: ata,
            lamports,
          }),
        );

        // Sync native to update wSOL balance
        tx.add(createSyncNativeInstruction(ata));

        const sig = await sendTransaction(tx, connection);
        await connection.confirmTransaction(sig, "confirmed");

        await fetchBalances();
        setIsLoading(false);
        return true;
      } catch (err: unknown) {
        if (err instanceof Error && /User rejected|rejected/i.test(err.message)) {
          setError("Transaction rejected by wallet");
        } else {
          setError(err instanceof Error ? err.message : "Wrap failed");
        }
        setIsLoading(false);
        return false;
      }
    },
    [publicKey, sendTransaction, connection, solBalance, fetchBalances],
  );

  const unwrapSol = useCallback(async (): Promise<boolean> => {
    if (!publicKey || !sendTransaction) {
      setError("Wallet not connected");
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      const ata = getAssociatedTokenAddressSync(NATIVE_MINT, publicKey);
      const tx = new Transaction().add(
        createCloseAccountInstruction(ata, publicKey, publicKey),
      );

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      await fetchBalances();
      setIsLoading(false);
      return true;
    } catch (err: unknown) {
      if (err instanceof Error && /User rejected|rejected/i.test(err.message)) {
        setError("Transaction rejected by wallet");
      } else {
        setError(err instanceof Error ? err.message : "Unwrap failed");
      }
      setIsLoading(false);
      return false;
    }
  }, [publicKey, sendTransaction, connection, fetchBalances]);

  return { solBalance, wsolBalance, wrapSol, unwrapSol, isLoading, error, setError, fetchBalances };
}
