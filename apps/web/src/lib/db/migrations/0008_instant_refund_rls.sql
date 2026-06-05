-- RLS for instant_refund_events (missed in migration 0007)

ALTER TABLE instant_refund_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read instant_refund_events') THEN
    CREATE POLICY "Public read instant_refund_events" ON instant_refund_events FOR SELECT USING (true);
  END IF;
END $$;
