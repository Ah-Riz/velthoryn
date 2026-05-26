-- Campaign cancellation events
CREATE TABLE cancel_events (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  cancelled_at BIGINT NOT NULL,
  claimed_at_cancel BIGINT NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  slot BIGINT NOT NULL,
  block_time BIGINT NOT NULL
);
CREATE INDEX idx_cancel_events_campaign ON cancel_events(campaign_id);
CREATE INDEX idx_cancel_events_block_time ON cancel_events(block_time);

ALTER TABLE cancel_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read cancel_events" ON cancel_events FOR SELECT USING (true);

-- Pause/unpause events
CREATE TABLE pause_events (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  paused BOOLEAN NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  slot BIGINT NOT NULL,
  block_time BIGINT NOT NULL
);
CREATE INDEX idx_pause_events_campaign ON pause_events(campaign_id);
CREATE INDEX idx_pause_events_block_time ON pause_events(block_time);

ALTER TABLE pause_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read pause_events" ON pause_events FOR SELECT USING (true);

-- Root rotation events
CREATE TABLE root_update_events (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  old_root TEXT NOT NULL,
  new_root TEXT NOT NULL,
  new_leaf_count INTEGER NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  slot BIGINT NOT NULL,
  block_time BIGINT NOT NULL
);
CREATE INDEX idx_root_update_events_campaign ON root_update_events(campaign_id);
CREATE INDEX idx_root_update_events_block_time ON root_update_events(block_time);

ALTER TABLE root_update_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read root_update_events" ON root_update_events FOR SELECT USING (true);

-- Withdrawal events (withdraw_unvested)
CREATE TABLE withdraw_events (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  slot BIGINT NOT NULL,
  block_time BIGINT NOT NULL
);
CREATE INDEX idx_withdraw_events_campaign ON withdraw_events(campaign_id);
CREATE INDEX idx_withdraw_events_block_time ON withdraw_events(block_time);

ALTER TABLE withdraw_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read withdraw_events" ON withdraw_events FOR SELECT USING (true);

-- Milestone release events
CREATE TABLE milestone_events (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  milestone_idx SMALLINT NOT NULL,
  released_by TEXT NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  slot BIGINT NOT NULL,
  block_time BIGINT NOT NULL
);
CREATE INDEX idx_milestone_events_campaign ON milestone_events(campaign_id);
CREATE INDEX idx_milestone_events_block_time ON milestone_events(block_time);

ALTER TABLE milestone_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read milestone_events" ON milestone_events FOR SELECT USING (true);

-- Stream cancellation events
CREATE TABLE stream_cancel_events (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  cancelled_at BIGINT NOT NULL,
  amount_to_beneficiary BIGINT NOT NULL,
  amount_to_creator BIGINT NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  slot BIGINT NOT NULL,
  block_time BIGINT NOT NULL
);
CREATE INDEX idx_stream_cancel_events_campaign ON stream_cancel_events(campaign_id);
CREATE INDEX idx_stream_cancel_events_block_time ON stream_cancel_events(block_time);

ALTER TABLE stream_cancel_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read stream_cancel_events" ON stream_cancel_events FOR SELECT USING (true);
