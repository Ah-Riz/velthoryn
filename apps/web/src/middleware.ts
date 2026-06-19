import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ALLOW_METHODS = "GET, POST, OPTIONS";
const ALLOW_HEADERS = "Content-Type, Authorization, x-admin-key, x-api-key";
const MAX_AGE = "86400";

function resolveAllowedOrigin(): string | null {
  const configured = process.env.ALLOWED_ORIGIN?.trim();
  if (configured && configured !== "*") return configured;
  if (process.env.NODE_ENV === "production") {
    return "https://velthoryn.site";
  }
  return configured ?? "*";
}

function corsHeaders(origin: string | null, allowedOrigin: string | null): Headers {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Methods", ALLOW_METHODS);
  headers.set("Access-Control-Allow-Headers", ALLOW_HEADERS);
  headers.set("Access-Control-Max-Age", MAX_AGE);

  if (!origin || !allowedOrigin) return headers;

  if (allowedOrigin === "*" || origin === allowedOrigin) {
    headers.set("Access-Control-Allow-Origin", allowedOrigin === "*" ? "*" : origin);
    headers.set("Vary", "Origin");
  }

  return headers;
}

export function middleware(request: NextRequest) {
  const origin = request.headers.get("origin");
  const allowedOrigin = resolveAllowedOrigin();
  const headers = corsHeaders(origin, allowedOrigin);

  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers });
  }

  const response = NextResponse.next();
  headers.forEach((value, key) => response.headers.set(key, value));
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
