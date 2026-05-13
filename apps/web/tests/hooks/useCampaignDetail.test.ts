// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useCampaignDetail } from "../../src/hooks/useCampaignDetail";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const TREE_ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

const mockDetail = {
  treeAddress: TREE_ADDRESS,
  creator: "11111111111111111111111111111112",
  mint: "11111111111111111111111111111114",
  campaignId: 1,
  merkleRoot: "a".repeat(64),
  leafCount: 10,
  totalSupply: "1000000",
  totalClaimed: "250000",
  cancellable: false,
  paused: false,
  cancelledAt: null,
  createdAt: 1700000000,
  metadata: null,
  analytics: {
    uniqueClaimers: 3,
    claimCount: 5,
    percentClaimed: 25,
    rootVersionCount: 1,
  },
  rootVersions: [
    {
      version: 1,
      merkleRoot: "a".repeat(64),
      leafCount: 10,
      createdAt: 1700000000,
      ipfsCid: null,
    },
  ],
};

describe("useCampaignDetail", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("fetches /api/campaigns/{treeAddress}", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDetail,
    });

    const { result } = renderHook(() => useCampaignDetail(TREE_ADDRESS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(`/api/campaigns/${TREE_ADDRESS}`);
    expect(result.current.data).toEqual(mockDetail);
  });

  it("is disabled when treeAddress is undefined", async () => {
    const { result } = renderHook(() => useCampaignDetail(undefined), {
      wrapper: createWrapper(),
    });

    // Query should be in idle state and fetch should not be called
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws error when fetch returns non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const { result } = renderHook(() => useCampaignDetail(TREE_ADDRESS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
    expect(result.current.error.message).toContain("404");
  });

  it("uses staleTime of 10 seconds", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockDetail,
    });

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);

    const { result: result1 } = renderHook(
      () => useCampaignDetail(TREE_ADDRESS),
      { wrapper },
    );
    await waitFor(() => expect(result1.current.isSuccess).toBe(true));

    const { result: result2 } = renderHook(
      () => useCampaignDetail(TREE_ADDRESS),
      { wrapper },
    );
    await waitFor(() => expect(result2.current.isSuccess).toBe(true));

    // Only one fetch because data is still fresh (staleTime = 10s)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
