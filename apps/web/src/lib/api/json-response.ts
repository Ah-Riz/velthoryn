import { NextResponse } from "next/server";

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export function jsonResponse(data: unknown, init?: ResponseInit): NextResponse {
  return new NextResponse(JSON.stringify(data, jsonReplacer), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}
