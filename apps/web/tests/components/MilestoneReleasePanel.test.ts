// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MilestoneReleasePanel } from "@/components/campaign/detail/MilestoneReleasePanel";

function withQueryClient(element: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
