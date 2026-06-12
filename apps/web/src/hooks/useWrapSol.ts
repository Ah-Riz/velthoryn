"use client";

import { useCallback, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  NATIVE_MINT,
  getAssociatedTokenAddressSync,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  createTransferInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

export function useWrapSol() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [solBalance, setSolBalance] = useState<number>(0);
  const [wsolBalance, setWsolBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchInFlightRef = useRef<Promise<void> | null>(null);
  const lastFetchAtRef = useRef(0);

  const fetchBalances = useCallback(async () => {
    if (!publicKey) return;
    const now = Date.now();
    if (fetchInFlightRef.current) {
      await fetchInFlightRef.current;
      return;
    }
    if (now - lastFetchAtRef.current < 1500) {
      return;
    }

    const run = (async () => {
      setBalancesLoading(true);
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
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch balances");
      } finally {
        setBalancesLoading(false);
        lastFetchAtRef.current = Date.now();
      }
    })();

    fetchInFlightRef.current = run;
    try {
      await run;
    } finally {
      fetchInFlightRef.current = null;
    }
  }, [connection, publicKey]);

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

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = publicKey;

        const sig = await sendTransaction(tx, connection);
        await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

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

  const unwrapSol = useCallback(async (amount?: number): Promise<boolean> => {
    if (!publicKey || !sendTransaction) {
      setError("Wallet not connected");
      return false;
    }

    const isFullUnwrap = !amount || amount >= wsolBalance;

    if (!isFullUnwrap && amount <= 0) {
      setError("Amount must be greater than 0");
      return false;
    }
    if (!isFullUnwrap && amount > wsolBalance) {
      setError("Insufficient wSOL balance");
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      const ata = getAssociatedTokenAddressSync(NATIVE_MINT, publicKey);
      const tx = new Transaction();

      if (isFullUnwrap) {
        tx.add(createCloseAccountInstruction(ata, publicKey, publicKey));
      } else {
        const lamports = BigInt(Math.floor(amount * LAMPORTS_PER_SOL));
        const tempKeypair = Keypair.generate();
        const rentExempt = await connection.getMinimumBalanceForRentExemption(165);

        tx.add(
          SystemProgram.createAccount({
            fromPubkey: publicKey,
            newAccountPubkey: tempKeypair.publicKey,
            lamports: rentExempt,
            space: 165,
            programId: TOKEN_PROGRAM_ID,
          }),
        );

        const { createInitializeAccountInstruction } = await import("@solana/spl-token");
        tx.add(
          createInitializeAccountInstruction(tempKeypair.publicKey, NATIVE_MINT, publicKey),
        );

        tx.add(
          createTransferInstruction(ata, tempKeypair.publicKey, publicKey, lamports),
        );

        tx.add(
          createCloseAccountInstruction(tempKeypair.publicKey, publicKey, publicKey),
        );

        const { blockhash: bh2, lastValidBlockHeight: lvbh2 } = await connection.getLatestBlockhash();
        tx.recentBlockhash = bh2;
        tx.feePayer = publicKey;

        const sig = await sendTransaction(tx, connection, { signers: [tempKeypair] });
        await connection.confirmTransaction({ signature: sig, blockhash: bh2, lastValidBlockHeight: lvbh2 }, "confirmed");
        await fetchBalances();
        setIsLoading(false);
        return true;
      }

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

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
  }, [publicKey, sendTransaction, connection, fetchBalances, wsolBalance]);

  return { solBalance, wsolBalance, wrapSol, unwrapSol, isLoading, balancesLoading, error, setError, fetchBalances };
}
