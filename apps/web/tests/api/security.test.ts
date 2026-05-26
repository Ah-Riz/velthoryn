import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import { POST as postCampaigns } from "@/app/api/campaigns/route";
import { GET as getNonce } from "@/app/api/auth/nonce/route";
import { resetRedisForTests } from "@/lib/api/redis";
import { resetRateLimitForTests } from "@/lib/api/rate-limit";
import {
  generateNonce,
  parseAuthorizationHeader,
  storeNonce,
  verifyWalletAuth,
} from "@/lib/api/auth-middleware";
import { checkBodySize, getBodyLimitBytes } from "@/lib/api/body-limit";
import { PayloadTooLargeError } from "@/lib/api/errors";
import { makeCampaignBody, makeUrl } from "../helpers/requests";
import { createAuthHeader } from "../helpers/wallet-auth";

describe("security controls", () => {
  beforeEach(() => {
    resetRedisForTests();
    resetRateLimitForTests();
    vi.unstubAllEnvs();
  });

  it("accepts unauthenticated POST /api/campaigns (no auth gate)", async () => {
    const req = new NextRequest(makeUrl("/api/campaigns"), {
      method: "POST",
      body: JSON.stringify(makeCampaignBody()),
      headers: { "content-type": "application/json" },
    });

    const res = await postCampaigns(req);
    // Route no longer requires auth — request proceeds to validation/insert.
    // Valid payload returns 201 (created) or 200 (duplicate); invalid returns 400.
    expect([200, 201, 400]).toContain(res.status);
    expect(res.status).not.toBe(401);
  });

  it("accepts valid wallet signature", async () => {
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

  it("rejects invalid signature", async () => {
    const keypair = Keypair.generate();
    const nonce = generateNonce();
    await storeNonce(nonce, "pending");
    const message = {
      nonce,
      timestamp: Date.now(),
      wallet: keypair.publicKey.toBase58(),
    };
    const messageBytes = Buffer.from(JSON.stringify(message), "utf8");
    const badSig = Buffer.alloc(64, 1);

    const token = `${badSig.toString("base64")}.${messageBytes.toString("base64")}`;
    const req = new NextRequest(makeUrl("/api/campaigns"), {
      headers: { authorization: `Bearer ${token}` },
    });

    await expect(verifyWalletAuth(req)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects expired nonce replay", async () => {
    const authorization = await createAuthHeader();
    const req1 = new NextRequest(makeUrl("/api/campaigns"), {
      headers: { authorization },
    });
    await verifyWalletAuth(req1);

    const req2 = new NextRequest(makeUrl("/api/campaigns"), {
      headers: { authorization },
    });
    await expect(verifyWalletAuth(req2)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects expired timestamp", async () => {
    const keypair = Keypair.generate();
    const nonce = generateNonce();
    await storeNonce(nonce, "pending");
    const message = {
      nonce,
      timestamp: Date.now() - 6 * 60 * 1000,
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

  it("nonce endpoint returns nonce and expiry", async () => {
    const res = await getNonce(new NextRequest(makeUrl("/api/auth/nonce")));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.nonce).toBeTruthy();
    expect(json.expiresAt).toBeGreaterThan(Date.now());
  });

  it("rejects oversized campaign body via Content-Length", () => {
    const req = new NextRequest(makeUrl("/api/campaigns"), {
      method: "POST",
      headers: { "content-length": String(getBodyLimitBytes("campaigns") + 1) },
    });
    const err = checkBodySize(req, getBodyLimitBytes("campaigns"));
    expect(err).toBeInstanceOf(PayloadTooLargeError);
  });

  it("allows campaign body within limit", () => {
    const req = new NextRequest(makeUrl("/api/campaigns"), {
      method: "POST",
      headers: { "content-length": "1024" },
    });
    expect(checkBodySize(req, getBodyLimitBytes("campaigns"))).toBeNull();
  });

  it("parses authorization bearer token", () => {
    const message = Buffer.from(JSON.stringify({ a: 1 }), "utf8");
    const signature = Buffer.from("sig");
    const header = `Bearer ${signature.toString("base64")}.${message.toString("base64")}`;
    const parsed = parseAuthorizationHeader(header);
    expect(parsed?.messageBytes.toString()).toBe(message.toString());
  });
});
