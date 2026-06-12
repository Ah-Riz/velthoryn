-- Timeline query indexes on event tables (campaign filter + block_time ordering).
-- Idempotent: these indexes may already exist if the DB was bootstrapped
-- from the unified migration 0000.

CREATE INDEX IF NOT EXISTS "idx_cancel_events_campaign" ON "cancel_events" USING btree ("campaign_id");
CREATE INDEX IF NOT EXISTS "idx_cancel_events_block_time" ON "cancel_events" USING btree ("block_time");

CREATE INDEX IF NOT EXISTS "idx_pause_events_campaign" ON "pause_events" USING btree ("campaign_id");
CREATE INDEX IF NOT EXISTS "idx_pause_events_block_time" ON "pause_events" USING btree ("block_time");

CREATE INDEX IF NOT EXISTS "idx_root_update_events_campaign" ON "root_update_events" USING btree ("campaign_id");
CREATE INDEX IF NOT EXISTS "idx_root_update_events_block_time" ON "root_update_events" USING btree ("block_time");

CREATE INDEX IF NOT EXISTS "idx_withdraw_events_campaign" ON "withdraw_events" USING btree ("campaign_id");
CREATE INDEX IF NOT EXISTS "idx_withdraw_events_block_time" ON "withdraw_events" USING btree ("block_time");

CREATE INDEX IF NOT EXISTS "idx_milestone_events_campaign" ON "milestone_events" USING btree ("campaign_id");
CREATE INDEX IF NOT EXISTS "idx_milestone_events_block_time" ON "milestone_events" USING btree ("block_time");

CREATE INDEX IF NOT EXISTS "idx_stream_cancel_events_campaign" ON "stream_cancel_events" USING btree ("campaign_id");
CREATE INDEX IF NOT EXISTS "idx_stream_cancel_events_block_time" ON "stream_cancel_events" USING btree ("block_time");

CREATE INDEX IF NOT EXISTS "idx_instant_refund_events_campaign" ON "instant_refund_events" USING btree ("campaign_id");
CREATE INDEX IF NOT EXISTS "idx_instant_refund_events_block_time" ON "instant_refund_events" USING btree ("block_time");
