import * as anchor from "@coral-xyz/anchor";

describe("vesting", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  it("program deployed successfully", async () => {
    const program = anchor.workspace.vesting;
    console.log("Program ID:", program.programId.toBase58());
  });
});
