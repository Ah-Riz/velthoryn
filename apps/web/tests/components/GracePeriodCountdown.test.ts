// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { GracePeriodCountdown } from "@/components/campaign/detail/GracePeriodCountdown";
import { GRACE_PERIOD_SECS } from "@/lib/vesting/display";

describe("GracePeriodCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T12:00:00Z"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows countdown and remaining when grace is active", () => {
    const nowTs = BigInt(Math.floor(Date.now() / 1000));
    const cancelledAt = nowTs - 3n * 86400n;

    render(createElement(GracePeriodCountdown, { cancelledAt }));

    const text = screen.getByText(/remaining/).textContent ?? "";
    expect(text).toContain("remaining");
    expect(text).not.toContain("Grace period:");
    expect(text).not.toContain("expired");
  });

  it("uses amber styling when more than 24 hours remain", () => {
    const nowTs = BigInt(Math.floor(Date.now() / 1000));
    const cancelledAt = nowTs - 3n * 86400n;

    const { container } = render(createElement(GracePeriodCountdown, { cancelledAt }));

    const span = container.querySelector("span");
    expect(span?.className).toContain("text-amber-400");
  });

  it("shows expired state after grace period ends", () => {
    const nowTs = BigInt(Math.floor(Date.now() / 1000));
    const cancelledAt = nowTs - GRACE_PERIOD_SECS - 86400n;

    render(createElement(GracePeriodCountdown, { cancelledAt }));

    expect(screen.getByText("Grace period expired")).toBeTruthy();
  });

  it("uses urgent red styling when under 24 hours remain", () => {
    const nowTs = BigInt(Math.floor(Date.now() / 1000));
    const cancelledAt = nowTs - GRACE_PERIOD_SECS + 12n * 3600n;

    const { container } = render(createElement(GracePeriodCountdown, { cancelledAt }));

    const span = container.querySelector("span");
    expect(span?.className).toContain("text-red-400");
  });
});
