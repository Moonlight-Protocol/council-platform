import type { Middleware } from "@oak/oak";
import { LOG } from "@/config/logger.ts";
import { EXCEEDED_LIMIT, FAILED_TO_DETECT_IP } from "@/http/middleware/rate-limit/error.ts";
import { PIPE_APIError } from "@/http/pipelines/error-pipeline.ts";

const MAX_ENTRIES = 10_000;

export function createRateLimitMiddleware(
  limit: number,
  windowMs: number
): Middleware {
  const rateLimitMap = new Map<string, { count: number; timestamp: number }>();

  function evictStale(now: number) {
    if (rateLimitMap.size <= MAX_ENTRIES) return;
    for (const [key, entry] of rateLimitMap) {
      if (now - entry.timestamp > windowMs) {
        rateLimitMap.delete(key);
      }
    }
    // If still over limit after evicting stale, drop oldest entries
    if (rateLimitMap.size > MAX_ENTRIES) {
      const excess = rateLimitMap.size - MAX_ENTRIES;
      let deleted = 0;
      for (const key of rateLimitMap.keys()) {
        if (deleted >= excess) break;
        rateLimitMap.delete(key);
        deleted++;
      }
    }
  }

  function checkRate(clientIP: string, now: number): boolean {
    evictStale(now);
    let entry = rateLimitMap.get(clientIP);

    if (!entry || now - entry.timestamp > windowMs) {
      entry = { count: 0, timestamp: now };
    }

    entry.count++;
    rateLimitMap.set(clientIP, entry);

    return entry.count > limit;
  }

  return async (ctx, next) => {
    try {
      const clientIP = ctx.request.ip;
      const now = Date.now();

      if (checkRate(clientIP, now)) {
        LOG.warn(`[RateLimit] Rate limit exceeded for IP: ${clientIP}`);
        return await PIPE_APIError(ctx).run(new EXCEEDED_LIMIT() as unknown as Error);
      }
    } catch (error) {
      const warningError = new FAILED_TO_DETECT_IP(error) as FAILED_TO_DETECT_IP & Error;
      LOG.error(warningError.message, warningError);

      const clientIP =
        ctx.request.headers.get("x-forwarded-for") ||
        ctx.request.headers.get("x-real-ip") ||
        "unknown";
      const now = Date.now();

      if (checkRate(clientIP, now)) {
        LOG.warn(`[RateLimit] Rate limit exceeded for IP: ${clientIP}`);
        return await PIPE_APIError(ctx).run(new EXCEEDED_LIMIT() as unknown as Error);
      }
    }

    await next();
  };
}

export const globalRateLimitMiddleware = createRateLimitMiddleware(100, 60 * 1000);
export const lowRateLimitMiddleware = createRateLimitMiddleware(10, 60 * 1000);
