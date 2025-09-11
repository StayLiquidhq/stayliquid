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
    const authHeader = request.headers.get("x-custom-auth");
    if (authHeader !== process.env.PAYOUT_AUTH_TOKEN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    // 2. Fetch all wallets
    const { data: wallets, error: walletsError } = await supabase
      .from("wallets")
      .select("address");

    if (walletsError) {
      return NextResponse.json({ error: "Failed to fetch wallets" }, { status: 500, headers: corsHeaders });
    }

    // 3. Return response
    return NextResponse.json(wallets, { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
