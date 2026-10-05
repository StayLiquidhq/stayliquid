import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { handleCorsPreflight, validateOrigin } from "@/lib/cors";
import { logger } from "@/lib/logger";
import { recordAuditLog } from "@/lib/audit";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

export async function POST(request: NextRequest) {
  const { isAllowed, headers: corsHeaders } = validateOrigin(request);

  if (!isAllowed) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403, headers: corsHeaders });
  }

  try {
    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized: Missing or invalid Authorization header" },
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
        { error: "Unauthorized: Invalid or expired token" },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json().catch(() => ({}));
    const eventType = body && body.event_type === "signup" ? "signup" : "login";

    recordAuditLog({
      userId: user.id,
      eventType,
      request,
    });

    return NextResponse.json(
      { message: `${eventType === "signup" ? "Signup" : "Login"} event logged successfully` },
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    logger.error("Unexpected error in login audit endpoint", { module: "audit/login" }, errorObj);

    return NextResponse.json(
      { error: "An internal server error occurred" },
      { status: 500, headers: corsHeaders }
    );
  }
}
