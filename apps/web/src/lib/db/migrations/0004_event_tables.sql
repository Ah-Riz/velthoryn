-- Create on-chain event tables for campaign lifecycle events.
-- Idempotent: these tables may already exist if the DB was bootstrapped
-- from the unified migration 0000.

CREATE TABLE IF NOT EXISTS "cancel_events" (
    "id" serial PRIMARY KEY NOT NULL,
    "campaign_id" integer NOT NULL,
    "cancelled_at" bigint NOT NULL,
    "claimed_at_cancel" bigint NOT NULL,
    "signature" text NOT NULL,
    "slot" bigint NOT NULL,
    "block_time" bigint NOT NULL,
    CONSTRAINT "cancel_events_signature_unique" UNIQUE("signature")
);

DO $$ BEGIN
 ALTER TABLE cancel_events DROP CONSTRAINT IF EXISTS cancel_events_campaign_id_campaigns_id_fk;
 ALTER TABLE cancel_events ADD CONSTRAINT "cancel_events_campaign_id_campaigns_id_fk"
     FOREIGN KEY ("campaign_id") REFERENCES campaigns("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'FK constraint setup skipped: %', SQLERRM;
END $$;

CREATE TABLE IF NOT EXISTS "pause_events" (
    "id" serial PRIMARY KEY NOT NULL,
    "campaign_id" integer NOT NULL,
    "paused" boolean NOT NULL,
    "signature" text NOT NULL,
    "slot" bigint NOT NULL,
    "block_time" bigint NOT NULL,
    CONSTRAINT "pause_events_signature_unique" UNIQUE("signature")
);

DO $$ BEGIN
 ALTER TABLE pause_events DROP CONSTRAINT IF EXISTS pause_events_campaign_id_campaigns_id_fk;
 ALTER TABLE pause_events ADD CONSTRAINT "pause_events_campaign_id_campaigns_id_fk"
     FOREIGN KEY ("campaign_id") REFERENCES campaigns("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'FK constraint setup skipped: %', SQLERRM;
END $$;

CREATE TABLE IF NOT EXISTS "root_update_events" (
    "id" serial PRIMARY KEY NOT NULL,
    "campaign_id" integer NOT NULL,
    "old_root" text NOT NULL,
    "new_root" text NOT NULL,
    "new_leaf_count" integer NOT NULL,
    "signature" text NOT NULL,
    "slot" bigint NOT NULL,
    "block_time" bigint NOT NULL,
    CONSTRAINT "root_update_events_signature_unique" UNIQUE("signature")
);

DO $$ BEGIN
 ALTER TABLE root_update_events DROP CONSTRAINT IF EXISTS root_update_events_campaign_id_campaigns_id_fk;
 ALTER TABLE root_update_events ADD CONSTRAINT "root_update_events_campaign_id_campaigns_id_fk"
     FOREIGN KEY ("campaign_id") REFERENCES campaigns("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'FK constraint setup skipped: %', SQLERRM;
END $$;

CREATE TABLE IF NOT EXISTS "withdraw_events" (
    "id" serial PRIMARY KEY NOT NULL,
    "campaign_id" integer NOT NULL,
    "amount" bigint NOT NULL,
    "signature" text NOT NULL,
    "slot" bigint NOT NULL,
    "block_time" bigint NOT NULL,
    CONSTRAINT "withdraw_events_signature_unique" UNIQUE("signature")
);

DO $$ BEGIN
 ALTER TABLE withdraw_events DROP CONSTRAINT IF EXISTS withdraw_events_campaign_id_campaigns_id_fk;
 ALTER TABLE withdraw_events ADD CONSTRAINT "withdraw_events_campaign_id_campaigns_id_fk"
     FOREIGN KEY ("campaign_id") REFERENCES campaigns("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'FK constraint setup skipped: %', SQLERRM;
END $$;

CREATE TABLE IF NOT EXISTS "milestone_events" (
    "id" serial PRIMARY KEY NOT NULL,
    "campaign_id" integer NOT NULL,
    "milestone_idx" smallint NOT NULL,
    "released_by" text NOT NULL,
    "signature" text NOT NULL,
    "slot" bigint NOT NULL,
    "block_time" bigint NOT NULL,
    CONSTRAINT "milestone_events_signature_unique" UNIQUE("signature")
);

DO $$ BEGIN
 ALTER TABLE milestone_events DROP CONSTRAINT IF EXISTS milestone_events_campaign_id_campaigns_id_fk;
 ALTER TABLE milestone_events ADD CONSTRAINT "milestone_events_campaign_id_campaigns_id_fk"
     FOREIGN KEY ("campaign_id") REFERENCES campaigns("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'FK constraint setup skipped: %', SQLERRM;
END $$;

CREATE TABLE IF NOT EXISTS "stream_cancel_events" (
    "id" serial PRIMARY KEY NOT NULL,
    "campaign_id" integer NOT NULL,
    "cancelled_at" bigint NOT NULL,
    "amount_to_beneficiary" bigint NOT NULL,
    "amount_to_creator" bigint NOT NULL,
    "signature" text NOT NULL,
    "slot" bigint NOT NULL,
    "block_time" bigint NOT NULL,
    CONSTRAINT "stream_cancel_events_signature_unique" UNIQUE("signature")
);

DO $$ BEGIN
 ALTER TABLE stream_cancel_events DROP CONSTRAINT IF EXISTS stream_cancel_events_campaign_id_campaigns_id_fk;
 ALTER TABLE stream_cancel_events ADD CONSTRAINT "stream_cancel_events_campaign_id_campaigns_id_fk"
     FOREIGN KEY ("campaign_id") REFERENCES campaigns("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'FK constraint setup skipped: %', SQLERRM;
END $$;

CREATE TABLE IF NOT EXISTS "instant_refund_events" (
    "id" serial PRIMARY KEY NOT NULL,
    "campaign_id" integer NOT NULL,
    "cancelled_at" bigint NOT NULL,
    "refunded_to" text NOT NULL,
    "amount" bigint NOT NULL,
    "signature" text NOT NULL,
    "slot" bigint NOT NULL,
    "block_time" bigint NOT NULL,
    CONSTRAINT "instant_refund_events_signature_unique" UNIQUE("signature")
);

DO $$ BEGIN
 ALTER TABLE instant_refund_events DROP CONSTRAINT IF EXISTS instant_refund_events_campaign_id_campaigns_id_fk;
 ALTER TABLE instant_refund_events ADD CONSTRAINT "instant_refund_events_campaign_id_campaigns_id_fk"
     FOREIGN KEY ("campaign_id") REFERENCES campaigns("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'FK constraint setup skipped: %', SQLERRM;
END $$;
