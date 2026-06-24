import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

describe("middleware CORS", () => {
  const prevOrigin = process.env.ALLOWED_ORIGIN;

  beforeEach(() => {
    process.env.ALLOWED_ORIGIN = "https://www.velthoryn.site";
  });

  afterEach(() => {
    process.env.ALLOWED_ORIGIN = prevOrigin;
  });

  it("returns 204 for OPTIONS preflight with CORS headers", () => {
    const req = new NextRequest("http://localhost/api/campaigns", {
      method: "OPTIONS",
      headers: { origin: "https://www.velthoryn.site" },
    });

    const res = middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    expect(res.headers.get("access-control-max-age")).toBe("86400");
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://www.velthoryn.site",
    );
  });

  it("does not allow disallowed origin", () => {
    const req = new NextRequest("http://localhost/api/campaigns", {
      method: "GET",
      headers: { origin: "http://evil.com" },
    });

    const res = middleware(req);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows configured production origin", () => {
    const req = new NextRequest("http://localhost/api/campaigns", {
      method: "GET",
      headers: { origin: "https://www.velthoryn.site" },
    });

    const res = middleware(req);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://www.velthoryn.site",
    );
  });
});
