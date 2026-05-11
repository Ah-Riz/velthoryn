import { AnchorProvider, Program, setProvider, workspace } from "@coral-xyz/anchor";
import { expect } from "chai";

const PROGRAM_ID = "G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu";

describe("vesting program scaffold", () => {
  setProvider(AnchorProvider.env());
  const program = workspace.Vesting as Program;

  it("loads with the expected program ID", () => {
    expect(program.programId.toBase58()).to.equal(PROGRAM_ID);
  });

  it("exposes all 12 architecture instructions in the IDL", () => {
    const expected = [
      "createCampaign",
      "createStream",
      "fundCampaign",
      "claim",
      "cancelCampaign",
      "updateRoot",
      "withdraw",
      "withdrawUnvested",
      "pauseCampaign",
      "unpauseCampaign",
      "closeClaimRecord",
      "getVestedAmount",
    ].sort();
    const actual = program.idl.instructions.map((i) => i.name).sort();
    expect(actual).to.deep.equal(expected);
  });
});
