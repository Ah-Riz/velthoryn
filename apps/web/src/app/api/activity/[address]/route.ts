import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { jsonResponse } from "@/lib/api/json-response";
import { ValidationError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

type ActivityRow = {
  type: string;
  block_time: string | bigint;
  signature: string;
  tree_address: string;
  campaign_name: string | null;
  data: string | Record<string, unknown>;
} & Record<string, unknown>;

async function getActivityHandler(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;

  if (!BASE58_RE.test(address)) {
    throw new ValidationError("Invalid address");
  }

  const url = new URL(request.url);
  const parsed = activityQuerySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    throw new ValidationError("Invalid query parameters", parsed.error.issues);
  }

  const { limit } = parsed.data;

  const eventsQuery = sql`
    WITH user_campaigns AS (
      SELECT DISTINCT c.id, c.tree_address, c.metadata
      FROM campaigns c
      WHERE c.creator = ${address}
      UNION
      SELECT DISTINCT c.id, c.tree_address, c.metadata
      FROM campaigns c
      INNER JOIN root_versions rv ON rv.campaign_id = c.id
      INNER JOIN leaves l ON l.root_version_id = rv.id AND l.beneficiary = ${address}
    )
    SELECT type, block_time, signature, tree_address, campaign_name, data FROM (
      SELECT 'claimed' AS type, ce.block_time, ce.signature,
        uc.tree_address,
        uc.metadata->>'name' AS campaign_name,
        json_build_object(
          'beneficiary', ce.beneficiary,
          'leafIndex', ce.leaf_index,
          'amount', ce.amount::text
        ) AS data
      FROM claim_events ce
      INNER JOIN user_campaigns uc ON uc.id = ce.campaign_id

      UNION ALL

      SELECT 'cancelled' AS type, ce.block_time, ce.signature,
        uc.tree_address,
        uc.metadata->>'name' AS campaign_name,
        json_build_object(
          'cancelledAt', ce.cancelled_at::text,
          'claimedAtCancel', ce.claimed_at_cancel::text
        ) AS data
      FROM cancel_events ce
      INNER JOIN user_campaigns uc ON uc.id = ce.campaign_id

      UNION ALL

      SELECT 'paused' AS type, pe.block_time, pe.signature,
        uc.tree_address,
        uc.metadata->>'name' AS campaign_name,
        json_build_object('paused', pe.paused) AS data
      FROM pause_events pe
      INNER JOIN user_campaigns uc ON uc.id = pe.campaign_id

      UNION ALL

      SELECT 'root_updated' AS type, re.block_time, re.signature,
        uc.tree_address,
        uc.metadata->>'name' AS campaign_name,
        json_build_object(
          'oldRoot', re.old_root,
          'newRoot', re.new_root,
          'newLeafCount', re.new_leaf_count
        ) AS data
      FROM root_update_events re
      INNER JOIN user_campaigns uc ON uc.id = re.campaign_id

      UNION ALL

      SELECT 'withdrawn' AS type, we.block_time, we.signature,
        uc.tree_address,
        uc.metadata->>'name' AS campaign_name,
        json_build_object('amount', we.amount::text) AS data
      FROM withdraw_events we
      INNER JOIN user_campaigns uc ON uc.id = we.campaign_id

      UNION ALL

      SELECT 'milestone_released' AS type, me.block_time, me.signature,
        uc.tree_address,
        uc.metadata->>'name' AS campaign_name,
        json_build_object(
          'milestoneIdx', me.milestone_idx,
          'releasedBy', me.released_by
        ) AS data
      FROM milestone_events me
      INNER JOIN user_campaigns uc ON uc.id = me.campaign_id

      UNION ALL

      SELECT 'stream_cancelled' AS type, sce.block_time, sce.signature,
        uc.tree_address,
        uc.metadata->>'name' AS campaign_name,
        json_build_object(
          'cancelledAt', sce.cancelled_at::text,
          'amountToBeneficiary', sce.amount_to_beneficiary::text,
          'amountToCreator', sce.amount_to_creator::text
        ) AS data
      FROM stream_cancel_events sce
      INNER JOIN user_campaigns uc ON uc.id = sce.campaign_id

      UNION ALL

      SELECT 'instant_refunded' AS type, ire.block_time, ire.signature,
        uc.tree_address,
        uc.metadata->>'name' AS campaign_name,
        json_build_object(
          'cancelledAt', ire.cancelled_at::text,
          'refundedTo', ire.refunded_to,
          'amount', ire.amount::text
        ) AS data
      FROM instant_refund_events ire
      INNER JOIN user_campaigns uc ON uc.id = ire.campaign_id
    ) sub
    ORDER BY block_time DESC
    LIMIT ${limit}
  `;

  const countQuery = sql`
    WITH user_campaigns AS (
      SELECT DISTINCT c.id
      FROM campaigns c
      WHERE c.creator = ${address}
      UNION
      SELECT DISTINCT c.id
      FROM campaigns c
      INNER JOIN root_versions rv ON rv.campaign_id = c.id
      INNER JOIN leaves l ON l.root_version_id = rv.id AND l.beneficiary = ${address}
    )
    SELECT (
      (SELECT COUNT(*) FROM claim_events WHERE campaign_id IN (SELECT id FROM user_campaigns)) +
      (SELECT COUNT(*) FROM cancel_events WHERE campaign_id IN (SELECT id FROM user_campaigns)) +
      (SELECT COUNT(*) FROM pause_events WHERE campaign_id IN (SELECT id FROM user_campaigns)) +
      (SELECT COUNT(*) FROM root_update_events WHERE campaign_id IN (SELECT id FROM user_campaigns)) +
      (SELECT COUNT(*) FROM withdraw_events WHERE campaign_id IN (SELECT id FROM user_campaigns)) +
      (SELECT COUNT(*) FROM milestone_events WHERE campaign_id IN (SELECT id FROM user_campaigns)) +
      (SELECT COUNT(*) FROM stream_cancel_events WHERE campaign_id IN (SELECT id FROM user_campaigns)) +
      (SELECT COUNT(*) FROM instant_refund_events WHERE campaign_id IN (SELECT id FROM user_campaigns))
    ) AS total
  `;

  const [eventsResult, countResult] = await Promise.all([
    db.execute<ActivityRow>(eventsQuery),
    db.execute<{ total: string }>(countQuery),
  ]);

  const events = eventsResult.map((row) => ({
    type: row.type,
    blockTime: String(row.block_time),
    signature: row.signature,
    treeAddress: row.tree_address,
    campaignName: row.campaign_name,
    data:
      typeof row.data === "string"
        ? (JSON.parse(row.data) as Record<string, unknown>)
        : (row.data as Record<string, unknown>),
  }));

  const total = Number(countResult[0]?.total ?? 0);

  return jsonResponse({ address, events, total });
}

export const GET = withRoute(
  { rateLimit: { requests: 60, window: 60 } },
  getActivityHandler,
);
