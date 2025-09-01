import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import crypto from "crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

async function resolveGeoLocation(ip: string) {
  try {
    return { country: "Unknown", city: "Unknown" };
  } catch {
    return { country: "Unknown", city: "Unknown" };
  }
}

export async function POST(request: NextRequest) {
  try {
    // 1. Extract token
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized: Missing Authorization header", data: null },
        { status: 401, headers: corsHeaders }
      );
    }
    const token = authHeader.split(" ")[1].trim();

    // 2. Verify token
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid or expired token", data: null },
        { status: 401, headers: corsHeaders }
      );
    }

    const user = authData.user;

    // 3. Collect metadata
    const ip_address =
      request.headers.get("x-forwarded-for") || "0.0.0.0";
    const user_agent = request.headers.get("user-agent") || "Unknown";

    const device_id = crypto
      .createHash("sha256")
      .update(ip_address + user_agent)
      .digest("hex");

    const geo_location = await resolveGeoLocation(ip_address);

    // 4. Insert audit log
    const { error: insertError } = await supabase.from("audit_logs").insert([
      {
        user_id: user.id,
        event_type: "signup",
        ip_address,
        user_agent,
        device_id,
        geo_location,
      },
    ]);

    if (insertError) {
      console.error("Error inserting signup audit log:", insertError);
      return NextResponse.json(
        { error: "Failed to log signup event", data: null },
        { status: 500, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      { error: null, data: { success: true, event: "signup" } },
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error("Unexpected error in signup audit:", error);
    return NextResponse.json(
      { error: "Internal server error", data: null },
      { status: 500, headers: corsHeaders }
    );
  }
}
