-- Additional indexes for timeline and performance queries
CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON campaigns(created_at);
CREATE INDEX IF NOT EXISTS idx_claim_events_block_time ON claim_events(block_time);
CREATE INDEX IF NOT EXISTS idx_leaves_release_type ON leaves(release_type);
