import { BN, Program, Wallet, Idl } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { startAnchor, Clock, ProgramTestContext } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";

import { PROGRAM_ID } from "./setup";

// ---------------------------------------------------------------------------
// startTest — bootstraps bankrun with the vesting program
// ---------------------------------------------------------------------------

export async function startTest() {
  const context = await startAnchor(
    ".", // path to Anchor project root
    [],  // no extra programs
    [],  // no extra accounts
  );

  const provider = new BankrunProvider(context);
  const idl: Idl = require("../../target/idl/vesting.json");
  const program = new Program(idl as any, provider as any);

  const creator = (provider.wallet as Wallet).payer;
  const cancelAuthority = Keypair.generate();
  const pauseAuthority = Keypair.generate();

  return { context, provider, program, creator, cancelAuthority, pauseAuthority };
}

// ---------------------------------------------------------------------------
// warpClock — set the validator clock to an exact unix timestamp
// ---------------------------------------------------------------------------

export async function warpClock(
  context: ProgramTestContext,
  unixTimestamp: number,
): Promise<void> {
  const currentClock = await context.banksClient.getClock();
  context.setClock(
    new Clock(
      currentClock.slot,
      BigInt(unixTimestamp),
      currentClock.epoch,
      currentClock.leaderScheduleEpoch,
      BigInt(unixTimestamp),
    ),
  );
}

// ---------------------------------------------------------------------------
// bankrunNow — get the current validator unix timestamp
// ---------------------------------------------------------------------------

export async function bankrunNow(context: ProgramTestContext): Promise<number> {
  const clock = await context.banksClient.getClock();
  return Number(clock.unixTimestamp);
}

// ---------------------------------------------------------------------------
// PDA helpers (same as setup.ts but exported directly for convenience)
// ---------------------------------------------------------------------------

export async function treePDA(
  programId: PublicKey,
  creator: PublicKey,
  mint: PublicKey,
  campaignId: BN | number,
): Promise<[PublicKey, number]> {
  const id = typeof campaignId === "number" ? new BN(campaignId) : campaignId;
  return PublicKey.findProgramAddress(
    [
      Buffer.from("tree"),
      creator.toBuffer(),
      mint.toBuffer(),
      id.toArrayLike(Buffer, "le", 8),
    ],
    programId,
  );
}

export async function claimRecordPDA(
  programId: PublicKey,
  tree: PublicKey,
  beneficiary: PublicKey,
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddress(
    [
      Buffer.from("claim"),
      tree.toBuffer(),
      beneficiary.toBuffer(),
    ],
    programId,
  );
}

export async function vaultAuthorityPDA(
  programId: PublicKey,
  tree: PublicKey,
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddress(
    [
      Buffer.from("vault_authority"),
      tree.toBuffer(),
    ],
    programId,
  );
}
