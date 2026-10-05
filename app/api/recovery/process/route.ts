import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import { processTransferRecoveryJobs } from "@/lib/recovery";
import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/rate-limit";
import { unauthorizedServiceResponse, verifyServiceToken } from "@/lib/service-auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

const ProcessRecoverySchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
});

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const rateLimited = await enforceRateLimit(request, {
      scope: "recovery-process",
      limit: 120,
      windowSeconds: 60,
      headers: corsHeaders,
    });

    if (rateLimited) return rateLimited;

    if (!verifyServiceToken(request)) {
      return unauthorizedServiceResponse("recovery/process", corsHeaders);
    }

    const body = await request.json().catch(() => ({}));
    const parsed = ProcessRecoverySchema.safeParse(body);
    const limit = parsed.success ? parsed.data.limit ?? 25 : 25;
    const processed = await processTransferRecoveryJobs(limit);

    return NextResponse.json({ success: true, processed }, { headers: corsHeaders });
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    logger.error("Recovery worker endpoint failed", { module: "recovery/process" }, errorObj);

    return NextResponse.json({ error: "Recovery worker failed" }, { status: 500, headers: corsHeaders });
  }
}
