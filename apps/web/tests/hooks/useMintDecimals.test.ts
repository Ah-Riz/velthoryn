// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { renderHook, waitFor } from "@testing-library/react";

const { mockUseConnection } = vi.hoisted(() => ({
  mockUseConnection: vi.fn(),
}));

vi.mock("@solana/wallet-adapter-react", () => ({
  useConnection: mockUseConnection,
}));

import { useMintDecimals } from "@/hooks/useMintDecimals";

const MINT_ALPHA = Keypair.generate().publicKey.toBase58();
const MINT_BETA = Keypair.generate().publicKey.toBase58();

function parsedMintAccount(decimals: number) {
  return {
    value: {
      data: {
        parsed: {
          type: "mint",
          info: { decimals },
        },
      },
    },
  };
}

describe("useMintDecimals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty map for no mint addresses", async () => {
    mockUseConnection.mockReturnValue({
      connection: { getParsedAccountInfo: vi.fn() },
    });

    const { result } = renderHook(() => useMintDecimals([]));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.decimalsMap.size).toBe(0);
  });

  it("deduplicates mints and fetches decimals via getParsedAccountInfo", async () => {
    const getParsedAccountInfo = vi.fn(async (pubkey: { toBase58(): string }) => {
      const mint = pubkey.toBase58();
      if (mint === MINT_ALPHA) return parsedMintAccount(9);
      if (mint === MINT_BETA) return parsedMintAccount(6);
      return { value: null };
    });

    mockUseConnection.mockReturnValue({ connection: { getParsedAccountInfo } });

    const { result } = renderHook(() =>
      useMintDecimals([MINT_ALPHA, MINT_BETA, MINT_ALPHA]),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getParsedAccountInfo).toHaveBeenCalledTimes(2);
    expect(result.current.decimalsMap.get(MINT_ALPHA)).toBe(9);
    expect(result.current.decimalsMap.get(MINT_BETA)).toBe(6);
  });

  it("omits mints that fail to parse", async () => {
    const getParsedAccountInfo = vi
      .fn()
      .mockRejectedValueOnce(new Error("rpc error"))
      .mockResolvedValueOnce(parsedMintAccount(8));

    mockUseConnection.mockReturnValue({ connection: { getParsedAccountInfo } });

    const { result } = renderHook(() => useMintDecimals([MINT_ALPHA, MINT_BETA]));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.decimalsMap.size).toBe(1);
    expect(result.current.decimalsMap.get(MINT_BETA)).toBe(8);
  });
});
