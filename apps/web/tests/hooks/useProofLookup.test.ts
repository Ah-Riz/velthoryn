// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useProofLookup } from "../../src/hooks/useProofLookup";

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

const mockProof = {
  leaf: {
    leafIndex: 0,
    beneficiary: BENEFICIARY,
    amount: "1000000",
    releaseType: 1,
    startTime: 1700000000,
    cliffTime: 0,
    endTime: 1731536000,
    milestoneIdx: 0,
  },
  proof: [new Array(32).fill(0)],
  merkleRoot: "a".repeat(64),
  treeAddress: TREE_ADDRESS,
};

describe("useProofLookup", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("fetches /api/campaigns/{treeAddress}/proof?beneficiary=...", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockProof,
    });

    const { result } = renderHook(
      () => useProofLookup(TREE_ADDRESS, BENEFICIARY),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain(`/api/campaigns/${TREE_ADDRESS}/proof`);
    expect(calledUrl).toContain(`beneficiary=${BENEFICIARY}`);
    expect(result.current.data).toEqual(mockProof);
  });

  it("is disabled when treeAddress is undefined", async () => {
    const { result } = renderHook(
      () => useProofLookup(undefined, BENEFICIARY),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("is disabled when beneficiary is undefined", async () => {
    const { result } = renderHook(
      () => useProofLookup(TREE_ADDRESS, undefined),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("is disabled when both treeAddress and beneficiary are undefined", async () => {
    const { result } = renderHook(
      () => useProofLookup(undefined, undefined),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws error when fetch returns non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const { result } = renderHook(
      () => useProofLookup(TREE_ADDRESS, BENEFICIARY),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
    expect(result.current.error.message).toContain("404");
  });

  it("uses staleTime of 30 seconds", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockProof,
    });

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);

    const { result: result1 } = renderHook(
      () => useProofLookup(TREE_ADDRESS, BENEFICIARY),
      { wrapper },
    );
    await waitFor(() => expect(result1.current.isSuccess).toBe(true));

    const { result: result2 } = renderHook(
      () => useProofLookup(TREE_ADDRESS, BENEFICIARY),
      { wrapper },
    );
    await waitFor(() => expect(result2.current.isSuccess).toBe(true));

    // Only one fetch because data is still fresh (staleTime = 30s)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
