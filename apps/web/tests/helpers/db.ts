import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export async function resetDb(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  // Safety: never truncate production Supabase — only allow local/CI databases
  if (url.includes("supabase") || url.includes("pooler") || url.includes("neon")) {
    console.warn(
      "[resetDb] Skipping TRUNCATE — DATABASE_URL points to a remote database. " +
      "Use a local Postgres (e.g. DATABASE_URL=postgresql://ci:ci@127.0.0.1:5432/ci) for tests.",
    );
    return;
  }
  await db.execute(
    sql`TRUNCATE instant_refund_events, cancel_events, pause_events, root_update_events, withdraw_events, milestone_events, stream_cancel_events, claim_events, leaves, root_versions, campaigns, sync_state RESTART IDENTITY CASCADE`,
  );
}
