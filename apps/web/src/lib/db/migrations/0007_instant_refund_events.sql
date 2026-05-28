CREATE TABLE IF NOT EXISTS instant_refund_events (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  cancelled_at BIGINT NOT NULL,
  refunded_to TEXT NOT NULL,
  amount BIGINT NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  slot BIGINT NOT NULL,
  block_time BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_instant_refund_events_campaign ON instant_refund_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_instant_refund_events_block_time ON instant_refund_events(block_time);

