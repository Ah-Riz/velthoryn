import {
  AnchorProvider,
  Program,
  type Idl,
  BN,
} from "@coral-xyz/anchor";
import { Connection, PublicKey, type Signer } from "@solana/web3.js";

// Replace with generated IDL from `anchor build`
// import IDL from "./idl.json";

const PROGRAM_ID = new PublicKey(
  "7mGET6XMy7yqJqFVfSZ7zYxsLowJWXYhDmsMm8MHjdVv",
);

export function getProvider(connection: Connection, wallet: Signer) {
  return new AnchorProvider(connection, wallet as never, {
    commitment: "confirmed",
  });
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

export { PROGRAM_ID, BN };
