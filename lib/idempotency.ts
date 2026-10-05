import { createHash } from "crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { optionalEnv } from "@/lib/env";

const HEADER_NAME = "idempotency-key";

const PROCESSING_TTL_SECONDS = Number(optionalEnv("IDEMPOTENCY_PROCESSING_TTL_SECONDS") ?? 900);

const COMPLETED_TTL_SECONDS = Number(optionalEnv("IDEMPOTENCY_COMPLETED_TTL_SECONDS") ?? 86_400);

const RedisStringResultSchema = z.string();

const ClaimScriptResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("claimed") }),
  z.object({ outcome: z.literal("conflict") }),
  z.object({ outcome: z.literal("mismatch") }),
  z.object({
    outcome: z.literal("replay"),
    response_status: z.number().int().nullable(),
    response_body: z.unknown().nullable(),
  }),
]);

const claimScript = `
local status = redis.call("HGET", KEYS[1], "status")

if not status then
  redis.call("HSET", KEYS[1],
    "status", "processing",
    "request_hash", ARGV[1],
    "user_id", ARGV[2],
    "created_at", ARGV[3]
  )
  redis.call("EXPIRE", KEYS[1], tonumber(ARGV[4]))
  return cjson.encode({ outcome = "claimed" })
end

local request_hash = redis.call("HGET", KEYS[1], "request_hash") or ""

if request_hash ~= ARGV[1] then
  return cjson.encode({ outcome = "mismatch" })
end

if status == "completed" then
  local response_status = tonumber(redis.call("HGET", KEYS[1], "response_status") or "200")
  local response_body = redis.call("HGET", KEYS[1], "response_body") or "null"
  return cjson.encode({
    outcome = "replay",
    response_status = response_status,
    response_body = cjson.decode(response_body)
  })
end

return cjson.encode({ outcome = "conflict" })
`;

const completeScript = `
if redis.call("EXISTS", KEYS[1]) == 0 then
  return 0
end

redis.call("HSET", KEYS[1],
  "status", "completed",
  "response_status", ARGV[1],
  "response_body", ARGV[2],
  "completed_at", ARGV[3]
)
redis.call("EXPIRE", KEYS[1], tonumber(ARGV[4]))
return 1
`;

export interface IdempotencyOptions<TPayload = undefined> {
  scope: string;
  key?: string | null;
  userId?: string | null;
  payload?: TPayload;
  required?: boolean;
}

type ClaimResult =
  | { kind: "claimed" }
  | { kind: "replay"; response: NextResponse }
  | { kind: "conflict" }
  | { kind: "mismatch" }
  | { kind: "error" };

function redisKey(scope: string, key: string): string {
  return `idempotency:${createHash("sha256").update(`${scope}:${key}`).digest("hex")}`;
}

function hashPayload<TPayload>(payload: TPayload | undefined): string | null {
  if (payload === undefined) return null;

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function releaseKey(scope: string, key: string): Promise<void> {
  try {
    await getRedis().del(redisKey(scope, key));
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    logger.warn("Failed to release Redis idempotency key", { module: "idempotency", scope }, errorObj);
  }
}

async function completeKey(scope: string, key: string, response: NextResponse): Promise<void> {
  let body = null;

  try {
    body = await response.clone().json();
  } catch {
    body = null;
  }

  try {
    await getRedis().eval(
      completeScript,
      [redisKey(scope, key)],
      [String(response.status), JSON.stringify(body), new Date().toISOString(), String(COMPLETED_TTL_SECONDS)]
    );
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    logger.error("Failed to persist Redis idempotent response", { module: "idempotency", scope }, errorObj);
  }
}

async function claimKey(
  scope: string,
  key: string,
  userId: string | null,
  requestHash: string | null,
): Promise<ClaimResult> {
  try {
    const result = await getRedis().eval(
      claimScript,
      [redisKey(scope, key)],
      [requestHash ?? "", userId ?? "", new Date().toISOString(), String(PROCESSING_TTL_SECONDS)]
    );

    const parsedJson = JSON.parse(RedisStringResultSchema.parse(result));
    const parsed = ClaimScriptResultSchema.safeParse(parsedJson);

    if (!parsed.success) return { kind: "error" };

    if (parsed.data.outcome === "claimed") return { kind: "claimed" };

    if (parsed.data.outcome === "mismatch") return { kind: "mismatch" };

    if (parsed.data.outcome === "conflict") return { kind: "conflict" };

    return {
      kind: "replay",
      response: NextResponse.json(parsed.data.response_body, {
        status: parsed.data.response_status ?? 200,
        headers: { "Idempotent-Replayed": "true" },
      }),
    };
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    logger.error("Failed to claim Redis idempotency key", { module: "idempotency", scope }, errorObj);

    return { kind: "error" };
  }
}

export async function withIdempotency<TPayload = undefined>(
  request: NextRequest,
  options: IdempotencyOptions<TPayload>,
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const key = options.key ?? request.headers.get(HEADER_NAME);

  if (!key) {
    if (options.required) {
      return NextResponse.json({ error: "Missing Idempotency-Key header" }, { status: 400 });
    }

    return handler();
  }

  const claim = await claimKey(options.scope, key, options.userId ?? null, hashPayload(options.payload));

  if (claim.kind === "replay") return claim.response;

  if (claim.kind === "mismatch") {
    return NextResponse.json(
      { error: "Idempotency-Key was already used with a different payload" },
      { status: 409 },
    );
  }

  if (claim.kind === "conflict") {
    return NextResponse.json({ error: "Request is already being processed" }, { status: 409 });
  }

  if (claim.kind === "error") {
    return NextResponse.json({ error: "Failed to process idempotent request" }, { status: 500 });
  }

  let response: NextResponse;

  try {
    response = await handler();
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    logger.error("Idempotent handler failed", { module: "idempotency", scope: options.scope }, errorObj);

    response = NextResponse.json({ error: "Request processing failed" }, { status: 500 });
  }

  if (response.status >= 400 && response.status < 500) {
    await releaseKey(options.scope, key);
  } else {
    await completeKey(options.scope, key, response);
  }

  return response;
}
