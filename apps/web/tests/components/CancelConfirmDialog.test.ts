// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { CancelConfirmDialog } from "@/components/campaign/detail/CancelConfirmDialog";

function renderDialog(overrides = {}) {
  const props = {
    isOpen: true,
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    isLoading: false,
    totalSupply: 100n,
    totalClaimed: 20n,
    vestedAmount: 50n,
    mintDecimals: 0,
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
    expect(screen.getByText("20 tokens")).toBeTruthy();
    expect(screen.getByText("~30 tokens")).toBeTruthy();
    expect(screen.getByText("~50 tokens")).toBeTruthy();
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
    renderDialog({ totalSupply: 100n, totalClaimed: 50n, vestedAmount: 50n });
    expect(screen.getByText("~0 tokens")).toBeTruthy();
  });

  it("handles zero vested amount", () => {
    renderDialog({ vestedAmount: 0n, totalClaimed: 0n });
    expect(screen.getByText("~100 tokens")).toBeTruthy();
  });

  it("shows mode toggle when isSingleStream with onConfirmStream", () => {
    renderDialog({ isSingleStream: true, onConfirmStream: vi.fn() });
    expect(screen.getByText("Instant Settle")).toBeTruthy();
    expect(screen.getByText("Grace Period")).toBeTruthy();
  });

  it("hides mode toggle when not single stream", () => {
    renderDialog({ isSingleStream: false });
    expect(screen.queryByText("Instant Settle")).toBeNull();
  });

  it("calls onConfirmStream in instant mode", () => {
    const onConfirmStream = vi.fn();
    renderDialog({ isSingleStream: true, onConfirmStream });
    const confirmBtn = screen.getByText("Cancel & Settle");
    fireEvent.click(confirmBtn);
    expect(onConfirmStream).toHaveBeenCalledOnce();
  });

  it("disables Instant Settle when scheduleLoaded is false", () => {
    renderDialog({ isSingleStream: true, onConfirmStream: vi.fn(), scheduleLoaded: false });
    const instantBtn = screen.getByText("Instant Settle");
    expect(instantBtn.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/schedule parameters not loaded/i)).toBeTruthy();
  });

  it("shows beneficiary input when beneficiaryUnknown in instant mode", () => {
    renderDialog({
      isSingleStream: true,
      onConfirmStream: vi.fn(),
      beneficiaryUnknown: true,
      manualBeneficiary: "",
      onManualBeneficiaryChange: vi.fn(),
    });
    expect(screen.getByPlaceholderText(/Beneficiary wallet/i)).toBeTruthy();
  });

  it("disables confirm when beneficiary unknown and input empty", () => {
    renderDialog({
      isSingleStream: true,
      onConfirmStream: vi.fn(),
      beneficiaryUnknown: true,
      manualBeneficiary: "",
      onManualBeneficiaryChange: vi.fn(),
    });
    const confirmBtn = screen.getByText("Cancel & Settle");
    expect(confirmBtn.hasAttribute("disabled")).toBe(true);
  });
});
