import { NextRequest, NextResponse } from "next/server";

import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import { optionalEnv } from "@/lib/env";
import { enforceRateLimit } from "@/lib/rate-limit";
import { unauthorizedServiceResponse, verifyServiceToken } from "@/lib/service-auth";
import { setTelegramWebhook } from "@/lib/telegram";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  const rateLimited = await enforceRateLimit(request, {
    scope: "telegram-setup",
    limit: 10,
    windowSeconds: 60,
    headers: corsHeaders,
  });

  if (rateLimited) return rateLimited;

  if (!verifyServiceToken(request)) {
    return unauthorizedServiceResponse("telegram/setup", corsHeaders);
  }

  const baseUrl = optionalEnv("TELEGRAM_WEBHOOK_URL");

  if (!baseUrl) {
    return NextResponse.json(
      { error: "TELEGRAM_WEBHOOK_URL is not set" },
      { status: 500, headers: corsHeaders }
    );
  }

  const webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`;
  const ok = await setTelegramWebhook(webhookUrl, optionalEnv("TELEGRAM_WEBHOOK_SECRET") ?? undefined);

  return NextResponse.json({ ok, url: webhookUrl }, { headers: corsHeaders });
}
