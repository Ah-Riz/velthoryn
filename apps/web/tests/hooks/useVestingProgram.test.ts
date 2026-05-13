// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// vi.hoisted ensures these are available inside vi.mock (which is hoisted)
const { mockUseConnection, mockUseWallet, mockGetProvider, mockGetProgram } =
  vi.hoisted(() => ({
    mockUseConnection: vi.fn(),
    mockUseWallet: vi.fn(),
    mockGetProvider: vi.fn(),
    mockGetProgram: vi.fn(),
  }));

vi.mock("@solana/wallet-adapter-react", () => ({
  useConnection: mockUseConnection,
  useWallet: mockUseWallet,
}));

vi.mock("@/lib/anchor/client", () => ({
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
  getProgram: (...args: unknown[]) => mockGetProgram(...args),
}));

import { useVestingProgram } from "../../src/hooks/useVestingProgram";

const mockConnection = {};
const mockPublicKey = { toBase58: () => "WalletPubKey1111111111111111111111" };

describe("useVestingProgram", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when wallet is not connected", () => {
    mockUseConnection.mockReturnValue({ connection: mockConnection });
    mockUseWallet.mockReturnValue({ connected: false, publicKey: null });

    const { result } = renderHook(() => useVestingProgram());

    expect(result.current).toBeNull();
    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(mockGetProgram).not.toHaveBeenCalled();
  });

  it("returns null when wallet is connected but publicKey is null", () => {
    mockUseConnection.mockReturnValue({ connection: mockConnection });
    mockUseWallet.mockReturnValue({ connected: true, publicKey: null });

    const { result } = renderHook(() => useVestingProgram());

    expect(result.current).toBeNull();
    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(mockGetProgram).not.toHaveBeenCalled();
  });

  it("returns Program instance when wallet is connected", () => {
    const mockProvider = { wallet: {} };
    const mockProgram = { programId: "mock-program" };

    mockUseConnection.mockReturnValue({ connection: mockConnection });
    mockUseWallet.mockReturnValue({ connected: true, publicKey: mockPublicKey });

    mockGetProvider.mockReturnValue(mockProvider);
    mockGetProgram.mockReturnValue(mockProgram);

    const { result } = renderHook(() => useVestingProgram());

    expect(result.current).toBe(mockProgram);
    expect(mockGetProvider).toHaveBeenCalledWith(mockConnection, {
      connected: true,
      publicKey: mockPublicKey,
    });
    expect(mockGetProgram).toHaveBeenCalledWith(mockProvider);
  });
});
