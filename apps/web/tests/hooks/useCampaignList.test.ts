// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useCampaignList } from "../../src/hooks/useCampaignList";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const mockResponse = {
  campaigns: [
    {
      treeAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      creator: "11111111111111111111111111111112",
      mint: "11111111111111111111111111111114",
      campaignId: 1,
      leafCount: 10,
      totalSupply: "1000000",
      totalClaimed: "0",
      cancellable: false,
      paused: false,
      cancelledAt: null,
      createdAt: 1700000000,
      metadata: null,
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
};

describe("useCampaignList", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("fetches /api/campaigns with no filters", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const { result } = renderHook(() => useCampaignList(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toBe("/api/campaigns");
    expect(result.current.data).toEqual(mockResponse);
  });

  it("passes creator filter as URLSearchParams", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...mockResponse, total: 0, campaigns: [] }),
    });

    const { result } = renderHook(
      () => useCampaignList({ creator: "CreatorAddr1111111111111111111111" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("creator=CreatorAddr1111111111111111111111");
  });

  it("passes mint filter as URLSearchParams", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...mockResponse, total: 0, campaigns: [] }),
    });

    const { result } = renderHook(
      () => useCampaignList({ mint: "MintAddr11111111111111111111111111" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("mint=MintAddr11111111111111111111111111");
  });

  it("passes status filter as URLSearchParams", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...mockResponse, total: 0, campaigns: [] }),
    });

    const { result } = renderHook(
      () => useCampaignList({ status: "active" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("status=active");
  });

  it("passes page and limit filters as URLSearchParams", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...mockResponse, page: 2, limit: 10 }),
    });

    const { result } = renderHook(
      () => useCampaignList({ page: 2, limit: 10 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("page=2");
    expect(calledUrl).toContain("limit=10");
  });

  it("passes multiple filters together", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...mockResponse, total: 0, campaigns: [] }),
    });

    const { result } = renderHook(
      () =>
        useCampaignList({
          creator: "CreatorAddr1111111111111111111111",
          status: "paused",
          page: 3,
          limit: 5,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("creator=CreatorAddr1111111111111111111111");
    expect(calledUrl).toContain("status=paused");
    expect(calledUrl).toContain("page=3");
    expect(calledUrl).toContain("limit=5");
  });

  it("throws error when fetch returns non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useCampaignList(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
    expect(result.current.error.message).toContain("500");
  });

  it("uses staleTime of 10 seconds", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    // Render twice with the same wrapper (same QueryClient) — second call
    // should return cached data and NOT trigger another fetch within staleTime.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);

    const { result: result1 } = renderHook(() => useCampaignList(), {
      wrapper,
    });
    await waitFor(() => expect(result1.current.isSuccess).toBe(true));

    const { result: result2 } = renderHook(() => useCampaignList(), {
      wrapper,
    });
    await waitFor(() => expect(result2.current.isSuccess).toBe(true));

    // Only one fetch call because data is still fresh (staleTime = 10s)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
