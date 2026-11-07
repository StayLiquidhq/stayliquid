import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { unauthorizedServiceResponse, verifyServiceToken } from "@/lib/service-auth";
import {
  executeRecurringJobSafely,
  executeTargetJobSafely,
} from "@/lib/cron";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

const TriggerBodySchema = z.object({
  job: z.enum(["target", "recurring", "all"]).optional(),
});

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  const rateLimited = await enforceRateLimit(request, {
    scope: "cron-trigger",
    limit: 15,
    windowSeconds: 60,
    headers: corsHeaders,
  });

  if (rateLimited) return rateLimited;

  if (!verifyServiceToken(request)) {
    return unauthorizedServiceResponse("cron/trigger", corsHeaders);
  }

  const rawBody = await request.json().catch(() => ({}));
  const parsed = TriggerBodySchema.safeParse(rawBody);
  const target = parsed.success && parsed.data.job ? parsed.data.job : "all";

  let targetResults = null;
  let recurringResults = null;

  if (target === "target" || target === "all") {
    targetResults = await executeTargetJobSafely();
  }

  if (target === "recurring" || target === "all") {
    recurringResults = await executeRecurringJobSafely();
  }

  return NextResponse.json(
    {
      ok: true,
      job: target,
      target: targetResults,
      recurring: recurringResults,
    },
    { headers: corsHeaders }
  );
}
