import { describe, expect, it } from "vitest";
import {
  buildCreateCampaignIndexPayload,
  bulkCsvTemplate,
  parseBulkCsv,
  prepareBulkCampaign,
} from "../../src/lib/campaign/bulk";

describe("parseBulkCsv", () => {
  it("parses valid cliff and linear rows", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      "11111111111111111111111111111111,1000,Cliff,1735689600,1735776000,1735776000,0",
      "11111111111111111111111111111112,2500,Linear,1735689600,1735776000,1738368000,0",
    ].join("\n");

    const result = parseBulkCsv(csv, null);

    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].releaseType).toBe(0);
    expect(result.rows[1].releaseType).toBe(1);
    expect(result.rows[1].amountRaw).toBe("2500");
  });

  it("parses milestone rows with valid milestoneIdx", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      "11111111111111111111111111111111,1000,Milestone,1735689600,1735776000,1735776000,1",
    ].join("\n");

    const result = parseBulkCsv(csv, null);

    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].releaseType).toBe(2);
    expect(result.rows[0].milestoneIdx).toBe(1);
  });

  it("normalizes decimal amounts when mint precision is known", () => {
    const csv = [
      "beneficiary,amount,releaseType,startTime,cliffTime,endTime,milestoneIdx",
      "11111111111111111111111111111111,10.25,Linear,1735689600,1735776000,1738368000,0",
    ].join("\n");

    const result = parseBulkCsv(csv, 6);

    expect(result.issues).toEqual([]);
    expect(result.rows[0].amountRaw).toBe("10250000");
  });
});

describe("prepareBulkCampaign", () => {
  it("builds merkle payload and totals from parsed rows", () => {
    const parsed = parseBulkCsv(bulkCsvTemplate(), null);
    const prepared = prepareBulkCampaign(parsed.rows);

    expect(prepared.leafCount).toBe(3);
    expect(prepared.totalSupply).toBe("4000");
    expect(prepared.releaseMix).toEqual({ cliff: 1, linear: 1, milestone: 1 });
    expect(prepared.merkleRoot).toHaveLength(64);
    expect(prepared.leaves[0].proof.length).toBeGreaterThan(0);
  });
});

describe("buildCreateCampaignIndexPayload", () => {
  it("uses the prepared campaign data in api payload shape", () => {
    const parsed = parseBulkCsv(bulkCsvTemplate(), null);
    const prepared = prepareBulkCampaign(parsed.rows);

    const payload = buildCreateCampaignIndexPayload({
      treeAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      creator: "11111111111111111111111111111111",
      mint: "11111111111111111111111111111111",
      campaignId: 88,
      cancellable: true,
      cancelAuthority: "11111111111111111111111111111111",
      pauseAuthority: "11111111111111111111111111111111",
      createdAt: 1700000000,
      prepared,
    });

    expect(payload.leafCount).toBe(3);
    expect(payload.totalSupply).toBe("4000");
    expect(payload.pauseAuthority).toBe("11111111111111111111111111111111");
    expect(payload.leaves[1].leafIndex).toBe(1);
  });
});
