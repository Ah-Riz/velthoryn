ALTER TABLE "campaigns" ADD COLUMN "cancel_authority" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "pause_authority" text;--> statement-breakpoint
CREATE INDEX "idx_claim_events_campaign_beneficiary" ON "claim_events" USING btree ("campaign_id","beneficiary");--> statement-breakpoint
CREATE INDEX "idx_root_versions_campaign_id" ON "root_versions" USING btree ("campaign_id");