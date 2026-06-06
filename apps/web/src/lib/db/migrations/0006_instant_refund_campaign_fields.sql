-- Add instant-refund tracking fields to campaigns.
-- Idempotent: these columns may already exist if the DB was bootstrapped
-- from the unified migration 0000.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS "instant_refunded" boolean DEFAULT false NOT NULL;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS "cancelled_at" bigint;
