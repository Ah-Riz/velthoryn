// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useClaimHistory } from "../../src/hooks/useClaimHistory";

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
const BENEFICIARY = "11111111111111111111111111111111";

const mockClaimHistory = {
  claims: [
    {
      beneficiary: BENEFICIARY,
      leafIndex: 0,
      amount: "100000",
      totalClaimedByUser: "100000",
      totalClaimedOverall: "100000",
      milestoneIdx: null,
      signature: "sig1",
      slot: 1000,
      blockTime: 1700000000,
    },
  ],
  total: 1,
};

describe("useClaimHistory", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("fetches /api/campaigns/{treeAddress}/claims with no filters", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockClaimHistory,
    });

    const { result } = renderHook(() => useClaimHistory(TREE_ADDRESS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toBe(`/api/campaigns/${TREE_ADDRESS}/claims`);
    expect(result.current.data).toEqual(mockClaimHistory);
  });

  it("passes beneficiary filter as query param", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ claims: [], total: 0 }),
    });

    const { result } = renderHook(
      () => useClaimHistory(TREE_ADDRESS, { beneficiary: BENEFICIARY }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain(`beneficiary=${BENEFICIARY}`);
  });

  it("passes fromSlot filter as query param", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ claims: [], total: 0 }),
    });

    const { result } = renderHook(
      () => useClaimHistory(TREE_ADDRESS, { fromSlot: 5000 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("fromSlot=5000");
  });

  it("passes limit filter as query param", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ claims: [], total: 0 }),
    });

    const { result } = renderHook(
      () => useClaimHistory(TREE_ADDRESS, { limit: 50 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("limit=50");
  });

  it("passes multiple filters together", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ claims: [], total: 0 }),
    });

    const { result } = renderHook(
      () =>
        useClaimHistory(TREE_ADDRESS, {
          beneficiary: BENEFICIARY,
          fromSlot: 5000,
          limit: 10,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain(`beneficiary=${BENEFICIARY}`);
    expect(calledUrl).toContain("fromSlot=5000");
    expect(calledUrl).toContain("limit=10");
  });

  it("is disabled when treeAddress is undefined", async () => {
    const { result } = renderHook(
      () => useClaimHistory(undefined, { beneficiary: BENEFICIARY }),
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

    const { result } = renderHook(() => useClaimHistory(TREE_ADDRESS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
    expect(result.current.error.message).toContain("500");
  });
});
