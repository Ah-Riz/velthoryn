/**
 * Client-side wallet auth helpers.
 *
 * Builds an Authorization header value that the server-side auth-middleware
 * can verify (nonce-based, same protocol as scripts/test-be-merkle-pipeline.ts).
 */

export interface WalletSigner {
  publicKey: { toBase58(): string };
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

/**
 * Requests a nonce from the server and signs it with the connected wallet.
 * Returns the full `Authorization: Bearer <token>` header value.
 *
 * Throws if the nonce request fails or the wallet refuses to sign.
 */
export async function createAuthHeader(
  wallet: WalletSigner,
): Promise<string> {
  const nonceRes = await fetch("/api/auth/nonce");
  if (!nonceRes.ok) {
    throw new Error(`GET /api/auth/nonce failed: HTTP ${nonceRes.status}`);
  }
  const { nonce } = (await nonceRes.json()) as { nonce: string };

  const message = JSON.stringify({
    nonce,
    timestamp: Date.now(),
    wallet: wallet.publicKey.toBase58(),
  });

  const messageBytes = new TextEncoder().encode(message);
  const signature = await wallet.signMessage(messageBytes);

  const token = `${Buffer.from(signature).toString("base64")}.${Buffer.from(messageBytes).toString("base64")}`;
  return `Bearer ${token}`;
}
