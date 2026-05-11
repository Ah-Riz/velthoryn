import {
  AnchorProvider,
  Program,
  type Idl,
  BN,
} from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import IDL from "./idl.json";

const PROGRAM_ID = new PublicKey(
  "G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu",
);

export function getProvider(
  connection: Connection,
  wallet: WalletContextState,
): AnchorProvider {
  return new AnchorProvider(connection, wallet as never, {
    commitment: "confirmed",
  });
}

export function getProgram(provider: AnchorProvider): Program {
  return new Program(IDL as Idl, provider);
}

export function derivePda(
  seeds: (Buffer | Uint8Array | string)[],
  programId = PROGRAM_ID,
): [PublicKey, number] {
  const seedBuffers = seeds.map((s) =>
    typeof s === "string" ? Buffer.from(s) : s,
  );
  return PublicKey.findProgramAddressSync(seedBuffers, programId);
}

export { PROGRAM_ID, BN, IDL };
