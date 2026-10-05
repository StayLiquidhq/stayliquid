import { createHmac } from "node:crypto";

import { NextRequest } from "next/server";

import { constantTimeEquals } from "@/lib/service-auth";

const SIGNATURE_HEADERS = [
  "x-cdp-webhook-signature",
  "x-cdp-signature",
  "x-webhook-signature",
  "x-cc-webhook-signature",
  "coinbase-signature",
];

const TIMESTAMP_HEADERS = [
  "x-cdp-webhook-timestamp",
  "x-cdp-timestamp",
  "x-webhook-timestamp",
  "x-cc-webhook-timestamp",
  "coinbase-timestamp",
];

interface SignatureHeaderParts {
  timestamp: string | null;
  signatures: string[];
}

function extractHeader(request: NextRequest, names: string[]): string | null {
  for (const name of names) {
    const value = request.headers.get(name);

    if (value) return value;
  }

  return null;
}

function parseSignatureHeader(value: string): SignatureHeaderParts {
  const signatures: string[] = [];
  let timestamp: string | null = null;

  for (const part of value.split(",")) {
    const trimmed = part.trim();
    const [key, rawValue] = trimmed.includes("=") ? trimmed.split("=", 2) : ["", trimmed];

    if (key === "t") {
      timestamp = rawValue;
      continue;
    }

    if (key === "v1" || key === "sha256" || key === "") {
      signatures.push(rawValue.replace(/^sha256=/, ""));
    }
  }

  return { timestamp, signatures };
}

function isFreshTimestamp(timestamp: string, toleranceSeconds: number): boolean {
  const numeric = Number(timestamp);
  const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;

  if (!Number.isFinite(millis)) return false;

  return Math.abs(Date.now() - millis) <= toleranceSeconds * 1000;
}

function hmacSha256(value: string, secret: string, encoding: "hex" | "base64"): string {
  return createHmac("sha256", secret).update(value).digest(encoding);
}

export function verifySignedWebhook(
  request: NextRequest,
  rawBody: string,
  secret: string,
  toleranceSeconds = 300
): boolean {
  const signatureHeader = extractHeader(request, SIGNATURE_HEADERS);

  if (!signatureHeader) return false;

  const parsed = parseSignatureHeader(signatureHeader);
  const timestamp = parsed.timestamp ?? extractHeader(request, TIMESTAMP_HEADERS);

  if (!timestamp || !isFreshTimestamp(timestamp, toleranceSeconds)) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedHex = hmacSha256(signedPayload, secret, "hex");
  const expectedBase64 = hmacSha256(signedPayload, secret, "base64");

  return parsed.signatures.some((signature) =>
    constantTimeEquals(signature, expectedHex) || constantTimeEquals(signature, expectedBase64)
  );
}
