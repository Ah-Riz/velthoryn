-- Historical placeholder migration (no schema changes).
--
-- Event and index tables for migrations 0004+ were originally applied via
-- `drizzle-kit push` during local/bootstrap environments before numbered
-- migrations were backfilled. This file preserves sequential numbering
-- (0000 → 0001 → 0002 → …) without altering databases that already ran
-- later migrations.
SELECT 1;
