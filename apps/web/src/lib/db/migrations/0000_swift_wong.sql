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
	"cancelled_at" bigint,
	"paused" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "campaigns_tree_address_unique" UNIQUE("tree_address")
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
CREATE TABLE "root_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"merkle_root" text NOT NULL,
	"leaf_count" integer NOT NULL,
	"ipfs_cid" text,
	"version" integer NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_root_version_id_root_versions_id_fk" FOREIGN KEY ("root_version_id") REFERENCES "public"."root_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "root_versions" ADD CONSTRAINT "root_versions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_creator_mint_campaign" ON "campaigns" USING btree ("creator","mint","campaign_id");--> statement-breakpoint
CREATE INDEX "idx_campaigns_creator" ON "campaigns" USING btree ("creator");--> statement-breakpoint
CREATE INDEX "idx_campaigns_mint" ON "campaigns" USING btree ("mint");--> statement-breakpoint
CREATE INDEX "idx_campaigns_merkle_root" ON "campaigns" USING btree ("merkle_root");--> statement-breakpoint
CREATE INDEX "idx_claim_events_campaign" ON "claim_events" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_claim_events_beneficiary_campaign" ON "claim_events" USING btree ("beneficiary","campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_root_version_leaf" ON "leaves" USING btree ("root_version_id","leaf_index");--> statement-breakpoint
CREATE INDEX "idx_leaves_beneficiary_root_version" ON "leaves" USING btree ("beneficiary","root_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_campaign_version" ON "root_versions" USING btree ("campaign_id","version");--> statement-breakpoint
CREATE INDEX "idx_root_versions_merkle_root" ON "root_versions" USING btree ("merkle_root");