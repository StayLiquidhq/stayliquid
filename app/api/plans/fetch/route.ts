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
    // 1. Authenticate user
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }
    const token = authHeader.split(" ")[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    // 2. Fetch plans with associated wallets
    const { data: plans, error: plansError } = await supabase
      .from("plans")
      .select(`
        *,
        name,
        wallets (*)
      `)
      .eq("user_id", user.id);

    if (plansError) {
      return NextResponse.json({ error: "Failed to fetch plans" }, { status: 500, headers: corsHeaders });
    }

    // 3. Return response
    return NextResponse.json(plans, { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
