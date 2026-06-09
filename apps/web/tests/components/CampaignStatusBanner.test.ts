// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { CampaignStatusBanner } from "@/components/campaign/detail/CampaignStatusBanner";
import { GRACE_PERIOD_SECS } from "@/lib/vesting/display";

const nowTs = 1_700_000_000n;

function renderBanner(overrides = {}) {
  const props = {
    cancelledAtBigint: null,
    isCreator: true,
    isInstantRefunded: false,
    isFunded: true,
    nowTs,
    onWithdrawClick: vi.fn(),
    ...overrides,
  };
  return { ...render(createElement(CampaignStatusBanner, props)), props };
}

describe("CampaignStatusBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Number(nowTs) * 1000));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("returns null for non-creators", () => {
    const { container } = renderBanner({ isCreator: false, cancelledAtBigint: 1_699_000_000n });
    expect(container.innerHTML).toBe("");
  });

  it("shows amber grace-active banner for cancelled campaign in grace period", () => {
    renderBanner({ cancelledAtBigint: nowTs - 2n * 86400n });
    expect(screen.getByText(/Campaign cancelled on/)).toBeTruthy();
    expect(screen.getByText(/remaining/)).toBeTruthy();
  });

  it("shows unvested amount in grace-expired banner copy", () => {
    renderBanner({
      cancelledAtBigint: nowTs - GRACE_PERIOD_SECS - 86400n,
      unvestedAmount: 1_500_000n,
      mintDecimals: 0,
    });
    expect(screen.getByText(/You can now withdraw 1,500,000 unvested tokens/)).toBeTruthy();
  });

  it("calls onWithdrawClick when withdraw button is clicked", () => {
    const { props } = renderBanner({
      cancelledAtBigint: nowTs - GRACE_PERIOD_SECS - 86400n,
      unvestedAmount: 100n,
    });
    fireEvent.click(screen.getByRole("button", { name: /Withdraw Unvested Tokens/i }));
    expect(props.onWithdrawClick).toHaveBeenCalledOnce();
  });

  it("shows settled banner when withdrawn", () => {
    renderBanner({
      cancelledAtBigint: nowTs - GRACE_PERIOD_SECS - 86400n,
      unvestedAmount: 0n,
      isWithdrawn: true,
    });
    expect(screen.getByText("Campaign settled")).toBeTruthy();
  });

  it("shows instant refund success banner", () => {
    renderBanner({ isInstantRefunded: true });
    expect(screen.getByText(/Campaign refunded before vesting started/)).toBeTruthy();
  });

  it("shows funding-incomplete banner when not funded", () => {
    const onResumeFunding = vi.fn();
    renderBanner({ isFunded: false, onResumeFunding });
    expect(screen.getByText(/Campaign created but not yet funded/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Resume Funding/i }));
    expect(onResumeFunding).toHaveBeenCalledOnce();
  });
});
