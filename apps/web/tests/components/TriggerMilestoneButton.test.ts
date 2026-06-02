// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { MilestoneStatusBadge } from "@/components/campaign/detail/MilestoneStatusBadge";
import { TriggerMilestoneButton } from "@/components/campaign/detail/TriggerMilestoneButton";

function renderBadge(overrides = {}) {
  const props = {
    isMilestoneType: true,
    alreadyTriggered: false,
    milestoneReleased: false,
    milestoneIdx: 0,
    cliffTime: 1000n,
    nowTs: 500n,
    ...overrides,
  };
  return render(createElement(MilestoneStatusBadge, props));
}

describe("MilestoneStatusBadge", () => {
  afterEach(() => cleanup());

  it("renders nothing when not milestone type", () => {
    const { container } = renderBadge({ isMilestoneType: false });
    expect(container.innerHTML).toBe("");
  });

  it("shows claimed state when already triggered", () => {
    renderBadge({ alreadyTriggered: true });
    expect(screen.getByText(/claimed/i)).toBeTruthy();
  });

  it("shows ready to claim when released and cliff passed", () => {
    renderBadge({ milestoneReleased: true, cliffTime: 100n, nowTs: 500n });
    expect(screen.getByText(/released — ready to claim/i)).toBeTruthy();
  });

  it("shows released + countdown when released but cliff not reached", () => {
    renderBadge({ milestoneReleased: true, cliffTime: 1000n, nowTs: 500n });
    expect(screen.getByText(/released, unlocks in/i)).toBeTruthy();
  });

  it("shows awaiting creator release when not released", () => {
    renderBadge({ milestoneReleased: false, cliffTime: 100n, nowTs: 500n });
    expect(screen.getByText(/awaiting creator release/i)).toBeTruthy();
  });

  it("includes milestone index in message", () => {
    renderBadge({ alreadyTriggered: true, milestoneIdx: 5 });
    expect(screen.getByText(/Milestone #5 claimed/)).toBeTruthy();
  });
});

describe("TriggerMilestoneButton", () => {
  afterEach(() => cleanup());

  const baseProps = {
    program: {} as any,
    publicKey: {} as any,
    treePubkey: {} as any,
    milestoneIdx: 0,
    alreadyReleased: false,
    canRelease: true,
    onSuccess: () => {},
    toast: () => {},
  };

  it("renders nothing when canRelease is false", () => {
    const { container } = render(createElement(TriggerMilestoneButton, { ...baseProps, canRelease: false }));
    expect(container.innerHTML).toBe("");
  });

  it("shows release button when canRelease and not released", () => {
    render(createElement(TriggerMilestoneButton, baseProps));
    expect(screen.getByText(/Release Milestone #0/)).toBeTruthy();
  });

  it("renders nothing when alreadyReleased", () => {
    const { container } = render(createElement(TriggerMilestoneButton, { ...baseProps, alreadyReleased: true }));
    expect(container.innerHTML).toBe("");
  });
});
