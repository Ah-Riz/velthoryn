import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export async function resetDb(): Promise<void> {
  await db.execute(
    sql`TRUNCATE claim_events, leaves, root_versions, campaigns RESTART IDENTITY CASCADE`,
  );
}
