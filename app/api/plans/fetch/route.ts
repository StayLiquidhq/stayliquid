import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";

// Strict CORS allowlist (aligned with other routes)
const ALLOWED_ORIGINS = new Set<string>([
  "https://liquid-frontend-gray.vercel.app",
  "https://liquid-frontend-aq6izit64-pleaseamsorry3-gmailcoms-projects.vercel.app",
  "https://savewithliquid.xyz",
]);

function createCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const headers = createCorsHeaders(origin);
  headers["Access-Control-Max-Age"] = "600";
  return new NextResponse(null, { status: 204, headers });
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = createCorsHeaders(origin);
  try {
    // Enforce allowlist only when Origin header is present (browser requests)
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return NextResponse.json(
        { error: "Origin not allowed" },
        { status: 403, headers: corsHeaders }
      );
    }
    // 1. Authenticate user
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }
    const token = authHeader.split(" ")[1];
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    // 2. Fetch plans with associated wallets
    const { data: plans, error: plansError } = await supabase
      .from("plans")
      .select(
        `
        *,
        name,
        wallets (*)
      `
      )
      .eq("user_id", user.id);

    if (plansError) {
      return NextResponse.json(
        { error: "Failed to fetch plans" },
        { status: 500, headers: corsHeaders }
      );
    }

    // 3. Return response
    return NextResponse.json(plans, { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
