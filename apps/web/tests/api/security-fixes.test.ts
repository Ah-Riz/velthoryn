import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  generateNonce,
  storeNonce,
  verifyWalletAuth,
} from "@/lib/api/auth-middleware";
import { checkBodySize, getBodyLimitBytes } from "@/lib/api/body-limit";
import { resetRedisForTests } from "@/lib/api/redis";
import { resetRateLimitForTests } from "@/lib/api/rate-limit";
import { ConflictError } from "@/lib/api/errors";
import { PATCH as patchStatus } from "@/app/api/campaigns/[treeAddress]/status/route";
import { GET as getWaitlist } from "@/app/api/waitlist/route";
import { makeUrl } from "../helpers/requests";

describe("security fixes", () => {
  beforeEach(() => {
    resetRedisForTests();
    resetRateLimitForTests();
    vi.unstubAllEnvs();
  });

  describe("future timestamp rejection", () => {
    it("rejects auth message with future timestamp", async () => {
      const keypair = Keypair.generate();
      const nonce = generateNonce();
      await storeNonce(nonce, "pending");

      const message = {
        nonce,
        timestamp: Date.now() + 6 * 60 * 1000,
        wallet: keypair.publicKey.toBase58(),
      };
      const messageBytes = Buffer.from(JSON.stringify(message), "utf8");
      const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
      const token = `${Buffer.from(signature).toString("base64")}.${messageBytes.toString("base64")}`;

      const req = new NextRequest(makeUrl("/api/campaigns"), {
        headers: { authorization: `Bearer ${token}` },
      });

      await expect(verifyWalletAuth(req)).rejects.toMatchObject({ statusCode: 401 });
    });

    it("accepts auth message with current timestamp", async () => {
      const keypair = Keypair.generate();
      const nonce = generateNonce();
      await storeNonce(nonce, "pending");

      const message = {
        nonce,
        timestamp: Date.now(),
        wallet: keypair.publicKey.toBase58(),
      };
      const messageBytes = Buffer.from(JSON.stringify(message), "utf8");
      const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
      const token = `${Buffer.from(signature).toString("base64")}.${messageBytes.toString("base64")}`;

      const req = new NextRequest(makeUrl("/api/campaigns"), {
        headers: { authorization: `Bearer ${token}` },
      });

      const auth = await verifyWalletAuth(req);
      expect(auth.publicKey).toBe(message.wallet);
    });
  });

  describe("PATCH status route validation", () => {
    it("returns 404 for nonexistent campaign", async () => {
      const req = new NextRequest(makeUrl("/api/campaigns/test/status"), {
        method: "PATCH",
        body: JSON.stringify({ paused: true }),
        headers: { "content-type": "application/json" },
      });

      const res = await patchStatus(req, {
        params: Promise.resolve({ treeAddress: "test" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 400 for body with no valid fields", async () => {
      const req = new NextRequest(makeUrl("/api/campaigns/test/status"), {
        method: "PATCH",
        body: JSON.stringify({ unknown: true }),
        headers: { "content-type": "application/json" },
      });

      const res = await patchStatus(req, {
        params: Promise.resolve({ treeAddress: "nonexistent" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("production Content-Length enforcement", () => {
    it("rejects POST without Content-Length in production", () => {
      vi.stubEnv("NODE_ENV", "production");
      const req = new NextRequest(makeUrl("/api/campaigns"), {
        method: "POST",
      });
      const err = checkBodySize(req, getBodyLimitBytes("campaigns"));
      expect(err).not.toBeNull();
      vi.unstubAllEnvs();
    });

    it("allows POST without Content-Length in development", () => {
      const req = new NextRequest(makeUrl("/api/campaigns"), {
        method: "POST",
      });
      const err = checkBodySize(req, getBodyLimitBytes("campaigns"));
      expect(err).toBeNull();
    });
  });

  describe("waitlist admin guard", () => {
    it("returns 401 without admin key", async () => {
      const req = new NextRequest(makeUrl("/api/waitlist"));
      const res = await getWaitlist(req);
      expect(res.status).toBe(401);
    });

    it("returns 401 with wrong admin key", async () => {
      const req = new NextRequest(makeUrl("/api/waitlist"), {
        headers: { "x-admin-key": "wrong-key" },
      });
      const res = await getWaitlist(req);
      expect(res.status).toBe(401);
    });
  });

  describe("ConflictError", () => {
    it("has correct status code and code", () => {
      const err = new ConflictError("Duplicate");
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe("CONFLICT");
      expect(err.message).toBe("Duplicate");
    });
  });
});
