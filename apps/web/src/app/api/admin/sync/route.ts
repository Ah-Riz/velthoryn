import { NextRequest, NextResponse } from "next/server";
import { syncClaimEvents } from "@/lib/indexer/claim-events";

export async function POST(request: NextRequest) {
  const adminKey = request.headers.get("x-admin-key");
  if (!process.env.ADMIN_API_KEY || adminKey !== process.env.ADMIN_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let fromSlot: number | undefined;
    try {
      const body = await request.json();
      if (typeof body.fromSlot === "number") {
        fromSlot = body.fromSlot;
      }
    } catch {
      // empty body is fine
    }

    const { processed, lastSlot } = await syncClaimEvents(fromSlot);

    return NextResponse.json({ ok: true, processed, lastSlot });
  } catch (error) {
    console.error("[POST /api/admin/sync] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
