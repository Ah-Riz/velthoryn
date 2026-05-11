import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program, setProvider, workspace } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createAccount,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";

// ---------------------------------------------------------------------------
// Program ID
// ---------------------------------------------------------------------------

export const PROGRAM_ID = new PublicKey(
  "G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu"
);

// ---------------------------------------------------------------------------
// Types returned by setup()
// ---------------------------------------------------------------------------

export interface TestSetup {
  provider: AnchorProvider;
  program: Program;
  creator: Keypair;
  cancelAuthority: Keypair;
  pauseAuthority: Keypair;
}

// ---------------------------------------------------------------------------
// setup — bootstraps the Anchor provider, loads the program, funds helpers
// ---------------------------------------------------------------------------

export function setup(): TestSetup {
  const provider = AnchorProvider.env();
  setProvider(provider);

  const program = workspace.Vesting as Program;
  const creator = (provider.wallet as anchor.Wallet).payer;
  const cancelAuthority = Keypair.generate();
  const pauseAuthority = Keypair.generate();

  return {
    provider,
    program,
    creator,
    cancelAuthority,
    pauseAuthority,
  };
}

// ---------------------------------------------------------------------------
// airdrop — transfer SOL from the wallet payer (avoids devnet faucet limits)
// ---------------------------------------------------------------------------

export async function airdrop(
  provider: AnchorProvider,
  pubkey: PublicKey,
  sol: number
): Promise<void> {
  const payer = (provider.wallet as anchor.Wallet).payer;
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: pubkey,
      lamports: sol * LAMPORTS_PER_SOL,
    })
  );
  await provider.sendAndConfirm(tx, [payer]);
}

// ---------------------------------------------------------------------------
// createTestMint — create an SPL token mint with 9 decimals
// ---------------------------------------------------------------------------

export async function createTestMint(
  provider: AnchorProvider,
  authority: PublicKey
): Promise<PublicKey> {
  return createMint(
    provider.connection,
    (provider.wallet as anchor.Wallet).payer,
    authority,
    authority,
    9
  );
}

// ---------------------------------------------------------------------------
// fundCreatorAta — create ATA for `owner`, mint `amount` tokens, return ATA
// ---------------------------------------------------------------------------

export async function fundCreatorAta(
  provider: AnchorProvider,
  mint: PublicKey,
  owner: PublicKey,
  amount: number | BN
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  const mintAmount = typeof amount === "number" ? new BN(amount) : amount;
  const payer = (provider.wallet as anchor.Wallet).payer;

  try {
    await getAccount(provider.connection, ata);
  } catch {
    await createAccount(provider.connection, payer, mint, owner);
  }

  await mintTo(provider.connection, payer, mint, ata, payer, mintAmount.toNumber());

  return ata;
}

// ---------------------------------------------------------------------------
// makeBeneficiary — generate a new keypair and airdrop 1 SOL
// ---------------------------------------------------------------------------

export async function makeBeneficiary(
  provider: AnchorProvider
): Promise<Keypair> {
  const kp = Keypair.generate();
  await airdrop(provider, kp.publicKey, 0.01);
  return kp;
}

// ---------------------------------------------------------------------------
// PDA derivations
// ---------------------------------------------------------------------------

export async function treePDA(
  programId: PublicKey,
  creator: PublicKey,
  mint: PublicKey,
  campaignId: BN | number
): Promise<[PublicKey, number]> {
  const id = typeof campaignId === "number" ? new BN(campaignId) : campaignId;
  return PublicKey.findProgramAddress(
    [
      Buffer.from("tree"),
      creator.toBuffer(),
      mint.toBuffer(),
      id.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
}

export async function claimRecordPDA(
  programId: PublicKey,
  tree: PublicKey,
  beneficiary: PublicKey
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddress(
    [
      Buffer.from("claim"),
      tree.toBuffer(),
      beneficiary.toBuffer(),
    ],
    programId
  );
}

export async function vaultAuthorityPDA(
  programId: PublicKey,
  tree: PublicKey
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddress(
    [
      Buffer.from("vault_authority"),
      tree.toBuffer(),
    ],
    programId
  );
}
