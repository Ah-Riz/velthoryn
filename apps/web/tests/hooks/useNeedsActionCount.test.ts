// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { mockUseWallet } = vi.hoisted(() => ({
  mockUseWallet: vi.fn(),
}));

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: mockUseWallet,
}));

import { useNeedsActionCount } from "../../src/hooks/useNeedsActionCount";

const WALLET = "Wallet1111111111111111111111111111111111111";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const senderCampaigns = {
  campaigns: [
    {
      treeAddress: "SenderTree111111111111111111111111111111111",
      creator: WALLET,
      mint: "Mint111111111111111111111111111111111111111",
      campaignId: 1,
      leafCount: 2,
      totalSupply: "1000000",
      totalClaimed: "0",
      cancellable: false,
      paused: false,
      cancelledAt: 1700000000,
      createdAt: 1699000000,
      metadata: null,
    },
    {
      treeAddress: "SenderTree222222222222222222222222222222222",
      creator: WALLET,
      mint: "Mint222222222222222222222222222222222222222",
      campaignId: 2,
      leafCount: 1,
      totalSupply: "500000",
      totalClaimed: "0",
      cancellable: false,
      paused: false,
      cancelledAt: null,
      createdAt: 1698000000,
      metadata: null,
    },
  ],
  total: 2,
  page: 1,
  limit: 100,
};

const claimableRecipientCampaign = {
  treeAddress: "RecipientTree11111111111111111111111111111111",
  creator: "Creator111111111111111111111111111111111111",
  mint: "Mint333333333333333333333333333333333333333",
  campaignId: 3,
  totalSupply: "1000000",
  leafCount: 1,
  paused: false,
  cancelledAt: null,
  createdAt: 1697000000,
  metadata: null,
  myClaimed: "0",
  myLeaf: {
    leafIndex: 0,
    amount: "100000",
    releaseType: 1,
    startTime: 1600000000,
    cliffTime: 1600000000,
    endTime: 2000000000,
    milestoneIdx: 0,
  },
};

describe("useNeedsActionCount", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockUseWallet.mockReturnValue({
      publicKey: { toBase58: () => WALLET },
    });
  });

  it("returns zero when wallet is not connected", async () => {
    mockUseWallet.mockReturnValue({ publicKey: null });

    const { result } = renderHook(() => useNeedsActionCount(), {
      wrapper: createWrapper(),
    });

    expect(result.current.count).toBe(0);
    expect(result.current.isLoading).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("counts cancelled sender campaigns and claimable recipient campaigns", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/campaigns")) {
        return { ok: true, json: async () => senderCampaigns };
      }
      if (typeof url === "string" && url.includes("/api/beneficiary/")) {
        return {
          ok: true,
          json: async () => ({ campaigns: [claimableRecipientCampaign] }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { result } = renderHook(() => useNeedsActionCount(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.count).toBe(2);
  });

  it("returns zero when no campaigns need action", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/campaigns")) {
        return {
          ok: true,
          json: async () => ({
            ...senderCampaigns,
            campaigns: [senderCampaigns.campaigns[1]],
          }),
        };
      }
      if (typeof url === "string" && url.includes("/api/beneficiary/")) {
        return { ok: true, json: async () => ({ campaigns: [] }) };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { result } = renderHook(() => useNeedsActionCount(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.count).toBe(0);
  });
});
