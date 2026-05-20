import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

/** Supabase and other hosted Postgres require TLS; local CI/dev Postgres does not. */
export function sslOptionsForConnectionString(
  url: string | undefined,
): { rejectUnauthorized: boolean } | undefined {
  if (!url) return undefined;

  try {
    const parsed = new URL(url.replace(/^postgresql:/, "http:"));
    if (parsed.searchParams.get("sslmode") === "disable") {
      return undefined;
    }
    const host = parsed.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return undefined;
    }
  } catch {
    // Unparseable URL — assume remote hosted Postgres needs TLS.
  }

  const strict =
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" ||
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "1";

  return { rejectUnauthorized: strict };
}

const client = postgres(
  connectionString ?? "postgresql://unconfigured:unconfigured@localhost:1/unconfigured",
  {
    max: 3,
    ssl: sslOptionsForConnectionString(connectionString),
    idle_timeout: connectionString ? 20 : 1,
    connect_timeout: 30,
  },
);

export const db = drizzle(client, { schema });

export type Database = typeof db;
