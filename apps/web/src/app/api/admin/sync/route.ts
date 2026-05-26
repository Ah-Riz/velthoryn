import { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/api/json-response";
import { indexAllEvents } from "@/lib/indexer/event-indexer";
import { withRoute } from "@/lib/api/route-wrapper";

async function postAdminSyncHandler(request: NextRequest) {
  let fromSlot: number | undefined;
  try {
    const body = await request.json();
    if (typeof body.fromSlot === "number") {
      fromSlot = body.fromSlot;
    }
  } catch {
    // empty body is fine
  }

  const { processed, lastSlot, byType } = await indexAllEvents(fromSlot);
  return jsonResponse({ ok: true, processed, lastSlot, byType });
}

export const POST = withRoute(
  {
    admin: true,
    rateLimit: { requests: 3, window: 60 },
  },
  postAdminSyncHandler,
);
