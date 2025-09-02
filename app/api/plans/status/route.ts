import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  try {
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
    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle(); 

    if (planError) {
      console.error("Error fetching plan:", planError);
      return NextResponse.json(
        { error: "Database error while checking plan", hasPlan: null },
        { status: 500, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      { error: null, hasPlan: !!plan },
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
