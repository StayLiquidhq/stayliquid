import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

interface RateLimitOptions {
  scope: string;
  limit: number;
  windowSeconds: number;
  identity?: string | null;
  headers?: Record<string, string>;
  failClosed?: boolean;
}

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset_at: string;
}

const RateLimitResultSchema = z.object({
  allowed: z.boolean(),
  limit: z.number(),
  remaining: z.number(),
  reset_at: z.number(),
});

const RedisStringResultSchema = z.string();

const rateLimitScript = `
local limit = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])

local count = redis.call("GET", KEYS[1])

if not count then
  redis.call("PSETEX", KEYS[1], window_ms, "1")
  return cjson.encode({
    allowed = true,
    limit = limit,
    remaining = limit - 1,
    reset_at = now_ms + window_ms
  })
end

local ttl = redis.call("PTTL", KEYS[1])

if ttl < 0 then
  redis.call("PSETEX", KEYS[1], window_ms, "1")
  return cjson.encode({
    allowed = true,
    limit = limit,
    remaining = limit - 1,
    reset_at = now_ms + window_ms
  })
end

local current = tonumber(count)

if current >= limit then
  return cjson.encode({
    allowed = false,
    limit = limit,
    remaining = 0,
    reset_at = now_ms + ttl
  })
end

local next_count = redis.call("INCR", KEYS[1])

return cjson.encode({
  allowed = true,
  limit = limit,
  remaining = math.max(limit - next_count, 0),
  reset_at = now_ms + ttl
})
`;

export function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();

  return forwardedFor || realIp || "unknown";
}

function hashRateLimitKey(value: string): string {
  return `rate-limit:${createHash("sha256").update(value).digest("hex")}`;
}

function parseRateLimitResult(value: string): RateLimitResult | null {
  const parsed = RateLimitResultSchema.safeParse(JSON.parse(value));

  if (!parsed.success) return null;

  return {
    ...parsed.data,
    reset_at: new Date(parsed.data.reset_at).toISOString(),
  };
}

export async function enforceRateLimit(
  request: NextRequest,
  options: RateLimitOptions
): Promise<NextResponse | null> {
  const identity = options.identity || getClientIp(request);
  const key = hashRateLimitKey(`${options.scope}:${identity}`);

  let result: RateLimitResult | null = null;

  try {
    const rawResult = await getRedis().eval(
      rateLimitScript,
      [key],
      [String(options.limit), String(options.windowSeconds * 1000), String(Date.now())]
    );

    result = parseRateLimitResult(RedisStringResultSchema.parse(rawResult));
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    logger.error("Redis rate limit check failed", { module: "rate-limit", scope: options.scope }, errorObj);

    if (options.failClosed ?? true) {
      return NextResponse.json(
        { error: "Rate limit unavailable" },
        { status: 503, headers: options.headers }
      );
    }

    return null;
  }

  if (!result) {
    logger.error("Redis rate limit script returned an invalid result", { module: "rate-limit", scope: options.scope });

    return NextResponse.json(
      { error: "Rate limit unavailable" },
      { status: 503, headers: options.headers }
    );
  }

  if (result.allowed) return null;

  const resetMs = new Date(result.reset_at).getTime() - Date.now();
  const retryAfter = Math.max(1, Math.ceil(resetMs / 1000));

  return NextResponse.json(
    { error: "Too many requests" },
    {
      status: 429,
      headers: {
        ...options.headers,
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": result.reset_at,
      },
    }
  );
}
