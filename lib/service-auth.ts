import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { optionalEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

function constantTimeEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function getBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) return null;

  return authHeader.slice("Bearer ".length).trim();
}

export function verifyServiceToken(request: NextRequest): boolean {
  const token = getBearerToken(request);
  const expected = optionalEnv("SERVICE_AUTH_TOKEN");

  if (!token || !expected) return false;

  return constantTimeEquals(token, expected);
}

export function unauthorizedServiceResponse(
  module: string,
  headers?: Record<string, string>
): NextResponse {
  logger.warn("Unauthorized service request", { module });

  return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
}

export { constantTimeEquals };
