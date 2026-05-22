import { NextRequest, NextResponse } from "next/server";
import { verifyAdminKey } from "@/lib/auth";
import { syncClaimEvents } from "@/lib/indexer/claim-events";

export async function POST(request: NextRequest) {
  const authError = verifyAdminKey(request);
  if (authError) {
    return authError;
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
