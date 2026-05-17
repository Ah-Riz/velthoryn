const anchor = require("@coral-xyz/anchor");
const {
  createMint,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAccount,
} = require("@solana/spl-token");
const { Transaction } = require("@solana/web3.js");
const { PublicKey } = require("@solana/web3.js");
const BN = require("bn.js");
const idl = require("../target/idl/vesting.json");

(async () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new anchor.Program(idl, provider);
  const payer = provider.wallet.payer;
  const PROGRAM_ID = new PublicKey(
    "G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu",
  );
  const mint = await createMint(
    provider.connection,
    payer,
    payer.publicKey,
    payer.publicKey,
    9,
  );
  const info = await provider.connection.getAccountInfo(mint);
  console.log(
    "mint",
    mint.toBase58(),
    "exists",
    !!info,
    "owner",
    info?.owner?.toBase58(),
  );

  const campaignId = new BN(9999);
  const [treePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("tree"),
      payer.publicKey.toBuffer(),
      mint.toBuffer(),
      campaignId.toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID,
  );
  const [vaultAuthPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), treePda.toBuffer()],
    PROGRAM_ID,
  );
  const vault = getAssociatedTokenAddressSync(mint, vaultAuthPda, true);
  const sourceAta = getAssociatedTokenAddressSync(mint, payer.publicKey);

  const setupTx = new Transaction();
  try {
    await getAccount(provider.connection, sourceAta);
  } catch {
    setupTx.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        sourceAta,
        payer.publicKey,
        mint,
      ),
    );
  }
  setupTx.add(
    createMintToInstruction(mint, sourceAta, payer.publicKey, 10000),
  );
  if (setupTx.instructions.length) {
    await provider.sendAndConfirm(setupTx, [payer]);
  }
  console.log("sourceAta funded", (await getAccount(provider.connection, sourceAta)).amount.toString());

  const ix = await program.methods
    .createStream({
      campaignId,
      beneficiary: payer.publicKey,
      amount: new BN(10000),
      releaseType: 1,
      startTime: new BN(Math.floor(Date.now() / 1000)),
      cliffTime: new BN(Math.floor(Date.now() / 1000)),
      endTime: new BN(Math.floor(Date.now() / 1000) + 1000),
      milestoneIdx: 0,
      cancellable: true,
      cancelAuthority: payer.publicKey,
      pauseAuthority: null,
    })
    .accounts({
      creator: payer.publicKey,
      vestingTree: treePda,
      vaultAuthority: vaultAuthPda,
      vault,
      sourceAta,
      mint,
    })
    .instruction();

  ix.keys.forEach((k, i) => {
    console.log(
      i,
      k.pubkey.toBase58(),
      "signer",
      k.isSigner,
      "writable",
      k.isWritable,
    );
  });

  try {
    const sig = await program.methods
      .createStream({
        campaignId,
        beneficiary: payer.publicKey,
        amount: new BN(10000),
        releaseType: 1,
        startTime: new BN(Math.floor(Date.now() / 1000)),
        cliffTime: new BN(Math.floor(Date.now() / 1000)),
        endTime: new BN(Math.floor(Date.now() / 1000) + 1000),
        milestoneIdx: 0,
        cancellable: true,
        cancelAuthority: payer.publicKey,
        pauseAuthority: null,
      })
      .accounts({
        creator: payer.publicKey,
        vestingTree: treePda,
        vaultAuthority: vaultAuthPda,
        vault,
        sourceAta,
        mint,
      })
      .rpc();
    console.log("SUCCESS", sig);
  } catch (e) {
    console.log("FAIL", e.message);
    if (e.logs) {
      console.log(e.logs.filter((l) => l.includes("mint") || l.includes("Anchor")).join("\n"));
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
