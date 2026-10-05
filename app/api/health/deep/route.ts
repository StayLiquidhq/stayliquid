import { NextRequest, NextResponse } from "next/server";

import supabase from "@/utils/supabase";
import { getSolanaConnection } from "@/lib/solana";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { unauthorizedServiceResponse, verifyServiceToken } from "@/lib/service-auth";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  const rateLimited = await enforceRateLimit(request, {
    scope: "health-deep",
    limit: 30,
    windowSeconds: 60,
    headers: corsHeaders,
  });

  if (rateLimited) return rateLimited;

  if (!verifyServiceToken(request)) {
    return unauthorizedServiceResponse("health/deep", corsHeaders);
  }

  const startTime = Date.now();
  const checks: Record<string, { status: "ok" | "error"; latencyMs?: number; errorCode?: string }> = {};

  const dbStart = Date.now();

  try {
    const { error } = await supabase.from("wallets").select("id", { count: "exact", head: true });

    if (error) throw error;
    checks.database = { status: "ok", latencyMs: Date.now() - dbStart };
  } catch {
    checks.database = {
      status: "error",
      latencyMs: Date.now() - dbStart,
      errorCode: "DATABASE_UNAVAILABLE",
    };
  }

  const rpcStart = Date.now();

  try {
    const connection = getSolanaConnection("confirmed");
    await connection.getLatestBlockhash("confirmed");
    checks.solana_rpc = { status: "ok", latencyMs: Date.now() - rpcStart };
  } catch {
    checks.solana_rpc = {
      status: "error",
      latencyMs: Date.now() - rpcStart,
      errorCode: "SOLANA_RPC_UNAVAILABLE",
    };
  }

  const isHealthy = Object.values(checks).every((c) => c.status === "ok");

  return NextResponse.json(
    {
      status: isHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      uptimeSeconds: process.uptime(),
      totalLatencyMs: Date.now() - startTime,
      checks,
    },
    { status: isHealthy ? 200 : 503, headers: corsHeaders }
  );
}
