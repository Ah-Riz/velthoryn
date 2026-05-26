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
// bulkRecipientSchema -- validates a single recipient for bulk/prepare endpoints
// ---------------------------------------------------------------------------

export const bulkRecipientSchema = z
  .object({
    beneficiary: base58String,
    amount: numericString.refine((v) => v !== "0", "amount must be greater than 0"),
    releaseType: z.number().int().min(0).max(2),
    startTime: numericString,
    cliffTime: numericString,
    endTime: numericString,
    milestoneIdx: z.number().int().min(0).default(0),
  })
  .refine(
    (r) => {
      try {
        return (
          BigInt(r.startTime) <= BigInt(r.cliffTime) &&
          BigInt(r.cliffTime) <= BigInt(r.endTime)
        );
      } catch {
        // If BigInt conversion fails (non-numeric field), field-level errors handle it
        return true;
      }
    },
    "startTime must be <= cliffTime must be <= endTime",
  );

// ---------------------------------------------------------------------------
// csvRowSchema -- same as bulkRecipientSchema but includes row number for error
// tracking during CSV import
// ---------------------------------------------------------------------------

export const csvRowSchema = bulkRecipientSchema.and(
  z.object({ row: z.number().int().min(1) }),
);

// ---------------------------------------------------------------------------
// prepareCampaignRequestSchema -- validates POST /api/campaigns/prepare body
// ---------------------------------------------------------------------------

export const prepareCampaignRequestSchema = z
  .object({
    recipients: z.array(bulkRecipientSchema).min(1).max(1_000_000),
    mint: base58String,
    creator: base58String,
    campaignId: z.number().int().min(0),
    cancellable: z.boolean().default(false),
    cancelAuthority: base58String.nullable().default(null),
    pauseAuthority: base58String.nullable().default(null),
    metadata: campaignMetadataSchema.optional(),
  })
  .refine(
    (d) => !d.cancellable || d.cancelAuthority !== null,
    "Cancellable campaigns require cancelAuthority",
  );

// ---------------------------------------------------------------------------
// cancelCampaignRequestSchema -- validates POST /api/campaigns/:treeAddress/cancel
// ---------------------------------------------------------------------------

export const cancelCampaignRequestSchema = z.object({
  cancelAuthority: base58String,
});

// ---------------------------------------------------------------------------
// withdrawUnvestedRequestSchema -- validates POST .../withdraw-unvested
// ---------------------------------------------------------------------------

export const withdrawUnvestedRequestSchema = z.object({
  creator: base58String,
  creatorAta: base58String,
});

// ---------------------------------------------------------------------------
// withdrawArgsSchema -- validates WithdrawArgs for cancel_stream
// ---------------------------------------------------------------------------

const withdrawArgsSchema = z
  .object({
    releaseType: z.number().int().min(0).max(2),
    startTime: numericString,
    cliffTime: numericString,
    endTime: numericString,
    milestoneIdx: z.number().int().min(0).default(0),
  })
  .refine(
    (args) => {
      try {
        return (
          BigInt(args.startTime) <= BigInt(args.cliffTime) &&
          BigInt(args.cliffTime) <= BigInt(args.endTime)
        );
      } catch {
        return true;
      }
    },
    "startTime must be <= cliffTime must be <= endTime",
  );

// ---------------------------------------------------------------------------
// cancelStreamRequestSchema -- validates POST .../cancel-stream
// ---------------------------------------------------------------------------

export const cancelStreamRequestSchema = z.object({
  creator: base58String,
  beneficiary: base58String,
  withdrawArgs: withdrawArgsSchema,
  beneficiaryAta: base58String,
  creatorAta: base58String,
});

// ---------------------------------------------------------------------------
// milestoneReleaseRequestSchema -- validates POST .../milestones/:idx/release
// ---------------------------------------------------------------------------

export const milestoneReleaseRequestSchema = z.object({
  creator: base58String,
});

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type CreateCampaignRequest = z.infer<typeof createCampaignRequestSchema>;
export type LeafInput = z.infer<typeof leafSchema>;
export type CreateRootVersionRequest = z.infer<typeof createRootVersionRequestSchema>;
export type BulkRecipient = z.infer<typeof bulkRecipientSchema>;
export type PrepareCampaignRequest = z.infer<typeof prepareCampaignRequestSchema>;
export type CancelCampaignRequest = z.infer<typeof cancelCampaignRequestSchema>;
export type WithdrawUnvestedRequest = z.infer<typeof withdrawUnvestedRequestSchema>;
export type CancelStreamRequest = z.infer<typeof cancelStreamRequestSchema>;
export type MilestoneReleaseRequest = z.infer<typeof milestoneReleaseRequestSchema>;
