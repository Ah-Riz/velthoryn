import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import type { NextRequest } from "next/server";
import { getRedis } from "@/lib/api/redis";
import { AuthError } from "@/lib/api/errors";

const NONCE_PREFIX = "auth:nonce:";
const NONCE_TTL_SECONDS = 300;
const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;

export interface AuthMessage {
  nonce: string;
  timestamp: number;
  wallet: string;
}

export interface AuthContext {
  publicKey: string;
}

export function parseAuthorizationHeader(
  header: string | null,
): { signature: Buffer; messageBytes: Buffer } | null {
  if (!header?.startsWith("Bearer ")) return null;

  const token = header.slice("Bearer ".length).trim();
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;

  try {
    const signature = Buffer.from(token.slice(0, dot), "base64");
    const messageBytes = Buffer.from(token.slice(dot + 1), "base64");
    if (signature.length === 0 || messageBytes.length === 0) return null;
    return { signature, messageBytes };
  } catch {
    return null;
  }
}

export function parseAuthMessage(messageBytes: Buffer): AuthMessage | null {
  try {
    const parsed = JSON.parse(messageBytes.toString("utf8")) as AuthMessage;
    if (
      typeof parsed.nonce !== "string" ||
      typeof parsed.timestamp !== "number" ||
      typeof parsed.wallet !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function verifyWalletAuth(
  request: NextRequest,
): Promise<AuthContext> {
  const parsed = parseAuthorizationHeader(
    request.headers.get("authorization"),
  );
  if (!parsed) {
    throw new AuthError("Unauthorized");
  }

  const message = parseAuthMessage(parsed.messageBytes);
  if (!message) {
    throw new AuthError("Unauthorized");
  }

  const redis = getRedis();
  const nonceKey = `${NONCE_PREFIX}${message.nonce}`;
  const storedNonce = await redis.getdel<string>(nonceKey);
  if (!storedNonce) {
    throw new AuthError("Unauthorized");
  }

  if (message.timestamp > Date.now() || Date.now() - message.timestamp > TIMESTAMP_WINDOW_MS) {
    throw new AuthError("Unauthorized");
  }

  let publicKeyBytes: Uint8Array;
  try {
    publicKeyBytes = new PublicKey(message.wallet).toBytes();
  } catch {
    throw new AuthError("Unauthorized");
  }

  const valid = nacl.sign.detached.verify(
    parsed.messageBytes,
    parsed.signature,
    publicKeyBytes,
  );
  if (!valid) {
    throw new AuthError("Unauthorized");
  }

  return { publicKey: message.wallet };
}

export async function requireAuth(
  request: NextRequest,
): Promise<AuthContext> {
  return verifyWalletAuth(request);
}

export async function storeNonce(
  nonce: string,
  wallet: string,
): Promise<void> {
  await getRedis().set(`${NONCE_PREFIX}${nonce}`, wallet, {
    ex: NONCE_TTL_SECONDS,
  });
}

export function generateNonce(): string {
  const bytes = nacl.randomBytes(32);
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Extracts the authenticated wallet address from a request that has already
 * passed `withRoute({ auth: true })`. Does NOT re-verify the signature — it
 * relies on the fact that the route wrapper has already done so.
 */
export function getAuthenticatedWallet(request: { headers: { get: (k: string) => string | null } }): string {
  const parsed = parseAuthorizationHeader(request.headers.get("authorization"));
  if (!parsed) throw new AuthError("Unauthorized");
  const message = parseAuthMessage(parsed.messageBytes);
  if (!message) throw new AuthError("Unauthorized");
  return message.wallet;
}
