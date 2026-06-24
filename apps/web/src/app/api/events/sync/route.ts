import { NextRequest } from "next/server";
import { Connection } from "@solana/web3.js";
import { jsonResponse } from "@/lib/api/json-response";
import { ValidationError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";
import { indexEventBuffers } from "@/lib/indexer/event-indexer";
import { extractAnchorEventData } from "@/lib/indexer/claim-events";

async function postEventsSyncHandler(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const signatures: unknown[] = Array.isArray(body?.signatures)
    ? body.signatures
    : typeof body?.signature === "string"
      ? [body.signature]
      : [];

  const validSigs = signatures.filter((s): s is string => typeof s === "string" && s.length > 0);
  if (validSigs.length === 0) {
    throw new ValidationError("signature is required");
  }

  const rpcUrl = process.env.NEXT_PUBLIC_RPC_ENDPOINT;
  if (!rpcUrl) throw new Error("NEXT_PUBLIC_RPC_ENDPOINT is not set");

  const connection = new Connection(rpcUrl, "confirmed");
  const uniqueSigs = [...new Set(validSigs)];

  let processed = 0;
  const campaignCache = new Map<string, number>();

  for (const signature of uniqueSigs) {
    let tx: Awaited<ReturnType<typeof connection.getTransaction>> | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 1000));
      tx = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
      if (tx?.meta?.logMessages) break;
    }
    if (!tx?.meta?.logMessages) continue;

    const slot = tx.slot;
    const blockTime = BigInt(tx.blockTime ?? Math.floor(Date.now() / 1000));
    const eventBuffers = extractAnchorEventData(tx.meta.logMessages);

    if (eventBuffers.length === 0) continue;

    await indexEventBuffers({ eventBuffers, signature, slot, blockTime, campaignCache });
    processed += eventBuffers.length;
  }

  return jsonResponse({ ok: true, processed });
}

export const POST = withRoute(
  { rateLimit: { requests: 20, window: 60 } },
  postEventsSyncHandler,
);
