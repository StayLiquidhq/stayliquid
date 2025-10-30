import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";

// Strict CORS allowlist (aligned with other routes)
const ALLOWED_ORIGINS = new Set<string>([
  "https://liquid-frontend-gray.vercel.app",
  "https://liquid-frontend-aq6izit64-pleaseamsorry3-gmailcoms-projects.vercel.app",
  "https://savewithliquid.xyz",
  "https://savewithliquid.com",
  "http://localhost:3000",
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
        {
          error: "Origin not allowed",
          hasPlan: null,
        },
        { status: 403, headers: corsHeaders }
      );
    }
    // 1. Extract token
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          error: "Unauthorized: Missing or invalid Authorization header",
          hasPlan: null,
        },
        { status: 401, headers: corsHeaders }
      );
    }
    const token = authHeader.split(" ")[1].trim();

    // 2. Verify session with Supabase
    const { data: authData, error: authError } = await supabase.auth.getUser(
      token
    );
    if (authError || !authData?.user) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid or expired token", hasPlan: null },
        { status: 401, headers: corsHeaders }
      );
    }

    const userId = authData.user.id;

    // 3. Check if plan exists
    const { data: plans, error: planError } = await supabase
      .from("plans")
      .select("id")
      .eq("user_id", userId);

    if (planError) {
      console.error("Error fetching plan:", planError);
      return NextResponse.json(
        { error: "Database error while checking plan", hasPlan: null },
        { status: 500, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      { error: null, hasPlan: plans && plans.length > 0 },
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error", hasPlan: null },
      { status: 500, headers: corsHeaders }
    );
  }
}
