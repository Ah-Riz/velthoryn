// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useBeneficiaryCampaigns } from "../../src/hooks/useBeneficiaryCampaigns";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const ADDRESS = "11111111111111111111111111111111";

const mockBeneficiaryResponse = {
  campaigns: [
    {
      treeAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      creator: "11111111111111111111111111111112",
      mint: "11111111111111111111111111111114",
      campaignId: 1,
      totalSupply: "1000000",
      leafCount: 10,
      paused: false,
      cancelledAt: null,
      createdAt: 1700000000,
      metadata: null,
      myLeaf: {
        leafIndex: 0,
        amount: "100000",
        releaseType: 1,
        startTime: 1700000000,
        cliffTime: 0,
        endTime: 1731536000,
        milestoneIdx: 0,
      },
    },
  ],
};

describe("useBeneficiaryCampaigns", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("fetches /api/beneficiary/{address}/campaigns", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockBeneficiaryResponse,
    });

    const { result } = renderHook(() => useBeneficiaryCampaigns(ADDRESS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/beneficiary/${ADDRESS}/campaigns`,
    );
    expect(result.current.data).toEqual(mockBeneficiaryResponse);
  });

  it("is disabled when address is undefined", async () => {
    const { result } = renderHook(
      () => useBeneficiaryCampaigns(undefined),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws error when fetch returns non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useBeneficiaryCampaigns(ADDRESS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
    expect(result.current.error.message).toContain("500");
  });

  it("returns empty campaigns array when beneficiary has no campaigns", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ campaigns: [] }),
    });

    const { result } = renderHook(() => useBeneficiaryCampaigns(ADDRESS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data.campaigns).toEqual([]);
  });

  it("uses staleTime of 10 seconds", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockBeneficiaryResponse,
    });

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);

    const { result: result1 } = renderHook(
      () => useBeneficiaryCampaigns(ADDRESS),
      { wrapper },
    );
    await waitFor(() => expect(result1.current.isSuccess).toBe(true));

    const { result: result2 } = renderHook(
      () => useBeneficiaryCampaigns(ADDRESS),
      { wrapper },
    );
    await waitFor(() => expect(result2.current.isSuccess).toBe(true));

    // Only one fetch because data is still fresh (staleTime = 10s)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
