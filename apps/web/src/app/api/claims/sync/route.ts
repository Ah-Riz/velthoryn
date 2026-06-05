import { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/api/json-response";
import { syncClaimEventsForSignatures } from "@/lib/indexer/claim-events";
import { ValidationError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";

async function postClaimsSyncHandler(request: NextRequest) {
  const body = await request.json();
  const signatures: unknown[] = Array.isArray(body?.signatures)
    ? body.signatures
    : typeof body?.signature === "string"
      ? [body.signature]
      : [];

  if (signatures.length === 0) {
    throw new ValidationError("signature is required");
  }

  const result = await syncClaimEventsForSignatures(
    signatures.filter((signature): signature is string => typeof signature === "string"),
  );

  return jsonResponse({ ok: true, ...result });
}

export const POST = withRoute(
  { rateLimit: { requests: 5, window: 60 } },
  postClaimsSyncHandler,
);
