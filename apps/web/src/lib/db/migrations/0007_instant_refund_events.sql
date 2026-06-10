-- Create instant_refund_events table for InstantRefunded on-chain events.
-- Idempotent: this table may already exist if the DB was bootstrapped
-- from the unified migration 0000.
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

CREATE INDEX IF NOT EXISTS "idx_instant_refund_events_campaign" ON instant_refund_events("campaign_id");
CREATE INDEX IF NOT EXISTS "idx_instant_refund_events_block_time" ON instant_refund_events("block_time");
