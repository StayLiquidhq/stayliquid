import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { handleCorsPreflight, validateOrigin } from "@/lib/cors";
import { logger } from "@/lib/logger";
import { recordAuditLog } from "@/lib/audit";
import { USER_COLUMNS } from "@/lib/selects";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

export async function POST(request: NextRequest) {
  const { isAllowed, headers: corsHeaders } = validateOrigin(request);

  if (!isAllowed) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403, headers: corsHeaders });
  }

  try {
    let authUserId: string | null = null;
    let email: string | null = null;
    let name: string | null = null;
    let picture: string | null = null;
    let googleId: string | null = null;

    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized", data: null },
        { status: 401, headers: corsHeaders }
      );
    }

    const token = authHeader.split(" ")[1];
    const { data: authData, error: authError } = await supabase.auth.getUser(token);

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: "Unauthorized", data: null },
        { status: 401, headers: corsHeaders }
      );
    }

    authUserId = authData.user.id;
    email = authData.user.email || null;
    name = authData.user.user_metadata?.full_name || authData.user.user_metadata?.name || null;
    picture = authData.user.user_metadata?.avatar_url || authData.user.user_metadata?.picture || null;
    googleId = authData.user.user_metadata?.sub || null;

    const rateLimited = await enforceRateLimit(request, {
      scope: "user-create",
      identity: authUserId,
      limit: 20,
      windowSeconds: 60,
      headers: corsHeaders,
    });

    if (rateLimited) return rateLimited;

    const body = await request.json().catch(() => ({}));

    if (body.name) name = body.name;

    if (body.picture) picture = body.picture;

    if (!email) {
      return NextResponse.json(
        { error: "Email is required to create a user account", data: null },
        { status: 400, headers: corsHeaders }
      );
    }

    const { data: existingUsers, error: queryError } = await supabase
      .from("users")
      .select(USER_COLUMNS)
      .eq("auth_user_id", authUserId);

    if (queryError) {
      logger.error("Error querying existing user in DB", { module: "user/create", email }, queryError);

      return NextResponse.json(
        { error: "Database error occurred", data: null },
        { status: 500, headers: corsHeaders }
      );
    }

    let existingUser = existingUsers?.[0] ?? null;

    if (!existingUser) {
      const { data: emailUsers, error: emailQueryError } = await supabase
        .from("users")
        .select(USER_COLUMNS)
        .eq("email", email)
        .is("auth_user_id", null);

      if (emailQueryError) {
        logger.error("Error querying existing user by email", { module: "user/create", email }, emailQueryError);

        return NextResponse.json(
          { error: "Database error occurred", data: null },
          { status: 500, headers: corsHeaders }
        );
      }

      existingUser = emailUsers?.[0] ?? null;
    }

    if (existingUser) {
      if (!existingUser.auth_user_id) {
        await supabase
          .from("users")
          .update({ auth_user_id: authUserId })
          .eq("id", existingUser.id);
        existingUser.auth_user_id = authUserId;
      }

      logger.info("Existing user authenticated", { module: "user/create", userId: existingUser.id });
      recordAuditLog({ userId: existingUser.id, eventType: "login", request });

      return NextResponse.json(
        { error: null, data: existingUser, new: false },
        { status: 200, headers: corsHeaders }
      );
    }

    const usernameBase = email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "");
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const username = `${usernameBase}_${randomSuffix}`;

    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert({
        auth_user_id: authUserId,
        email,
        name: name || usernameBase,
        username,
        picture,
        google_id: googleId,
        has_created_plan: false,
      })
      .select(USER_COLUMNS)
      .single();

    if (insertError || !newUser) {
      logger.error("Failed to create user account", { module: "user/create", email }, insertError);

      return NextResponse.json(
        { error: "Failed to create user account", data: null },
        { status: 500, headers: corsHeaders }
      );
    }

    logger.info("New user account created successfully", { module: "user/create", userId: newUser.id });
    recordAuditLog({ userId: newUser.id, eventType: "signup", request });

    return NextResponse.json(
      { error: null, data: newUser, new: true },
      { status: 201, headers: corsHeaders }
    );
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    logger.error("Unexpected error in user/create", { module: "user/create" }, errorObj);

    return NextResponse.json(
      { error: "Internal server error", data: null },
      { status: 500, headers: corsHeaders }
    );
  }
}
