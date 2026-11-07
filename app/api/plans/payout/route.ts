import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/rate-limit";
import { unauthorizedServiceResponse, verifyServiceToken } from "@/lib/service-auth";
import { executeRecurringPayoutForPlan } from "@/lib/payout-service";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const rateLimited = await enforceRateLimit(request, {
      scope: "plans-payout",
      limit: 30,
      windowSeconds: 60,
      headers: corsHeaders,
    });

    if (rateLimited) return rateLimited;

    if (!verifyServiceToken(request)) {
      return unauthorizedServiceResponse("plans/payout", corsHeaders);
    }

    const body = await request.json().catch(() => ({}));
    const { plan_id } = body;

    if (!plan_id) {
      return NextResponse.json(
        { error: "Missing plan_id" },
        { status: 400, headers: corsHeaders }
      );
    }

    const result = await executeRecurringPayoutForPlan(plan_id, request);

    return NextResponse.json(result, {
      status: result.httpStatus ?? (result.success ? 200 : 400),
      headers: corsHeaders,
    });
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    logger.error("Payout endpoint execution failed", { module: "plans/payout" }, errorObj);

    return NextResponse.json(
      { error: "Payout execution failed" },
      { status: 500, headers: corsHeaders }
    );
  }
}
