import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";
import { jsonResponse } from "@/lib/api/json-response";

const patchStatusSchema = z
  .object({
    paused: z.boolean().optional(),
    cancelledAt: z.number().nullable().optional(),
    totalClaimed: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).optional(),
    instantRefunded: z.boolean().optional(),
  })
  .refine((d) => d.paused !== undefined || d.cancelledAt !== undefined || d.totalClaimed !== undefined || d.instantRefunded !== undefined, {
    message: "No valid fields to update",
  });

async function patchCampaignStatusHandler(
  request: NextRequest,
  { params }: { params: Promise<{ treeAddress: string }> },
) {
  const { treeAddress } = await params;
  const body = await request.json();
  const parsed = patchStatusSchema.safeParse(body);

  if (!parsed.success) {
    throw new ValidationError("No valid fields to update", parsed.error.issues);
  }

  const [existing] = await db
    .select({ id: campaigns.id, cancelledAt: campaigns.cancelledAt })
    .from(campaigns)
    .where(eq(campaigns.treeAddress, treeAddress))
    .limit(1);

  if (!existing) {
    throw new NotFoundError("Campaign");
  }

  if (parsed.data.paused === true && (existing.cancelledAt !== null || parsed.data.cancelledAt !== undefined)) {
    throw new ValidationError("Cancelled campaigns cannot be paused");
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.paused !== undefined) updates.paused = parsed.data.paused;
  if (parsed.data.cancelledAt !== undefined) {
    updates.cancelledAt = parsed.data.cancelledAt;
    if (parsed.data.cancelledAt !== null) updates.paused = false;
  }
  if (parsed.data.totalClaimed !== undefined) {
    const totalClaimed = BigInt(parsed.data.totalClaimed);
    updates.totalClaimed = sql`GREATEST(${campaigns.totalClaimed}, ${totalClaimed})`;
  }
  if (parsed.data.instantRefunded !== undefined) {
    updates.instantRefunded = parsed.data.instantRefunded;
  }

  await db
    .update(campaigns)
    .set(updates)
    .where(eq(campaigns.treeAddress, treeAddress))
    .returning({ id: campaigns.id });

  return jsonResponse({ ok: true });
}

export const PATCH = withRoute(
  { rateLimit: { requests: 10, window: 60 }, bodyLimit: "default" },
  patchCampaignStatusHandler,
);
