import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";

import { handleCorsPreflight, validateOrigin } from "@/lib/cors";
import { PLAN_COLUMNS, WALLET_COLUMNS } from "@/lib/selects";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

export async function GET(request: NextRequest) {
  const { isAllowed, headers: corsHeaders } = validateOrigin(request);

  if (!isAllowed) {
    return NextResponse.json(
      { error: "Origin not allowed" },
      { status: 403, headers: corsHeaders }
    );
  }

  try {
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

    const { data: plans, error: plansError } = await supabase
      .from("plans")
      .select(
        `
        ${PLAN_COLUMNS},
        wallets (${WALLET_COLUMNS})
      `
      )
      .eq("user_id", user.id);

    if (plansError) {
      return NextResponse.json(
        { error: "Failed to fetch plans" },
        { status: 500, headers: corsHeaders }
      );
    }

    return NextResponse.json(plans, { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Unexpected error:", err);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
