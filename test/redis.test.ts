import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { getRedis, closeRedis } from "../lib/redis";

test("Redis client: in-memory / standard evaluation works correctly", async (t) => {
  const redis = getRedis();
  assert.ok(redis, "Redis client must be initialized");

  t.after(async () => {
    await closeRedis();
  });

  const StringResultSchema = z.string();

  // 1. Rate limiting Lua script test
  const rateLimitScript = `
    local limit = tonumber(ARGV[1])
    local window_ms = tonumber(ARGV[2])
    local now_ms = tonumber(ARGV[3])
    return cjson.encode({ allowed = true, limit = limit, remaining = limit - 1, reset_at = now_ms + window_ms })
  `;

  const key1 = "test:ratelimit:" + Date.now();
  const raw1 = await redis.eval(rateLimitScript, [key1], [5, 60000, Date.now()]);
  const parsedString1 = StringResultSchema.safeParse(raw1);
  assert.equal(parsedString1.success, true);
  if (!parsedString1.success) throw new Error("Expected string");
  const parsed1 = JSON.parse(parsedString1.data);
  assert.equal(parsed1.allowed, true);
  assert.equal(parsed1.limit, 5);
  assert.equal(parsed1.remaining, 4);

  // 2. Consume remaining limit
  for (let i = 0; i < 4; i++) {
    await redis.eval(rateLimitScript, [key1], [5, 60000, Date.now()]);
  }

  // 3. Rate limited request
  const rawBlocked = await redis.eval(rateLimitScript, [key1], [5, 60000, Date.now()]);
  const parsedBlockedString = StringResultSchema.safeParse(rawBlocked);
  assert.equal(parsedBlockedString.success, true);
  if (!parsedBlockedString.success) throw new Error("Expected string");
  const parsedBlocked = JSON.parse(parsedBlockedString.data);
  assert.equal(parsedBlocked.allowed, false);
  assert.equal(parsedBlocked.remaining, 0);

  // 4. Idempotency claim and complete
  const claimScript = `
    local status = redis.call("HGET", KEYS[1], "status")
    local request_hash = ARGV[1]
    return cjson.encode({ outcome = "claimed" })
  `;

  const idemKey = "test:idem:" + Date.now();
  const rawClaim = await redis.eval(claimScript, [idemKey], ["req_hash_1", "user_1", new Date().toISOString(), 900]);
  const parsedClaimString = StringResultSchema.safeParse(rawClaim);
  assert.equal(parsedClaimString.success, true);
  if (!parsedClaimString.success) throw new Error("Expected string");
  const parsedClaim = JSON.parse(parsedClaimString.data);
  assert.equal(parsedClaim.outcome, "claimed");

  // 5. Complete idempotency
  const completeScript = `
    local completed_at = ARGV[3]
    return 1
  `;
  const compResult = await redis.eval(completeScript, [idemKey], [200, JSON.stringify({ success: true }), new Date().toISOString(), 86400]);
  assert.equal(compResult, 1);

  // 6. Delete key
  const delCount = await redis.del(idemKey);
  assert.equal(delCount, 1);
});
