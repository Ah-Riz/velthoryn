import { timingSafeEqual } from "node:crypto";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

function timingSafeCompare(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a, "utf-8").digest();
  const hashB = createHash("sha256").update(b, "utf-8").digest();
  return timingSafeEqual(hashA, hashB);
}

export function verifyApiKey(request: NextRequest): NextResponse | null {
  const apiKey = request.headers.get("x-api-key");
  const secret = process.env.API_KEY;
  if (!secret || !apiKey || !timingSafeCompare(apiKey, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function verifyAdminKey(request: NextRequest): NextResponse | null {
  const adminKey = request.headers.get("x-admin-key");
  const secret = process.env.ADMIN_API_KEY;
  if (!secret || !adminKey || !timingSafeCompare(adminKey, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
