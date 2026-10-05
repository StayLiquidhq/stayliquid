import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { logger } from "@/lib/logger";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { unauthorizedServiceResponse, verifyServiceBearerToken } from "@/lib/service-auth";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const rateLimited = await enforceRateLimit(request, {
      scope: "webhook-admin-update",
      limit: 10,
      windowSeconds: 60,
      headers: corsHeaders,
    });

    if (rateLimited) return rateLimited;

    if (!verifyServiceBearerToken(request, "WEBHOOK_ADMIN_AUTH_TOKEN")) {
      return unauthorizedServiceResponse("webhook/update", corsHeaders);
    }

    const { data: wallets, error: walletsError } = await supabase
      .from("wallets")
      .select("id, address")
      .eq("has_webhook", false);

    if (walletsError) {
      return NextResponse.json({ error: "Failed to fetch wallets" }, { status: 500, headers: corsHeaders });
    }

    if (!wallets || wallets.length === 0) {
      return NextResponse.json({ message: "No new wallets pending webhook activation" }, { status: 200, headers: corsHeaders });
    }

    const walletIds = wallets.map((w) => w.id);

    const { error: updateError } = await supabase
      .from("wallets")
      .update({ has_webhook: true })
      .in("id", walletIds);

    if (updateError) {
      logger.error("Failed to update webhook status for wallets", { module: "webhook/update" }, updateError);
    }

    return NextResponse.json({ success: true, count: walletIds.length }, { status: 200, headers: corsHeaders });
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    logger.error("Error in webhook/update", { module: "webhook/update" }, errorObj);

    return NextResponse.json({ error: "Webhook status update failed" }, { status: 500, headers: corsHeaders });
  }
}
