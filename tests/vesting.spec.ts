import { AnchorProvider, Program, setProvider, workspace } from "@coral-xyz/anchor";
import { expect } from "chai";

const PROGRAM_ID = "G6iaigUdi2btFwUc2N65twfxwA8Ew5uKKhKJ5RJa8wvu";

describe("vesting program scaffold", () => {
  setProvider(AnchorProvider.env());
  const program = workspace.Vesting as Program;

  it("loads with the expected program ID", () => {
    expect(program.programId.toBase58()).to.equal(PROGRAM_ID);
  });

  it("exposes all 14 architecture instructions in the IDL", () => {
    const expected = [
      "cancelCampaign",
      "cancelStream",
      "claim",
      "closeClaimRecord",
      "createCampaign",
      "createStream",
      "fundCampaign",
      "getVestedAmount",
      "pauseCampaign",
      "setMilestoneReleased",
      "unpauseCampaign",
      "updateRoot",
      "withdraw",
      "withdrawUnvested",
    ].sort();
    const actual = program.idl.instructions.map((i) => i.name).sort();
    expect(actual).to.deep.equal(expected);
  });
});
