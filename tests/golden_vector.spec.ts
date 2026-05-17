import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  encodeLeaf,
  leafHash,
  VestingLeaf,
  ReleaseType,
} from "../clients/ts/src/leaf";
import { VestingMerkleTree, verifyProof } from "../clients/ts/src/merkle";

const RUST_GOLDEN_HEX =
  "cf2129259e55d196c624b52834eeca822036914cabe10ce39ebbfbe67270627b";

const FIXTURE: VestingLeaf = {
  leafIndex: 0,
  beneficiary: PublicKey.default,
  amount: new BN(1_000_000),
  releaseType: ReleaseType.Linear,
  startTime: new BN(1_700_000_000),
  cliffTime: new BN(0),
  endTime: new BN(1_731_536_000),
  milestoneIdx: 0,
};

describe("golden vector gate", () => {
  it("encodeLeaf is 70 bytes", () => {
    expect(encodeLeaf(FIXTURE).length).to.equal(70);
  });

  it("leafHash is 32 bytes and deterministic", () => {
    const h1 = leafHash(FIXTURE);
    const h2 = leafHash(FIXTURE);
    expect(h1.length).to.equal(32);
    expect(h1.equals(h2)).to.be.true;
  });

  it("matches Rust golden hash (cross-language GATE)", () => {
    expect(leafHash(FIXTURE).toString("hex")).to.equal(RUST_GOLDEN_HEX);
  });

  it("merkle tree single-leaf root equals leaf hash", () => {
    const tree = new VestingMerkleTree([FIXTURE]);
    expect(tree.root.length).to.equal(32);
    expect(tree.root.equals(leafHash(FIXTURE))).to.be.true;
  });

  it("3-leaf odd tree: proofs verify for all indices (duplicate-last layer)", () => {
    const leaves: VestingLeaf[] = [0, 1, 2].map((i) => ({
      leafIndex: i,
      beneficiary: PublicKey.unique(),
      amount: new BN(1_000 + i),
      releaseType: ReleaseType.Linear,
      startTime: new BN(0),
      cliffTime: new BN(0),
      endTime: new BN(1_000),
      milestoneIdx: 0,
    }));

    const tree = new VestingMerkleTree(leaves);
    expect(tree.root.length).to.equal(32);

    for (let i = 0; i < leaves.length; i++) {
      const proof = tree.proof(i);
      expect(tree.verify(i, proof)).to.be.true;
      expect(
        verifyProof(leafHash(leaves[i]), proof, i, tree.root),
      ).to.be.true;
    }
  });
});
