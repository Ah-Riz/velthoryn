ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "min_cliff_time" bigint;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "instant_refunded" boolean DEFAULT false NOT NULL;

