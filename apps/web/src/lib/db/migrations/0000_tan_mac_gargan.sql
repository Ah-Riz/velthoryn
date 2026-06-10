CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"tree_address" text NOT NULL,
	"creator" text NOT NULL,
	"mint" text NOT NULL,
	"campaign_id" bigint NOT NULL,
	"merkle_root" text NOT NULL,
	"leaf_count" integer NOT NULL,
	"total_supply" bigint NOT NULL,
	"total_claimed" bigint DEFAULT 0 NOT NULL,
	"cancellable" boolean DEFAULT false NOT NULL,
	"cancel_authority" text,
	"pause_authority" text,
	"min_cliff_time" bigint,
	"cancelled_at" bigint,
	"paused" boolean DEFAULT false NOT NULL,
	"instant_refunded" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "campaigns_tree_address_unique" UNIQUE("tree_address")
);
--> statement-breakpoint
CREATE TABLE "cancel_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"cancelled_at" bigint NOT NULL,
	"claimed_at_cancel" bigint NOT NULL,
	"signature" text NOT NULL,
	"slot" bigint NOT NULL,
	"block_time" bigint NOT NULL,
	CONSTRAINT "cancel_events_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE "claim_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"beneficiary" text NOT NULL,
	"leaf_index" integer NOT NULL,
	"amount" bigint NOT NULL,
	"total_claimed_by_user" bigint NOT NULL,
	"total_claimed_overall" bigint NOT NULL,
	"milestone_idx" smallint,
	"signature" text NOT NULL,
	"slot" bigint NOT NULL,
	"block_time" bigint NOT NULL,
	CONSTRAINT "claim_events_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE "instant_refund_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"cancelled_at" bigint NOT NULL,
	"refunded_to" text NOT NULL,
	"amount" bigint NOT NULL,
	"signature" text NOT NULL,
	"slot" bigint NOT NULL,
	"block_time" bigint NOT NULL,
	CONSTRAINT "instant_refund_events_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE "leaves" (
	"id" serial PRIMARY KEY NOT NULL,
	"root_version_id" integer NOT NULL,
	"leaf_index" integer NOT NULL,
	"beneficiary" text NOT NULL,
	"amount" bigint NOT NULL,
	"release_type" smallint NOT NULL,
	"start_time" bigint NOT NULL,
	"cliff_time" bigint NOT NULL,
	"end_time" bigint NOT NULL,
	"milestone_idx" smallint DEFAULT 0 NOT NULL,
	"proof" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestone_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"milestone_idx" smallint NOT NULL,
	"released_by" text NOT NULL,
	"signature" text NOT NULL,
	"slot" bigint NOT NULL,
	"block_time" bigint NOT NULL,
	CONSTRAINT "milestone_events_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE "pause_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"paused" boolean NOT NULL,
	"signature" text NOT NULL,
	"slot" bigint NOT NULL,
	"block_time" bigint NOT NULL,
	CONSTRAINT "pause_events_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE "root_update_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"old_root" text NOT NULL,
	"new_root" text NOT NULL,
	"new_leaf_count" integer NOT NULL,
	"signature" text NOT NULL,
	"slot" bigint NOT NULL,
	"block_time" bigint NOT NULL,
	CONSTRAINT "root_update_events_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE "root_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"merkle_root" text NOT NULL,
	"leaf_count" integer NOT NULL,
	"min_cliff_time" bigint NOT NULL,
	"ipfs_cid" text,
	"version" integer NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stream_cancel_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"cancelled_at" bigint NOT NULL,
	"amount_to_beneficiary" bigint NOT NULL,
	"amount_to_creator" bigint NOT NULL,
	"signature" text NOT NULL,
	"slot" bigint NOT NULL,
	"block_time" bigint NOT NULL,
	CONSTRAINT "stream_cancel_events_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "waitlist_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "withdraw_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"signature" text NOT NULL,
	"slot" bigint NOT NULL,
	"block_time" bigint NOT NULL,
	CONSTRAINT "withdraw_events_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
ALTER TABLE "cancel_events" ADD CONSTRAINT "cancel_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instant_refund_events" ADD CONSTRAINT "instant_refund_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_root_version_id_root_versions_id_fk" FOREIGN KEY ("root_version_id") REFERENCES "public"."root_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_events" ADD CONSTRAINT "milestone_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pause_events" ADD CONSTRAINT "pause_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "root_update_events" ADD CONSTRAINT "root_update_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "root_versions" ADD CONSTRAINT "root_versions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_cancel_events" ADD CONSTRAINT "stream_cancel_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdraw_events" ADD CONSTRAINT "withdraw_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_creator_mint_campaign" ON "campaigns" USING btree ("creator","mint","campaign_id");--> statement-breakpoint
CREATE INDEX "idx_campaigns_creator" ON "campaigns" USING btree ("creator");--> statement-breakpoint
CREATE INDEX "idx_campaigns_mint" ON "campaigns" USING btree ("mint");--> statement-breakpoint
CREATE INDEX "idx_campaigns_merkle_root" ON "campaigns" USING btree ("merkle_root");--> statement-breakpoint
CREATE INDEX "idx_campaigns_created_at" ON "campaigns" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_cancel_events_campaign" ON "cancel_events" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_cancel_events_block_time" ON "cancel_events" USING btree ("block_time");--> statement-breakpoint
CREATE INDEX "idx_claim_events_campaign" ON "claim_events" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_claim_events_campaign_beneficiary" ON "claim_events" USING btree ("campaign_id","beneficiary");--> statement-breakpoint
CREATE INDEX "idx_claim_events_beneficiary_campaign" ON "claim_events" USING btree ("beneficiary","campaign_id");--> statement-breakpoint
CREATE INDEX "idx_claim_events_block_time" ON "claim_events" USING btree ("block_time");--> statement-breakpoint
CREATE INDEX "idx_instant_refund_events_campaign" ON "instant_refund_events" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_instant_refund_events_block_time" ON "instant_refund_events" USING btree ("block_time");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_root_version_leaf" ON "leaves" USING btree ("root_version_id","leaf_index");--> statement-breakpoint
CREATE INDEX "idx_leaves_beneficiary_root_version" ON "leaves" USING btree ("beneficiary","root_version_id");--> statement-breakpoint
CREATE INDEX "idx_leaves_release_type" ON "leaves" USING btree ("release_type");--> statement-breakpoint
CREATE INDEX "idx_milestone_events_campaign" ON "milestone_events" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_milestone_events_block_time" ON "milestone_events" USING btree ("block_time");--> statement-breakpoint
CREATE INDEX "idx_pause_events_campaign" ON "pause_events" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_pause_events_block_time" ON "pause_events" USING btree ("block_time");--> statement-breakpoint
CREATE INDEX "idx_root_update_events_campaign" ON "root_update_events" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_root_update_events_block_time" ON "root_update_events" USING btree ("block_time");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_campaign_version" ON "root_versions" USING btree ("campaign_id","version");--> statement-breakpoint
CREATE INDEX "idx_root_versions_campaign_id" ON "root_versions" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_root_versions_merkle_root" ON "root_versions" USING btree ("merkle_root");--> statement-breakpoint
CREATE INDEX "idx_stream_cancel_events_campaign" ON "stream_cancel_events" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_stream_cancel_events_block_time" ON "stream_cancel_events" USING btree ("block_time");--> statement-breakpoint
CREATE INDEX "idx_withdraw_events_campaign" ON "withdraw_events" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_withdraw_events_block_time" ON "withdraw_events" USING btree ("block_time");