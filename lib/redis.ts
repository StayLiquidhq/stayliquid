import { Redis } from "@upstash/redis";

import { requireEnv } from "@/lib/env";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      url: requireEnv("UPSTASH_REDIS_REST_URL"),
      token: requireEnv("UPSTASH_REDIS_REST_TOKEN"),
      automaticDeserialization: false,
    });
  }

  return redis;
}
