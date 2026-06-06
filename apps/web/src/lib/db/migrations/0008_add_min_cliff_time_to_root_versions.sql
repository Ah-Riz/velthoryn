-- Add min_cliff_time column to root_versions if it doesn't exist
-- (migration 0000 was edited after it was already applied to the DB)
ALTER TABLE "root_versions" ADD COLUMN IF NOT EXISTS "min_cliff_time" bigint NOT NULL DEFAULT 0;

-- Also ensure campaigns.min_cliff_time exists (same migration drift issue)
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "min_cliff_time" bigint;
