import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";

import { handleCorsPreflight, validateOrigin } from "@/lib/cors";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

export async function GET(request: NextRequest) {
  const { isAllowed, headers: corsHeaders } = validateOrigin(request);

  if (!isAllowed) {
    return NextResponse.json(
      {
        error: "Origin not allowed",
        hasPlan: null,
      },
      { status: 403, headers: corsHeaders }
    );
  }

  try {
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
