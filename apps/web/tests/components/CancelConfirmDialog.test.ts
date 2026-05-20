// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { CancelConfirmDialog } from "@/components/campaign/CancelConfirmDialog";

function renderDialog(overrides = {}) {
  const props = {
    isOpen: true,
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    isLoading: false,
    totalSupply: 10000n,
    totalClaimed: 2000n,
    vestedAmount: 5000n,
    ...overrides,
  };
  const result = render(createElement(CancelConfirmDialog, props));
  return { ...result, props };
}

describe("CancelConfirmDialog", () => {
  afterEach(() => cleanup());

  it("renders nothing when not open", () => {
    const { container } = renderDialog({ isOpen: false });
    expect(container.innerHTML).toBe("");
  });

  it("renders dialog when open", () => {
    renderDialog();
    expect(screen.getByText(/Cancel this vesting stream/)).toBeTruthy();
    expect(screen.getByText("Go Back")).toBeTruthy();
  });

  it("shows correct token breakdown", () => {
    renderDialog();
    expect(screen.getByText("2000 tokens")).toBeTruthy();
    expect(screen.getByText("~3000 tokens")).toBeTruthy();
    expect(screen.getByText("~5000 tokens")).toBeTruthy();
  });

  it("calls onConfirm when confirm button clicked", () => {
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });
    const buttons = screen.getAllByRole("button");
    const confirmBtn = buttons.find((b) => b.textContent?.includes("Cancel Stream"));
    expect(confirmBtn).toBeTruthy();
    fireEvent.click(confirmBtn!);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onClose when Go Back clicked", () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.click(screen.getByText("Go Back"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows Cancelling text when loading", () => {
    renderDialog({ isLoading: true });
    expect(screen.getByText("Cancelling...")).toBeTruthy();
  });

  it("shows zero unclaimed when all vested is claimed", () => {
    renderDialog({ totalClaimed: 5000n, vestedAmount: 5000n });
    expect(screen.getByText("~0 tokens")).toBeTruthy();
  });

  it("handles zero vested amount", () => {
    renderDialog({ vestedAmount: 0n, totalClaimed: 0n });
    expect(screen.getByText("~10000 tokens")).toBeTruthy();
  });
});
