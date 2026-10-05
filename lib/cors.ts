import { NextRequest, NextResponse } from "next/server";

export function getAllowedOrigins(): Set<string> {
  const origins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set(origins);
}

export interface CorsHeaders {
  [header: string]: string;
}

export interface OriginValidationResult {
  isAllowed: boolean;
  headers: CorsHeaders;
}

export function getCorsHeaders(origin: string | null): CorsHeaders {
  const allowed = getAllowedOrigins();

  const headers: CorsHeaders = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, x-cdp-webhook-signature, x-cdp-webhook-timestamp, x-webhook-signature, x-webhook-timestamp, x-cc-webhook-signature, x-cc-webhook-timestamp",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };

  if (origin && allowed.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  return headers;
}

export function handleCorsPreflight(request: NextRequest): NextResponse {
  const origin = request.headers.get("origin");
  const headers = getCorsHeaders(origin);
  const isAllowed = origin !== null && getAllowedOrigins().has(origin);

  return new NextResponse(null, { status: isAllowed ? 204 : 403, headers });
}

export function validateOrigin(request: NextRequest): OriginValidationResult {
  const origin = request.headers.get("origin");
  const headers = getCorsHeaders(origin);

  if (!origin) {
    return { isAllowed: false, headers };
  }

  const allowed = getAllowedOrigins();

  return { isAllowed: allowed.has(origin), headers };
}
