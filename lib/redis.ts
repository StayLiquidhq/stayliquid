import Redis from "ioredis";
import { z } from "zod";
import { optionalEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { Json } from "@/lib/supabase/types";

export type RedisEvalResult = string | number | null;

const JsonValueSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
);

const RedisEvalResultSchema = z.union([z.string(), z.number(), z.null()]);

export interface RedisClient {
  eval(script: string, keys: string[], args: (string | number)[]): Promise<RedisEvalResult>;
  del(key: string): Promise<number>;
  isReady(): boolean;
  close(): Promise<void>;
}

// In-memory fallback stores for when REDIS_URL is not configured
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface IdempotencyEntry {
  status: "processing" | "completed";
  requestHash: string;
  userId: string;
  createdAt: string;
  expiresAt: number;
  responseStatus?: number;
  responseBody?: Json;
}

class InMemoryRedisClient implements RedisClient {
  private rateLimits = new Map<string, RateLimitEntry>();
  private idempotency = new Map<string, IdempotencyEntry>();

  isReady(): boolean {
    return true;
  }

  async del(key: string): Promise<number> {
    const deletedRate = this.rateLimits.delete(key);
    const deletedIdem = this.idempotency.delete(key);

    return (deletedRate || deletedIdem) ? 1 : 0;
  }

  async eval(script: string, keys: string[], args: (string | number)[]): Promise<RedisEvalResult> {
    const key = keys[0] ?? "";
    const now = Date.now();

    // 1. Rate Limiting Script Emulation
    if (script.includes("window_ms")) {
      const limit = Number(args[0]);
      const windowMs = Number(args[1]);
      const nowMs = Number(args[2]) || now;

      let entry = this.rateLimits.get(key);

      if (!entry || entry.resetAt <= nowMs) {
        entry = { count: 1, resetAt: nowMs + windowMs };
        this.rateLimits.set(key, entry);

        return JSON.stringify({
          allowed: true,
          limit,
          remaining: Math.max(limit - 1, 0),
          reset_at: entry.resetAt,
        });
      }

      if (entry.count >= limit) {
        return JSON.stringify({
          allowed: false,
          limit,
          remaining: 0,
          reset_at: entry.resetAt,
        });
      }

      entry.count += 1;

      return JSON.stringify({
        allowed: true,
        limit,
        remaining: Math.max(limit - entry.count, 0),
        reset_at: entry.resetAt,
      });
    }

    // 2. Idempotency Claim Script Emulation
    if (script.includes("request_hash")) {
      const requestHash = String(args[0] ?? "");
      const userId = String(args[1] ?? "");
      const createdAt = String(args[2] ?? new Date().toISOString());
      const expireSeconds = Number(args[3]) || 900;

      const existing = this.idempotency.get(key);

      if (!existing || existing.expiresAt <= now) {
        this.idempotency.set(key, {
          status: "processing",
          requestHash,
          userId,
          createdAt,
          expiresAt: now + expireSeconds * 1000,
        });

        return JSON.stringify({ outcome: "claimed" });
      }

      if (existing.requestHash !== requestHash) {
        return JSON.stringify({ outcome: "mismatch" });
      }

      if (existing.status === "completed") {
        return JSON.stringify({
          outcome: "replay",
          response_status: existing.responseStatus ?? 200,
          response_body: existing.responseBody ?? null,
        });
      }

      return JSON.stringify({ outcome: "conflict" });
    }

    // 3. Idempotency Complete Script Emulation
    if (script.includes("completed_at")) {
      const responseStatus = Number(args[0]);
      let responseBody: Json = null;

      try {
        const parsed = JSON.parse(String(args[1]));
        const validated = JsonValueSchema.safeParse(parsed);
        responseBody = validated.success ? validated.data : null;
      } catch {
        responseBody = String(args[1]);
      }

      const expireSeconds = Number(args[3]) || 86400;
      const existing = this.idempotency.get(key);

      if (!existing) {
        return 0;
      }

      existing.status = "completed";
      existing.responseStatus = responseStatus;
      existing.responseBody = responseBody;
      existing.expiresAt = now + expireSeconds * 1000;

      return 1;
    }

    throw new Error("Unsupported Lua script in InMemoryRedisClient");
  }

  async close(): Promise<void> {
    this.rateLimits.clear();
    this.idempotency.clear();
  }
}

class StandardRedisClient implements RedisClient {
  private client: Redis;
  private ready = false;

  constructor(url: string) {
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy(times) {
        if (times > 5) return null;

        return Math.min(times * 100, 2000);
      },
    });

    this.client.on("connect", () => {
      this.ready = true;
      logger.info("Connected to Redis server", { module: "redis" });
    });

    this.client.on("error", (err) => {
      this.ready = false;
      logger.warn("Redis connection error", { module: "redis" }, err);
    });

    this.client.on("close", () => {
      this.ready = false;
    });

    // Initiate connection asynchronously
    this.client.connect().catch((err) => {
      logger.warn("Initial Redis connection failed (will retry or fail open)", { module: "redis" }, err);
    });
  }

  isReady(): boolean {
    return this.ready;
  }

  async del(key: string): Promise<number> {
    return await this.client.del(key);
  }

  async eval(script: string, keys: string[], args: (string | number)[]): Promise<RedisEvalResult> {
    const raw = await this.client.eval(script, keys.length, ...keys, ...args);
    const validated = RedisEvalResultSchema.safeParse(raw);

    return validated.success ? validated.data : null;
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

let redisInstance: RedisClient | null = null;

export function getRedis(): RedisClient {
  if (redisInstance) {
    return redisInstance;
  }

  const redisUrl = optionalEnv("REDIS_URL");

  if (redisUrl && redisUrl.trim().length > 0) {
    logger.info("Initializing standard Redis client with REDIS_URL", { module: "redis" });
    redisInstance = new StandardRedisClient(redisUrl.trim());

    return redisInstance;
  }

  logger.info("No REDIS_URL configured; using in-memory client for rate limiting and idempotency", {
    module: "redis",
  });
  redisInstance = new InMemoryRedisClient();

  return redisInstance;
}

export function closeRedis(): Promise<void> {
  if (redisInstance) {
    const client = redisInstance;
    redisInstance = null;

    return client.close();
  }

  return Promise.resolve();
}
