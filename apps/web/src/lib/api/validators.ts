import { z } from "zod";

// ---------------------------------------------------------------------------
// leafSchema -- validates a single leaf with proof (from prepareCampaign output)
// ---------------------------------------------------------------------------

const numericString = z
  .string()
  .min(1)
  .refine((val) => /^\d+$/.test(val), "Must be a numeric string");

const base58String = z
  .string()
  .min(32)
  .max(44)
  .refine(
    (val) => /^[1-9A-HJ-NP-Za-km-z]+$/.test(val),
    "Must be a valid base58 string",
  );

export const leafSchema = z.object({
  leafIndex: z.number().int().min(0),
  beneficiary: base58String,
  amount: numericString,
  releaseType: z.number().int().min(0).max(2),
  startTime: numericString,
  cliffTime: numericString,
  endTime: numericString,
  milestoneIdx: z.number().int().min(0).default(0),
  proof: z
    .array(z.array(z.number().int().min(0).max(255)).length(32))
    .max(32),
});

// ---------------------------------------------------------------------------
// campaignMetadataSchema -- optional metadata blob
// ---------------------------------------------------------------------------

export const campaignMetadataSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  logoUri: z.string().optional(),
});

// ---------------------------------------------------------------------------
// createCampaignRequestSchema -- validates POST /api/campaigns body
// Handles both create_campaign (batch) and create_stream (single-recipient).
// ---------------------------------------------------------------------------

export const createCampaignRequestSchema = z.object({
  treeAddress: z.string().min(1),
  creator: z.string().min(1),
  mint: z.string().min(1),
  campaignId: z.number().int().min(0),
  merkleRoot: z
    .string()
    .length(64)
    .regex(/^[0-9a-fA-F]{64}$/, "merkleRoot must be a 64-char hex string"),
  leafCount: z.number().int().min(1),
  totalSupply: z.string().min(1),
  cancellable: z.boolean().default(false),
  cancelAuthority: z.string().nullable().default(null),
  pauseAuthority: z.string().nullable().default(null),
  createdAt: z.number().int().min(0),
  metadata: campaignMetadataSchema.optional(),
  leaves: z.array(leafSchema).min(1),
  ipfsCid: z.string().optional(),
});

// ---------------------------------------------------------------------------
// createRootVersionRequestSchema -- validates POST /api/campaigns/:treeAddress/root-versions
// ---------------------------------------------------------------------------

export const createRootVersionRequestSchema = z.object({
  merkleRoot: z
    .string()
    .length(64)
    .regex(/^[0-9a-fA-F]{64}$/, "merkleRoot must be a 64-char hex string"),
  leafCount: z.number().int().min(1),
  leaves: z.array(leafSchema).min(1),
  ipfsCid: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type CreateCampaignRequest = z.infer<typeof createCampaignRequestSchema>;
export type LeafInput = z.infer<typeof leafSchema>;
export type CreateRootVersionRequest = z.infer<typeof createRootVersionRequestSchema>;
