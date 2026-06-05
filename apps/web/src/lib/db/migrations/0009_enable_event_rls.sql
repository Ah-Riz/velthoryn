-- Fix RLS on event tables (drizzle-kit push did not apply RLS from migration 0004)
-- These ALTER TABLE + CREATE POLICY statements are idempotent.

ALTER TABLE cancel_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read cancel_events') THEN
    CREATE POLICY "Public read cancel_events" ON cancel_events FOR SELECT USING (true);
  END IF;
END $$;

ALTER TABLE pause_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read pause_events') THEN
    CREATE POLICY "Public read pause_events" ON pause_events FOR SELECT USING (true);
  END IF;
END $$;

ALTER TABLE root_update_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read root_update_events') THEN
    CREATE POLICY "Public read root_update_events" ON root_update_events FOR SELECT USING (true);
  END IF;
END $$;

ALTER TABLE withdraw_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read withdraw_events') THEN
    CREATE POLICY "Public read withdraw_events" ON withdraw_events FOR SELECT USING (true);
  END IF;
END $$;

ALTER TABLE milestone_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read milestone_events') THEN
    CREATE POLICY "Public read milestone_events" ON milestone_events FOR SELECT USING (true);
  END IF;
END $$;

ALTER TABLE stream_cancel_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read stream_cancel_events') THEN
    CREATE POLICY "Public read stream_cancel_events" ON stream_cancel_events FOR SELECT USING (true);
  END IF;
END $$;
