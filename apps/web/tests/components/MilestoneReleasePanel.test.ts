// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { MilestoneReleasePanel } from "@/components/campaign/detail/MilestoneReleasePanel";

const mockSendTransaction = vi.fn();
const mockConfirmTransaction = vi.fn();

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({ sendTransaction: mockSendTransaction }),
  useConnection: () => ({ connection: { confirmTransaction: mockConfirmTransaction } }),
}));

const TREE_PUBKEY = new PublicKey("11111111111111111111111111111112");

function createMockProgram() {
  return {
    methods: {
      setMilestoneReleased: vi.fn(() => ({
        accounts: vi.fn(() => ({
          instruction: vi.fn(async () => ({})),
        })),
      })),
    },
  };
}

function withQueryClient(element: React.ReactElement, client?: QueryClient) {
  const qc = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, element);
}

function renderPanel(overrides = {}) {
  const leafCount = (overrides as any).leafCount ?? 3;
  const milestoneIndices = (overrides as any).milestoneIndices ?? Array.from({ length: leafCount }, (_, i) => i);

  const props = {
    program: {} as any,
    publicKey: {} as any,
    treePubkey: {} as any,
    milestoneReleasedFlags: new Uint8Array(32),
    milestoneIndices,
    canRelease: true,
    onSuccess: () => {},
    toast: () => {},
    ...overrides,
  };
  // Remove leafCount — component doesn't accept it
  delete (props as any).leafCount;
  return render(withQueryClient(createElement(MilestoneReleasePanel, props)));
}

describe("MilestoneReleasePanel", () => {
  afterEach(() => cleanup());

  it("renders nothing when milestoneIndices is empty", () => {
    const { container } = renderPanel({ milestoneIndices: [] });
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when canRelease is false", () => {
    const { container } = renderPanel({ canRelease: false });
    expect(container.innerHTML).toBe("");
  });

  it("shows milestone list for multi-leaf campaigns", () => {
    renderPanel({ leafCount: 3 });
    expect(screen.getByText("#0")).toBeTruthy();
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();
  });

  it("shows done badge for released milestones", () => {
    const flags = new Uint8Array(32);
    flags[0] = 0b00000001; // milestone 0 released
    renderPanel({ milestoneReleasedFlags: flags });
    expect(screen.getByText("done")).toBeTruthy();
  });

  it("shows Release button for unreleased milestones", () => {
    renderPanel({ leafCount: 2 });
    expect(screen.getByText("Release #0")).toBeTruthy();
  });
});

describe("MilestoneReleasePanel cache invalidation", () => {
  let queryClient: QueryClient;
  let invalidateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendTransaction.mockResolvedValue("test-sig");
    mockConfirmTransaction.mockResolvedValue({ value: { err: null } });
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as typeof fetch;

    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("invalidates campaign, beneficiaryCampaigns, and timeline after confirmed release", async () => {
    const onSuccess = vi.fn();
    const toast = vi.fn();

    render(
      withQueryClient(
        createElement(MilestoneReleasePanel, {
          program: createMockProgram() as never,
          publicKey: PublicKey.default,
          treePubkey: TREE_PUBKEY,
          milestoneReleasedFlags: new Uint8Array(32),
          milestoneIndices: [0],
          canRelease: true,
          onSuccess,
          toast,
        }),
        queryClient,
      ),
    );

    fireEvent.click(screen.getByText("Release #0"));

    await waitFor(() => {
      expect(mockConfirmTransaction).toHaveBeenCalledWith("test-sig", "confirmed");
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["campaign"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["beneficiaryCampaigns"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["timeline", TREE_PUBKEY.toBase58()] });
    });

    expect(onSuccess).toHaveBeenCalledWith(0);
    expect(toast).toHaveBeenCalledWith("Milestone #0 released.", "success");
    expect(global.fetch).toHaveBeenCalledWith("/api/events/sync", expect.objectContaining({ method: "POST" }));
  });
});
