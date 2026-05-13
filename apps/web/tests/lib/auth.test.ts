import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to test verifyApiKey and verifyAdminKey which depend on NextRequest.
// We mock NextRequest and NextResponse to avoid pulling in Next.js internals.
// The timingSafeCompare function is internal and tested indirectly through verifyApiKey/verifyAdminKey.

// Import the module after setting up env vars
let verifyApiKey: (req: any) => any;
let verifyAdminKey: (req: any) => any;

describe("auth utilities", () => {
  beforeEach(async () => {
    // Reset modules to pick up new env vars
    vi.resetModules();
    process.env.API_KEY = "test-api-key-secret";
    process.env.ADMIN_API_KEY = "test-admin-key-secret";

    const auth = await import("../../src/lib/auth");
    verifyApiKey = auth.verifyApiKey;
    verifyAdminKey = auth.verifyAdminKey;
  });

  describe("verifyApiKey", () => {
    it("returns null for valid API key", () => {
      const req = {
        headers: {
          get: (name: string) => {
            if (name === "x-api-key") return "test-api-key-secret";
            return null;
          },
        },
      };
      const result = verifyApiKey(req);
      expect(result).toBeNull();
    });

    it("returns 401 Response for invalid API key", () => {
      const req = {
        headers: {
          get: (name: string) => {
            if (name === "x-api-key") return "wrong-key";
            return null;
          },
        },
      };
      const result = verifyApiKey(req);
      expect(result).not.toBeNull();
      expect(result.status).toBe(401);
    });

    it("returns 401 Response for missing API key header", () => {
      const req = {
        headers: {
          get: () => null,
        },
      };
      const result = verifyApiKey(req);
      expect(result).not.toBeNull();
      expect(result.status).toBe(401);
    });

    it("returns 401 when API_KEY env var is not set", async () => {
      vi.resetModules();
      delete process.env.API_KEY;
      const auth = await import("../../src/lib/auth");
      const result = auth.verifyApiKey({
        headers: { get: (name: string) => "some-key" },
      });
      expect(result).not.toBeNull();
      expect(result.status).toBe(401);
    });
  });

  describe("verifyAdminKey", () => {
    it("returns null for valid admin key", () => {
      const req = {
        headers: {
          get: (name: string) => {
            if (name === "x-admin-key") return "test-admin-key-secret";
            return null;
          },
        },
      };
      const result = verifyAdminKey(req);
      expect(result).toBeNull();
    });

    it("returns 401 Response for invalid admin key", () => {
      const req = {
        headers: {
          get: (name: string) => {
            if (name === "x-admin-key") return "wrong-admin-key";
            return null;
          },
        },
      };
      const result = verifyAdminKey(req);
      expect(result).not.toBeNull();
      expect(result.status).toBe(401);
    });

    it("returns 401 Response for missing admin key header", () => {
      const req = {
        headers: {
          get: () => null,
        },
      };
      const result = verifyAdminKey(req);
      expect(result).not.toBeNull();
      expect(result.status).toBe(401);
    });

    it("returns 401 when ADMIN_API_KEY env var is not set", async () => {
      vi.resetModules();
      delete process.env.ADMIN_API_KEY;
      const auth = await import("../../src/lib/auth");
      const result = auth.verifyAdminKey({
        headers: { get: (name: string) => "some-key" },
      });
      expect(result).not.toBeNull();
      expect(result.status).toBe(401);
    });
  });

  describe("timing-safe comparison behavior", () => {
    it("rejects keys of different lengths via 401", () => {
      const req = {
        headers: {
          get: (name: string) => {
            if (name === "x-api-key") return "short";
            return null;
          },
        },
      };
      const result = verifyApiKey(req);
      expect(result).not.toBeNull();
      expect(result.status).toBe(401);
    });
  });
});
