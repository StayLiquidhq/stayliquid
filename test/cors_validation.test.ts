import test from "node:test";
import assert from "node:assert/strict";
import { getCorsHeaders, getAllowedOrigins } from "../lib/cors";

process.env.CORS_ALLOWED_ORIGINS = "https://liquid-frontend-gray.vercel.app";

test("CORS: should allow production frontend origin", () => {
  const allowed = getAllowedOrigins();
  assert.ok(allowed.has("https://liquid-frontend-gray.vercel.app"));

  const headers = getCorsHeaders("https://liquid-frontend-gray.vercel.app");
  assert.equal(headers["Access-Control-Allow-Origin"], "https://liquid-frontend-gray.vercel.app");
  assert.equal(headers["Access-Control-Allow-Credentials"], "true");
  assert.equal(headers["Access-Control-Allow-Methods"], "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  console.log("✔ Production origin CORS response:", headers);
});

test("CORS: should reject disallowed origin with no Access-Control-Allow-Origin header", () => {
  const headers = getCorsHeaders("https://malicious-website.com");
  assert.equal(headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(headers["Access-Control-Allow-Credentials"], undefined);
  console.log("✔ Disallowed origin headers (strict web security):", headers);
});

test("CORS: should not provide wildcard or allow header when origin is null", () => {
  const headers = getCorsHeaders(null);
  assert.equal(headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(headers["Access-Control-Allow-Credentials"], undefined);
  console.log("✔ Null origin headers (strictly web application):", headers);
});
