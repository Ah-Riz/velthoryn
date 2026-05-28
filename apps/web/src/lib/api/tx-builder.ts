import { AnchorProvider, Program, type Idl, BN } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { IDL, PROGRAM_ID } from "@/lib/anchor/client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const GRACE_PERIOD_SECS = 604800n; // 7 * 24 * 60 * 60 — matches SC constants.rs

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface PreparedTransaction {
  transaction: string;                  // base58-encoded serialized unsigned tx
  signers: string[];                    // labels of required signers
  instruction: string;                  // instruction name for display
  accounts: Record<string, string>;     // account addresses involved
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getConnection(): Connection {
  return new Connection(process.env.NEXT_PUBLIC_RPC_ENDPOINT!, "confirmed");
}

function getProgram(): Program {
  const connection = getConnection();
  const wallet = {
    publicKey: PublicKey.default,
    signTransaction: async (): Promise<never> => {
      throw new Error("read-only provider");
    },
    signAllTransactions: async (): Promise<never> => {
      throw new Error("read-only provider");
    },
  };
  const provider = new AnchorProvider(connection, wallet as never, {
    commitment: "confirmed",
  });
  return new Program(IDL as Idl, provider);
}

async function buildRawTransaction(
  instructions: TransactionInstruction[],
  feePayer: PublicKey,
): Promise<string> {
  const connection = getConnection();
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = feePayer;
  tx.add(...instructions);

  const serialized = tx.serialize({ requireAllSignatures: false });
  return bs58.encode(serialized);
}

// ---------------------------------------------------------------------------
// PDA derivation helpers
// ---------------------------------------------------------------------------

export function deriveVestingTree(
  creator: PublicKey,
  mint: PublicKey,
  campaignId: bigint,
): PublicKey {
  const idBuffer = Buffer.alloc(8);
  idBuffer.writeBigUInt64LE(campaignId);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("tree"), creator.toBuffer(), mint.toBuffer(), idBuffer],
    PROGRAM_ID,
  );
  return pda;
}

export function deriveVaultAuthority(vestingTree: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), vestingTree.toBuffer()],
    PROGRAM_ID,
  );
  return pda;
}

export function deriveClaimRecord(
  vestingTree: PublicKey,
  beneficiary: PublicKey,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), vestingTree.toBuffer(), beneficiary.toBuffer()],
    PROGRAM_ID,
  );
  return pda;
}

// ---------------------------------------------------------------------------
// Instruction builders
// ---------------------------------------------------------------------------

export async function buildCancelCampaignTx(params: {
  vestingTree: PublicKey;
  cancelAuthority: PublicKey;
}): Promise<PreparedTransaction> {
  const program = getProgram();

  const instruction = await program.methods
    .cancelCampaign()
    .accounts({
      cancelAuthority: params.cancelAuthority,
      vestingTree: params.vestingTree,
    })
    .instruction();

  const transaction = await buildRawTransaction(
    [instruction],
    params.cancelAuthority,
  );

  return {
    transaction,
    signers: ["cancelAuthority"],
    instruction: "cancel_campaign",
    accounts: {
      vestingTree: params.vestingTree.toBase58(),
      cancelAuthority: params.cancelAuthority.toBase58(),
    },
  };
}

export async function buildWithdrawUnvestedTx(params: {
  vestingTree: PublicKey;
  creator: PublicKey;
  creatorAta: PublicKey;
  mint: PublicKey;
}): Promise<PreparedTransaction> {
  const program = getProgram();
  const vaultAuthority = deriveVaultAuthority(params.vestingTree);
  const vault = getAssociatedTokenAddressSync(params.mint, vaultAuthority, true);

  const instruction = await program.methods
    .withdrawUnvested()
    .accounts({
      creator: params.creator,
      vestingTree: params.vestingTree,
      vaultAuthority,
      vault,
      creatorAta: params.creatorAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const transaction = await buildRawTransaction([instruction], params.creator);

  return {
    transaction,
    signers: ["creator"],
    instruction: "withdraw_unvested",
    accounts: {
      vestingTree: params.vestingTree.toBase58(),
      vault: vault.toBase58(),
      creatorAta: params.creatorAta.toBase58(),
    },
  };
}

export async function buildCancelStreamTx(params: {
  vestingTree: PublicKey;
  creator: PublicKey;
  beneficiary: PublicKey;
  beneficiaryAta: PublicKey;
  creatorAta: PublicKey;
  mint: PublicKey;
  withdrawArgs: {
    releaseType: number;
    startTime: string;
    cliffTime: string;
    endTime: string;
    milestoneIdx: number;
  };
}): Promise<PreparedTransaction> {
  const program = getProgram();
  const vaultAuthority = deriveVaultAuthority(params.vestingTree);
  const vault = getAssociatedTokenAddressSync(params.mint, vaultAuthority, true);
  const claimRecord = deriveClaimRecord(params.vestingTree, params.beneficiary);

  const instruction = await program.methods
    .cancelStream({
      releaseType: params.withdrawArgs.releaseType,
      startTime: new BN(params.withdrawArgs.startTime),
      cliffTime: new BN(params.withdrawArgs.cliffTime),
      endTime: new BN(params.withdrawArgs.endTime),
      milestoneIdx: params.withdrawArgs.milestoneIdx,
    })
    .accounts({
      creator: params.creator,
      beneficiary: params.beneficiary,
      vestingTree: params.vestingTree,
      claimRecord,
      systemProgram: SystemProgram.programId,
      vaultAuthority,
      vault,
      beneficiaryAta: params.beneficiaryAta,
      creatorAta: params.creatorAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const transaction = await buildRawTransaction([instruction], params.creator);

  return {
    transaction,
    signers: ["creator"],
    instruction: "cancel_stream",
    accounts: {
      vestingTree: params.vestingTree.toBase58(),
      beneficiary: params.beneficiary.toBase58(),
      claimRecord: claimRecord.toBase58(),
      vault: vault.toBase58(),
      beneficiaryAta: params.beneficiaryAta.toBase58(),
      creatorAta: params.creatorAta.toBase58(),
    },
  };
}

export async function buildMilestoneReleaseTx(params: {
  vestingTree: PublicKey;
  creator: PublicKey;
  milestoneIdx: number;
}): Promise<PreparedTransaction> {
  const program = getProgram();

  const instruction = await program.methods
    .setMilestoneReleased(params.milestoneIdx)
    .accounts({
      creator: params.creator,
      vestingTree: params.vestingTree,
    })
    .instruction();

  const transaction = await buildRawTransaction([instruction], params.creator);

  return {
    transaction,
    signers: ["creator"],
    instruction: "set_milestone_released",
    accounts: {
      vestingTree: params.vestingTree.toBase58(),
      creator: params.creator.toBase58(),
    },
  };
}

export async function buildInstantRefundCampaignTx(params: {
  vestingTree: PublicKey;
  creator: PublicKey;
  mint: PublicKey;
  creatorAta?: PublicKey | null;
}): Promise<PreparedTransaction> {
  const program = getProgram();
  const isNative = params.mint.equals(PublicKey.default);

  const vaultAuthority = isNative ? undefined : deriveVaultAuthority(params.vestingTree);
  const vault = isNative
    ? undefined
    : getAssociatedTokenAddressSync(params.mint, vaultAuthority!, true);

  if (!isNative && !params.creatorAta) {
    throw new Error("creatorAta is required for SPL-token instant refund");
  }

  const instruction = await program.methods
    .instantRefundCampaign()
    // Optional accounts are omitted on native SOL path.
    .accounts({
      creator: params.creator,
      vestingTree: params.vestingTree,
      ...(isNative
        ? {
            systemProgram: SystemProgram.programId,
          }
        : {
            vaultAuthority,
            vault,
            creatorAta: params.creatorAta!,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          }),
    } as any)
    .instruction();

  const transaction = await buildRawTransaction([instruction], params.creator);

  return {
    transaction,
    signers: ["creator"],
    instruction: "instant_refund_campaign",
    accounts: {
      vestingTree: params.vestingTree.toBase58(),
      ...(isNative
        ? {}
        : {
            vault: vault!.toBase58(),
            creatorAta: params.creatorAta!.toBase58(),
          }),
    },
  };
}
