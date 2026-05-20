// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { MilestoneStatusBadge } from "@/components/campaign/TriggerMilestoneButton";

function renderBadge(overrides = {}) {
  const props = {
    isMilestoneType: true,
    alreadyTriggered: false,
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

  it("shows unlocked when cliff passed and not claimed", () => {
    renderBadge({ cliffTime: 100n, nowTs: 500n });
    expect(screen.getByText(/unlocked/i)).toBeTruthy();
  });

  it("shows countdown when cliff not reached", () => {
    renderBadge({ cliffTime: 1000n, nowTs: 500n });
    expect(screen.getByText(/unlocks in/i)).toBeTruthy();
  });

  it("includes milestone index in message", () => {
    renderBadge({ alreadyTriggered: true, milestoneIdx: 5 });
    expect(screen.getByText(/Milestone #5 claimed/)).toBeTruthy();
  });
});
