import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Ensures all event tables required by tests exist in the database.
 * This is idempotent -- uses CREATE TABLE IF NOT EXISTS.
 * Called from globalSetup or individual test files.
 *
 * Covers all tables from migrations 0004_event_tables.sql plus
 * claim_events and milestone_events if they are also missing.
 */
export async function ensureEventTables(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) return;

  // claim_events
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS claim_events (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      beneficiary TEXT NOT NULL,
      leaf_index INTEGER NOT NULL,
      amount BIGINT NOT NULL,
      total_claimed_by_user BIGINT NOT NULL,
      total_claimed_overall BIGINT NOT NULL,
      milestone_idx SMALLINT,
      signature TEXT NOT NULL UNIQUE,
      slot BIGINT NOT NULL,
      block_time BIGINT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_claim_events_campaign ON claim_events(campaign_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_claim_events_campaign_beneficiary ON claim_events(campaign_id, beneficiary)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_claim_events_beneficiary_campaign ON claim_events(beneficiary, campaign_id)
  `);

  // cancel_events
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS cancel_events (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      cancelled_at BIGINT NOT NULL,
      claimed_at_cancel BIGINT NOT NULL,
      signature TEXT NOT NULL UNIQUE,
      slot BIGINT NOT NULL,
      block_time BIGINT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_cancel_events_campaign ON cancel_events(campaign_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_cancel_events_block_time ON cancel_events(block_time)
  `);

  // pause_events
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pause_events (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      paused BOOLEAN NOT NULL,
      signature TEXT NOT NULL UNIQUE,
      slot BIGINT NOT NULL,
      block_time BIGINT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_pause_events_campaign ON pause_events(campaign_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_pause_events_block_time ON pause_events(block_time)
  `);

  // root_update_events
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS root_update_events (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      old_root TEXT NOT NULL,
      new_root TEXT NOT NULL,
      new_leaf_count INTEGER NOT NULL,
      signature TEXT NOT NULL UNIQUE,
      slot BIGINT NOT NULL,
      block_time BIGINT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_root_update_events_campaign ON root_update_events(campaign_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_root_update_events_block_time ON root_update_events(block_time)
  `);

  // withdraw_events
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS withdraw_events (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      amount BIGINT NOT NULL,
      signature TEXT NOT NULL UNIQUE,
      slot BIGINT NOT NULL,
      block_time BIGINT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_withdraw_events_campaign ON withdraw_events(campaign_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_withdraw_events_block_time ON withdraw_events(block_time)
  `);

  // milestone_events
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS milestone_events (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      milestone_idx SMALLINT NOT NULL,
      released_by TEXT NOT NULL,
      signature TEXT NOT NULL UNIQUE,
      slot BIGINT NOT NULL,
      block_time BIGINT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_milestone_events_campaign ON milestone_events(campaign_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_milestone_events_block_time ON milestone_events(block_time)
  `);

  // stream_cancel_events
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS stream_cancel_events (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      cancelled_at BIGINT NOT NULL,
      amount_to_beneficiary BIGINT NOT NULL,
      amount_to_creator BIGINT NOT NULL,
      signature TEXT NOT NULL UNIQUE,
      slot BIGINT NOT NULL,
      block_time BIGINT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_stream_cancel_events_campaign ON stream_cancel_events(campaign_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_stream_cancel_events_block_time ON stream_cancel_events(block_time)
  `);
}
