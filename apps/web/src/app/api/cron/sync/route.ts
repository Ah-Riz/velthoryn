import { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/api/json-response";
import { AuthError, InternalError } from "@/lib/api/errors";
import { indexAllEvents } from "@/lib/indexer/event-indexer";
import { withRoute } from "@/lib/api/route-wrapper";

async function getCronSyncHandler(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new InternalError("CRON_SECRET is not configured");
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  // Vercel cron passes the secret via Authorization header
  if (token !== cronSecret) {
    throw new AuthError("Invalid cron secret");
  }

  const { processed, lastSlot, byType } = await indexAllEvents();
  return jsonResponse({ ok: true, processed, lastSlot, byType });
}

// Vercel cron uses GET requests
export const GET = withRoute(
  { rateLimit: false },
  getCronSyncHandler,
);
