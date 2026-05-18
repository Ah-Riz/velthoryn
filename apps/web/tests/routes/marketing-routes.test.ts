import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("marketing routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("renders landing content on /", async () => {
    const { default: HomePage } = await import("../../src/app/page");
    const html = renderToStaticMarkup(React.createElement(HomePage));

    expect(html).toContain("Precision Vesting");
    expect(html).toContain("Join waitlist");
    expect(html).toContain("Questions, answered.");
  });

  it("renders landing content on /landing", async () => {
    const { default: MarketingLandingPage } = await import("../../src/app/landing/page");
    const html = renderToStaticMarkup(React.createElement(MarketingLandingPage));

    expect(html).toContain("Precision Vesting");
    expect(html).toContain("Join waitlist");
    expect(html).toContain("Questions, answered.");
  });
});
