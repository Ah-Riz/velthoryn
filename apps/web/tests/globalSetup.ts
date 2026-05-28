import { execSync } from "child_process";
import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import postgres from "postgres";

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

function isRemoteDatabaseUrl(url: string): boolean {
  return (
    url.includes("supabase.co") ||
    url.includes("supabase.in") ||
    url.includes("pooler") ||
    url.includes("neon.tech")
  );
}

async function assertDatabaseReachable(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, connect_timeout: 3 });
  try {
    await sql`SELECT 1`;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function assertInstantRefundSchema(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, connect_timeout: 3 });
  try {
    const [campaignCol] = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'campaigns'
        AND column_name = 'instant_refunded'
      LIMIT 1
    `;
    if (!campaignCol) {
      throw new Error("campaigns.instant_refunded column is missing");
    }
    const [eventTable] = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'instant_refund_events'
      LIMIT 1
    `;
    if (!eventTable) {
      throw new Error("instant_refund_events table is missing");
    }
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export default async function globalSetup() {
  const webRoot = resolve(__dirname, "..");
  loadEnvFile(resolve(webRoot, ".env.local"));
  loadEnvFile(resolve(webRoot, ".env"));

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required for API tests. Example:\n" +
        "  DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci pnpm test\n" +
        "  DATABASE_URL=postgresql://lana@127.0.0.1:54329/ci pnpm test",
    );
  }

  const dbUrl = process.env.DATABASE_URL;
  if (isRemoteDatabaseUrl(dbUrl)) {
    console.warn(
      "\n⚠️  WARNING: DATABASE_URL points to a remote hosted database. API tests that require DB " +
        "will skip destructive operations to protect your data.\n" +
        "   For full test coverage, use a local Postgres:\n" +
        "   DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci pnpm test\n",
    );
  } else {
    try {
      await assertDatabaseReachable(dbUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `DATABASE_URL is not reachable (${dbUrl}): ${message}\n` +
          "Start Postgres locally (e.g. docker run postgres:15 on port 5432) and run:\n" +
          "  cd apps/web && pnpm db:migrate",
      );
    }
  }

  if (!process.env.CI) {
    try {
      execSync("pnpm db:migrate", {
        cwd: webRoot,
        stdio: "inherit",
        env: { ...process.env },
      });
    } catch {
      console.warn(
        "[globalSetup] pnpm db:migrate failed — verifying schema (common when DB was created via drizzle-kit push).",
      );
      await assertInstantRefundSchema(dbUrl);
    }
    return;
  }

  if (process.env.DRIZZLE_PUSH) {
    execSync("echo y | pnpm drizzle-kit push", {
      cwd: webRoot,
      stdio: "inherit",
      shell: "/bin/bash",
      env: { ...process.env },
    });
  }
}
