import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import crypto from "crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// Use a real API service to resolve the geo-location from the IP address.
async function resolveGeoLocation(ip: string) {
  if (ip === "::1" || ip === "127.0.0.1") {
    return { country: "Localhost", city: "Local" };
  }
  try {
    const response = await fetch(`https://ip-api.com/json/${ip}`);
    if (!response.ok) {
      console.error(`Geo location API failed with status: ${response.status}`);
      return { country: "Unknown", city: "Unknown" };
    }
    const data = await response.json();
    return { country: data.country || "Unknown", city: data.city || "Unknown" };
  } catch (error) {
    console.error("Geo location fetch error:", error);
    return { country: "Unknown", city: "Unknown" };
  }
}

export async function POST(request: NextRequest) {
  try {
    // 1. Extract and validate the Bearer token from the header
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized: Missing or invalid Authorization header" },
        { status: 401, headers: corsHeaders }
      );
    }
    const token = authHeader.split(" ")[1];

    // 2. Verify the token and retrieve the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid or expired token" },
        { status: 401, headers: corsHeaders }
      );
    }

    // 3. Collect metadata from the request
    const forwarded = request.headers.get("x-forwarded-for");
    const ip_address = forwarded
      ? forwarded.split(",")[0]
      : request.headers.get("x-real-ip") ?? "0.0.0.0";
    const user_agent = request.headers.get("user-agent") || "Unknown";
    const geo_location = await resolveGeoLocation(ip_address);

    // 4. Create a pseudo-unique device ID for basic fingerprinting
    const device_id = crypto
      .createHash("sha256")
      .update(ip_address + user_agent)
      .digest("hex");

    // 5. Insert the log into the database with a hardcoded "login" event type
    const { error: insertError } = await supabase.from("audit_logs").insert({
      user_id: user.id,
      event_type: "login", 
      ip_address,
      user_agent,
      device_id,
      geo_location,
    });

    if (insertError) {
      console.error("Error inserting login audit log:", insertError);
      return NextResponse.json(
        { error: "Failed to log login event" },
        { status: 500, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      { message: "Login event logged successfully" },
      { status: 200, headers: corsHeaders }
    );

  } catch (error) {
    console.error("Unexpected error in login audit endpoint:", error);
    return NextResponse.json(
      { error: "An internal server error occurred" },
      { status: 500, headers: corsHeaders }
    );
  }
}
