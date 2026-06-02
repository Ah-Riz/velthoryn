import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { jsonResponse } from "@/lib/api/json-response";
import { ValidationError, NotFoundError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const timelineQuerySchema = z.object({
  fromBlockTime: z.string().regex(/^\d+$/, "fromBlockTime must be a numeric string").optional(),
  toBlockTime: z.string().regex(/^\d+$/, "toBlockTime must be a numeric string").optional(),
  limit: z.string().regex(/^\d+$/, "limit must be a numeric string").optional(),
});

interface TimelineEvent {
  type: string;
  blockTime: string;
  signature: string;
  data: Record<string, unknown>;
}

type TimelineRow = {
  type: string;
  block_time: string | bigint;
  signature: string;
  data: string;
} & Record<string, unknown>;

async function getTimelineHandler(
  request: NextRequest,
  { params }: { params: Promise<{ treeAddress: string }> },
) {
  const { treeAddress } = await params;

  if (!BASE58_RE.test(treeAddress)) {
    throw new ValidationError("Invalid tree address");
  }

  const url = new URL(request.url);
  const queryParams = Object.fromEntries(url.searchParams.entries());
  const parsed = timelineQuerySchema.safeParse(queryParams);
  if (!parsed.success) {
    throw new ValidationError("Invalid query parameters", parsed.error.issues);
  }

  const { fromBlockTime, toBlockTime } = parsed.data;
  const limitParam = parsed.data.limit;
  const limit = Math.min(
    Math.max(1, parseInt(limitParam ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
    MAX_LIMIT,
  );

  // Resolve campaign
  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.treeAddress, treeAddress))
    .limit(1);

  if (!campaign) {
    throw new NotFoundError("Campaign");
  }

  const campaignId = campaign.id;

  // Build time-range conditions
  const fromCondition = fromBlockTime
    ? sql`AND block_time >= ${BigInt(fromBlockTime)}`
    : sql``;
  const toCondition = toBlockTime
    ? sql`AND block_time <= ${BigInt(toBlockTime)}`
    : sql``;

  // UNION ALL across all event tables — each row returns type + block_time + signature + json data
  const eventsQuery = sql`
    SELECT 'claimed' AS type, block_time, signature,
      json_build_object(
        'beneficiary', beneficiary,
        'leafIndex', leaf_index,
        'amount', amount::text
      ) AS data
    FROM claim_events
    WHERE campaign_id = ${campaignId} ${fromCondition} ${toCondition}

    UNION ALL

    SELECT 'cancelled' AS type, block_time, signature,
      json_build_object(
        'cancelledAt', cancelled_at::text,
        'claimedAtCancel', claimed_at_cancel::text
      ) AS data
    FROM cancel_events
    WHERE campaign_id = ${campaignId} ${fromCondition} ${toCondition}

    UNION ALL

    SELECT 'paused' AS type, block_time, signature,
      json_build_object('paused', paused) AS data
    FROM pause_events
    WHERE campaign_id = ${campaignId} ${fromCondition} ${toCondition}

    UNION ALL

    SELECT 'root_updated' AS type, block_time, signature,
      json_build_object(
        'oldRoot', old_root,
        'newRoot', new_root,
        'newLeafCount', new_leaf_count
      ) AS data
    FROM root_update_events
    WHERE campaign_id = ${campaignId} ${fromCondition} ${toCondition}

    UNION ALL

    SELECT 'withdrawn' AS type, block_time, signature,
      json_build_object('amount', amount::text) AS data
    FROM withdraw_events
    WHERE campaign_id = ${campaignId} ${fromCondition} ${toCondition}

    UNION ALL

    SELECT 'milestone_released' AS type, block_time, signature,
      json_build_object(
        'milestoneIdx', milestone_idx,
        'releasedBy', released_by
      ) AS data
    FROM milestone_events
    WHERE campaign_id = ${campaignId} ${fromCondition} ${toCondition}

    UNION ALL

    SELECT 'stream_cancelled' AS type, block_time, signature,
      json_build_object(
        'cancelledAt', cancelled_at::text,
        'amountToBeneficiary', amount_to_beneficiary::text,
        'amountToCreator', amount_to_creator::text
      ) AS data
    FROM stream_cancel_events
    WHERE campaign_id = ${campaignId} ${fromCondition} ${toCondition}

    UNION ALL

    SELECT 'instant_refunded' AS type, block_time, signature,
      json_build_object(
        'cancelledAt', cancelled_at::text,
        'refundedTo', refunded_to,
        'amount', amount::text
      ) AS data
    FROM instant_refund_events
    WHERE campaign_id = ${campaignId} ${fromCondition} ${toCondition}

    ORDER BY block_time DESC
    LIMIT ${limit}
  `;

  // Count query for total
  const countQuery = sql`
    SELECT (
      (SELECT COUNT(*) FROM claim_events WHERE campaign_id = ${campaignId} ${fromCondition} ${toCondition}) +
      (SELECT COUNT(*) FROM cancel_events WHERE campaign_id = ${campaignId} ${fromCondition} ${toCondition}) +
      (SELECT COUNT(*) FROM pause_events WHERE campaign_id = ${campaignId} ${fromCondition} ${toCondition}) +
      (SELECT COUNT(*) FROM root_update_events WHERE campaign_id = ${campaignId} ${fromCondition} ${toCondition}) +
      (SELECT COUNT(*) FROM withdraw_events WHERE campaign_id = ${campaignId} ${fromCondition} ${toCondition}) +
      (SELECT COUNT(*) FROM milestone_events WHERE campaign_id = ${campaignId} ${fromCondition} ${toCondition}) +
      (SELECT COUNT(*) FROM stream_cancel_events WHERE campaign_id = ${campaignId} ${fromCondition} ${toCondition}) +
      (SELECT COUNT(*) FROM instant_refund_events WHERE campaign_id = ${campaignId} ${fromCondition} ${toCondition})
    ) AS total
  `;

  const [eventsResult, countResult] = await Promise.all([
    db.execute<TimelineRow>(eventsQuery),
    db.execute<{ total: string }>(countQuery),
  ]);

  const events: TimelineEvent[] = eventsResult.map((row) => ({
    type: row.type,
    blockTime: String(row.block_time),
    signature: row.signature,
    data: typeof row.data === "string" ? (JSON.parse(row.data) as Record<string, unknown>) : (row.data as Record<string, unknown>),
  }));

  const total = Number(countResult[0]?.total ?? 0);

  return jsonResponse({ events, total, campaign: treeAddress });
}

export const GET = withRoute(
  { rateLimit: { requests: 60, window: 60 } },
  getTimelineHandler,
);
