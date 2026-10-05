import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { handleCorsPreflight, getCorsHeaders } from "@/lib/cors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { unauthorizedServiceResponse, verifyServiceToken } from "@/lib/service-auth";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const rateLimited = await enforceRateLimit(request, {
      scope: "wallets-fetch-all",
      limit: 60,
      windowSeconds: 60,
      headers: corsHeaders,
    });

    if (rateLimited) return rateLimited;

    if (!verifyServiceToken(request)) {
      return unauthorizedServiceResponse("wallets/fetch-all", corsHeaders);
    }

    const { data: wallets, error: walletsError } = await supabase
      .from("wallets")
      .select("address");

    if (walletsError) {
      return NextResponse.json({ error: "Failed to fetch wallets" }, { status: 500, headers: corsHeaders });
    }

    return NextResponse.json(wallets, { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Unexpected error in fetch-all:", err);

    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
