-- Reserved placeholder migration (no schema changes).
--
-- Keeps the migration journal gap-free between 0001 (RLS policies) and
-- 0004 (event tables). Safe to apply on databases that already have 0004+
-- via prior `db:push` bootstrap — no tables or indexes are created here.
SELECT 1;
