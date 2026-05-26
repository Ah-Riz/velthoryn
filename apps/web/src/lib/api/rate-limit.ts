import { Ratelimit } from "@upstash/ratelimit";
import type { NextRequest } from "next/server";
import { getRedis, hasUpstashRedis } from "@/lib/api/redis";

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number;
}

const upstashLimiterCache = new Map<string, Ratelimit>();
const memoryBuckets = new Map<string, { count: number; reset: number }>();

function getUpstashLimiter(requests: number, windowSeconds: number): Ratelimit {
  const key = `${requests}:${windowSeconds}`;
  let limiter = upstashLimiterCache.get(key);
  if (!limiter) {
    limiter = new Ratelimit({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      redis: getRedis() as any,
      limiter: Ratelimit.fixedWindow(requests, `${windowSeconds} s`),
      prefix: "velthoryn:rl",
    });
    upstashLimiterCache.set(key, limiter);
  }
  return limiter;
}

function memoryRateLimit(
  key: string,
  limits: { requests: number; window: number },
): RateLimitResult {
  const windowMs = limits.window * 1000;
  const now = Date.now();
  const bucketKey = `${key}:${limits.requests}:${limits.window}`;
  const existing = memoryBuckets.get(bucketKey);

  if (!existing || existing.reset <= now) {
    const reset = now + windowMs;
    memoryBuckets.set(bucketKey, { count: 1, reset });
    return {
      success: true,
      remaining: limits.requests - 1,
      reset,
    };
  }

  if (existing.count >= limits.requests) {
    return {
      success: false,
      remaining: 0,
      reset: existing.reset,
    };
  }

  existing.count += 1;
  return {
    success: true,
    remaining: limits.requests - existing.count,
    reset: existing.reset,
  };
}

export function resetRateLimitForTests(): void {
  memoryBuckets.clear();
  upstashLimiterCache.clear();
}

export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function rateLimit(
  key: string,
  limits: { requests: number; window: number },
): Promise<RateLimitResult> {
  if (process.env.NODE_ENV === "test") {
    return {
      success: true,
      remaining: limits.requests,
      reset: Date.now() + limits.window * 1000,
    };
  }

  if (!hasUpstashRedis()) {
    return memoryRateLimit(key, limits);
  }

  const limiter = getUpstashLimiter(limits.requests, limits.window);
  const result = await limiter.limit(key);

  return {
    success: result.success,
    remaining: result.remaining,
    reset: result.reset,
  };
}

export function retryAfterSeconds(reset: number): number {
  const seconds = Math.ceil((reset - Date.now()) / 1000);
  return Math.max(1, seconds);
}
