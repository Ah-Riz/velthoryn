import { db } from "@/lib/db";
import { waitlist } from "@/lib/db/schema";
import { NextRequest, NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { withRoute } from "@/lib/api/route-wrapper";
import { ValidationError, ConflictError } from "@/lib/api/errors";
import { jsonResponse } from "@/lib/api/json-response";

async function getWaitlistHandler(req: NextRequest) {
  const rows = await db.select().from(waitlist).orderBy(asc(waitlist.createdAt));
  const format = req.nextUrl.searchParams.get("format");

  if (format === "csv") {
    const sanitize = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
    const csv = ["email,joined_at"]
      .concat(
        rows.map(
          (r) => `${sanitize(r.email)},${new Date(r.createdAt * 1000).toISOString()}`,
        ),
      )
      .join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=waitlist.csv",
      },
    });
  }

  return jsonResponse({ total: rows.length, data: rows });
}

async function postWaitlistHandler(req: NextRequest) {
  const { email } = await req.json();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError("Email tidak valid");
  }

  try {
    await db.insert(waitlist).values({
      email,
      createdAt: Math.floor(Date.now() / 1000),
    });
    return jsonResponse({ message: "Berhasil bergabung!" });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      throw new ConflictError("Email sudah terdaftar");
    }
    throw err;
  }
}

export const GET = withRoute(
  { admin: true, rateLimit: { requests: 60, window: 60 } },
  getWaitlistHandler,
);

export const POST = withRoute(
  { rateLimit: { requests: 5, window: 60 } },
  postWaitlistHandler,
);
