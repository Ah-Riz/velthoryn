import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  bigint,
  boolean,
  jsonb,
  integer,
  smallint,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// campaigns -- on-chain campaign index
// ---------------------------------------------------------------------------

export const campaigns = pgTable(
  "campaigns",
  {
    id: serial("id").primaryKey(),
    treeAddress: text("tree_address").notNull().unique(),
    creator: text("creator").notNull(),
    mint: text("mint").notNull(),
    campaignId: bigint("campaign_id", { mode: "bigint" }).notNull(),
    merkleRoot: text("merkle_root").notNull(),
    leafCount: integer("leaf_count").notNull(),
    totalSupply: bigint("total_supply", { mode: "bigint" }).notNull(),
    totalClaimed: bigint("total_claimed", { mode: "bigint" }).notNull().default(sql`0`),
    cancellable: boolean("cancellable").notNull().default(false),
    cancelAuthority: text("cancel_authority"),
    pauseAuthority: text("pause_authority"),
    cancelledAt: bigint("cancelled_at", { mode: "bigint" }),
    paused: boolean("paused").notNull().default(false),
    createdAt: bigint("created_at", { mode: "bigint" }).notNull(),
    metadata: jsonb("metadata").$type<{
      name?: string;
      description?: string;
      logoUri?: string;
    }>(),
  },
  (table) => [
    uniqueIndex("uq_creator_mint_campaign").on(
      table.creator,
      table.mint,
      table.campaignId,
    ),
    index("idx_campaigns_creator").on(table.creator),
    index("idx_campaigns_mint").on(table.mint),
    index("idx_campaigns_merkle_root").on(table.merkleRoot),
  ],
);

// ---------------------------------------------------------------------------
// root_versions -- merkle root history
// ---------------------------------------------------------------------------

export const rootVersions = pgTable(
  "root_versions",
  {
    id: serial("id").primaryKey(),
    // FK to internal campaigns.id, not the on-chain campaign_id
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    merkleRoot: text("merkle_root").notNull(),
    leafCount: integer("leaf_count").notNull(),
    ipfsCid: text("ipfs_cid"),
    version: integer("version").notNull(),
    createdAt: bigint("created_at", { mode: "bigint" }).notNull(),
  },
  (table) => [
    uniqueIndex("uq_campaign_version").on(table.campaignId, table.version),
    index("idx_root_versions_campaign_id").on(table.campaignId),
    index("idx_root_versions_merkle_root").on(table.merkleRoot),
  ],
);

// ---------------------------------------------------------------------------
// leaves -- per-recipient data + proof
// ---------------------------------------------------------------------------

export const leaves = pgTable(
  "leaves",
  {
    id: serial("id").primaryKey(),
    rootVersionId: integer("root_version_id")
      .notNull()
      .references(() => rootVersions.id, { onDelete: "cascade" }),
    leafIndex: integer("leaf_index").notNull(),
    beneficiary: text("beneficiary").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    releaseType: smallint("release_type").notNull(),
    startTime: bigint("start_time", { mode: "bigint" }).notNull(),
    cliffTime: bigint("cliff_time", { mode: "bigint" }).notNull(),
    endTime: bigint("end_time", { mode: "bigint" }).notNull(),
    milestoneIdx: smallint("milestone_idx").notNull().default(0),
    proof: jsonb("proof").notNull().$type<number[][]>(),
  },
  (table) => [
    uniqueIndex("uq_root_version_leaf").on(table.rootVersionId, table.leafIndex),
    index("idx_leaves_beneficiary_root_version").on(
      table.beneficiary,
      table.rootVersionId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// claim_events -- on-chain Claimed event log
// ---------------------------------------------------------------------------

export const claimEvents = pgTable(
  "claim_events",
  {
    id: serial("id").primaryKey(),
    // FK to internal campaigns.id, not the on-chain campaign_id
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    beneficiary: text("beneficiary").notNull(),
    leafIndex: integer("leaf_index").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    totalClaimedByUser: bigint("total_claimed_by_user", { mode: "bigint" }).notNull(),
    totalClaimedOverall: bigint("total_claimed_overall", { mode: "bigint" }).notNull(),
    milestoneIdx: smallint("milestone_idx"),
    signature: text("signature").notNull().unique(),
    slot: bigint("slot", { mode: "bigint" }).notNull(),
    blockTime: bigint("block_time", { mode: "bigint" }).notNull(),
  },
  (table) => [
    index("idx_claim_events_campaign").on(table.campaignId),
    index("idx_claim_events_campaign_beneficiary").on(
      table.campaignId,
      table.beneficiary,
    ),
    index("idx_claim_events_beneficiary_campaign").on(
      table.beneficiary,
      table.campaignId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// waitlist -- email waitlist
// ---------------------------------------------------------------------------

export const waitlist = pgTable("waitlist", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// ---------------------------------------------------------------------------
// Type exports for use in route handlers
// ---------------------------------------------------------------------------

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type RootVersion = typeof rootVersions.$inferSelect;
export type NewRootVersion = typeof rootVersions.$inferInsert;
export type Leaf = typeof leaves.$inferSelect;
export type NewLeaf = typeof leaves.$inferInsert;
export type ClaimEvent = typeof claimEvents.$inferSelect;
export type NewClaimEvent = typeof claimEvents.$inferInsert;