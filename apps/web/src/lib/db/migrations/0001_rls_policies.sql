-- Row-level security: public read, writes via service role only

-- Seed sync_state with initial checkpoint values
INSERT INTO sync_state (key, value, updated_at) VALUES
  ('last_synced_slot', '0', 0),
  ('last_sync_timestamp', '0', 0)
ON CONFLICT (key) DO NOTHING;

-- Enable RLS on all tables
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE root_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cancel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE pause_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE root_update_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdraw_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestone_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE stream_cancel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE instant_refund_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;

-- Public read policies
CREATE POLICY "Public read campaigns" ON campaigns FOR SELECT USING (true);
CREATE POLICY "Public read root_versions" ON root_versions FOR SELECT USING (true);
CREATE POLICY "Public read leaves" ON leaves FOR SELECT USING (true);
CREATE POLICY "Public read claim_events" ON claim_events FOR SELECT USING (true);
CREATE POLICY "Public read cancel_events" ON cancel_events FOR SELECT USING (true);
CREATE POLICY "Public read pause_events" ON pause_events FOR SELECT USING (true);
CREATE POLICY "Public read root_update_events" ON root_update_events FOR SELECT USING (true);
CREATE POLICY "Public read withdraw_events" ON withdraw_events FOR SELECT USING (true);
CREATE POLICY "Public read milestone_events" ON milestone_events FOR SELECT USING (true);
CREATE POLICY "Public read stream_cancel_events" ON stream_cancel_events FOR SELECT USING (true);
CREATE POLICY "Public read instant_refund_events" ON instant_refund_events FOR SELECT USING (true);
CREATE POLICY "Public read waitlist" ON waitlist FOR SELECT USING (true);
CREATE POLICY "Public read sync_state" ON sync_state FOR SELECT USING (true);
