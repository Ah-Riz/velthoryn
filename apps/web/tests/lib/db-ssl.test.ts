import { describe, it, expect } from "vitest";
import { sslOptionsForConnectionString } from "@/lib/db";

describe("sslOptionsForConnectionString", () => {
  it("disables SSL for local CI Postgres", () => {
    expect(
      sslOptionsForConnectionString("postgresql://ci:ci@127.0.0.1:5432/ci"),
    ).toBeUndefined();
    expect(
      sslOptionsForConnectionString("postgresql://ci:ci@localhost:5432/ci"),
    ).toBeUndefined();
  });

  it("enables SSL for hosted Postgres with permissive certs by default", () => {
    expect(
      sslOptionsForConnectionString(
        "postgresql://postgres:secret@db.abcdef.supabase.co:5432/postgres",
      ),
    ).toEqual({ rejectUnauthorized: false });
  });

  it("enables strict SSL when DATABASE_SSL_REJECT_UNAUTHORIZED is set", () => {
    const prev = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = "true";
    try {
      expect(
        sslOptionsForConnectionString(
          "postgresql://postgres:secret@db.abcdef.supabase.co:5432/postgres",
        ),
      ).toEqual({ rejectUnauthorized: true });
    } finally {
      if (prev === undefined) {
        delete process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
      } else {
        process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = prev;
      }
    }
  });

  it("respects sslmode=disable in the connection string", () => {
    expect(
      sslOptionsForConnectionString(
        "postgresql://ci:ci@db.example.com:5432/ci?sslmode=disable",
      ),
    ).toBeUndefined();
  });
});
