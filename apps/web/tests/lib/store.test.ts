import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "../../src/store/useAppStore";

describe("useAppStore", () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useAppStore.setState({
      selectedCampaignId: null,
    });
  });

  it("has initial state with selectedCampaignId = null", () => {
    const state = useAppStore.getState();
    expect(state.selectedCampaignId).toBeNull();
  });

  it("setSelectedCampaign updates selectedCampaignId to a string", () => {
    const { setSelectedCampaign } = useAppStore.getState();

    setSelectedCampaign("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");

    expect(useAppStore.getState().selectedCampaignId).toBe(
      "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    );
  });

  it("setSelectedCampaign can set back to null", () => {
    const { setSelectedCampaign } = useAppStore.getState();

    setSelectedCampaign("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
    expect(useAppStore.getState().selectedCampaignId).toBe(
      "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    );

    setSelectedCampaign(null);
    expect(useAppStore.getState().selectedCampaignId).toBeNull();
  });

  it("setSelectedCampaign is a function", () => {
    const state = useAppStore.getState();
    expect(typeof state.setSelectedCampaign).toBe("function");
  });
});
