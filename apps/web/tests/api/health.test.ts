import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getHealth } from "@/app/api/health/route";
import { makeUrl } from "../helpers/requests";

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    db: {
      ...actual.db,
      execute: vi.fn(),
    },
  };
});

vi.mock("@solana/web3.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/web3.js")>();
  return {
    ...actual,
    Connection: vi.fn().mockImplementation(() => ({
      getSlot: vi.fn(),
    })),
  };
});

import { db } from "@/lib/db";
import { Connection } from "@solana/web3.js";

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_RPC_ENDPOINT = "https://api.devnet.solana.com";
  });

  it("returns 200 when DB and RPC are healthy", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([] as never);
    vi.mocked(Connection).mockImplementation(
      () =>
        ({
          getSlot: vi.fn().mockResolvedValue(123),
        }) as never,
    );

    const res = await getHealth(new NextRequest(makeUrl("/api/health")));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("ok");
    expect(json.db).toBe(true);
    expect(json.rpc).toBe(true);
    expect(json.version).toBeTruthy();
    expect(json.timestamp).toBeGreaterThan(0);
  });

  it("returns 503 with db false when database check fails", async () => {
    vi.mocked(db.execute).mockRejectedValueOnce(new Error("db down"));
    vi.mocked(Connection).mockImplementation(
      () =>
        ({
          getSlot: vi.fn().mockResolvedValue(123),
        }) as never,
    );

    const res = await getHealth(new NextRequest(makeUrl("/api/health")));
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.db).toBe(false);
    expect(json.rpc).toBe(true);
  });

  it("returns 503 with rpc false when RPC check fails", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([] as never);
    vi.mocked(Connection).mockImplementation(
      () =>
        ({
          getSlot: vi.fn().mockRejectedValue(new Error("rpc down")),
        }) as never,
    );

    const res = await getHealth(new NextRequest(makeUrl("/api/health")));
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.db).toBe(true);
    expect(json.rpc).toBe(false);
  });
});
