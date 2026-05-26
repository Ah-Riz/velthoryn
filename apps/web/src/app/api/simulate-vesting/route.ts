import type { NextRequest } from "next/server";
import { z } from "zod";
import { jsonResponse } from "@/lib/api/json-response";
import { ValidationError } from "@/lib/api/errors";
import { withRoute } from "@/lib/api/route-wrapper";
import { vested } from "@/lib/vesting/schedule";
import type { VestingSchedule, ReleaseType } from "@/lib/vesting/schedule";

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const numericString = z
  .string()
  .min(1)
  .refine((val) => /^\d+$/.test(val), "Must be a numeric string");

const simulateVestingSchema = z
  .object({
    amount: numericString,
    releaseType: z.number().int().min(0).max(2),
    startTime: numericString,
    cliffTime: numericString,
    endTime: numericString,
  })
  .refine(
    (d) => {
      try {
        return BigInt(d.amount) > 0n;
      } catch {
        return true;
      }
    },
    { message: "amount must be positive" },
  )
  .refine(
    (d) => {
      try {
        const start = BigInt(d.startTime);
        const cliff = BigInt(d.cliffTime);
        const end = BigInt(d.endTime);
        return start <= cliff && cliff <= end && start < end;
      } catch {
        return true;
      }
    },
    { message: "startTime must be before endTime (and cliffTime must be between them)" },
  );

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RELEASE_TYPE_LABELS = ["cliff", "linear", "milestone"] as const;

function formatDate(ts: bigint): string {
  return new Date(Number(ts) * 1000).toISOString().split("T")[0];
}

/**
 * Generates monthly timestamp snapshots from startTime up to (and including)
 * endTime. Each step advances the calendar by one month from the start date.
 */
function generateMonthlyTimestamps(startTime: bigint, endTime: bigint): bigint[] {
  const timestamps: bigint[] = [];

  const startDate = new Date(Number(startTime) * 1000);
  let year = startDate.getUTCFullYear();
  let month = startDate.getUTCMonth();
  const day = startDate.getUTCDate();

  while (true) {
    const date = new Date(Date.UTC(year, month, day));
    const ts = BigInt(Math.floor(date.getTime() / 1000));

    if (ts >= endTime) break;

    timestamps.push(ts);

    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  // Always terminate at the exact endTime so the final cumulative == totalAmount
  timestamps.push(endTime);

  return timestamps;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function postSimulateVestingHandler(request: NextRequest) {
  const body = await request.json();
  const parsed = simulateVestingSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Validation failed", parsed.error.issues);
  }

  const { amount, releaseType, startTime, cliffTime, endTime } = parsed.data;

  const amountBig = BigInt(amount);
  const startTimeBig = BigInt(startTime);
  const cliffTimeBig = BigInt(cliffTime);
  const endTimeBig = BigInt(endTime);

  const schedule: VestingSchedule = {
    amount: amountBig,
    releaseType: releaseType as ReleaseType,
    startTime: startTimeBig,
    cliffTime: cliffTimeBig,
    endTime: endTimeBig,
  };

  const durationDays = Math.floor(Number(endTimeBig - startTimeBig) / 86400);
  const timestamps = generateMonthlyTimestamps(startTimeBig, endTimeBig);

  const breakdown = timestamps.map((ts, i) => {
    const cumulative = vested(schedule, ts);
    const prevCumulative = i === 0 ? 0n : vested(schedule, timestamps[i - 1]);
    const vestedThisMonth = cumulative - prevCumulative;

    // Round percent to 2 decimal places without floating point drift
    const percent =
      amountBig > 0n ? Math.round(Number((cumulative * 10000n) / amountBig)) / 100 : 0;

    return {
      date: formatDate(ts),
      vested: vestedThisMonth.toString(),
      cumulative: cumulative.toString(),
      percent,
    };
  });

  return jsonResponse({
    schedule: RELEASE_TYPE_LABELS[releaseType],
    totalAmount: amount,
    durationDays,
    breakdown,
  });
}

// Public computation endpoint — rate limited, no wallet auth required
export const POST = withRoute(
  { rateLimit: { requests: 30, window: 60 } },
  postSimulateVestingHandler,
);
