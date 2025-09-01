import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  try {
    // 1. Extract Bearer token
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized: Missing or invalid Authorization header" },
        { status: 401, headers: corsHeaders }
      );
    }
    const token = authHeader.split(" ")[1].trim();

    // 2. Verify token and get authenticated user
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authUser) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid or expired token" },
        { status: 401, headers: corsHeaders }
      );
    }

    // 3. Extract metadata from the authenticated user
    const full_name = authUser.user_metadata?.full_name || "Anonymous";
    const email = authUser.email?.toLowerCase().trim();
    const avatar_url = authUser.user_metadata?.avatar_url || null;

    if (!email) {
      return NextResponse.json(
        { error: "Email is missing in the token payload" },
        { status: 400, headers: corsHeaders }
      );
    }

    // 4. Check if a user profile already exists
    const { data: existingUser, error: fetchError } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", authUser.id)
      .single();

    // If user exists, update if necessary
    if (existingUser && !fetchError) {
      const needsUpdate =
        existingUser.full_name !== full_name ||
        existingUser.avatar_url !== avatar_url;

      if (needsUpdate) {
        const { data: updatedUser, error: updateError } = await supabase
          .from("users")
          .update({
            full_name,
            avatar_url,
            updated_at: new Date().toISOString(),
          })
          .eq("auth_user_id", authUser.id)
          .select()
          .single();

        if (updateError) {
          console.error("Error updating user profile:", updateError);
          return NextResponse.json(
            { error: "Failed to update user profile" },
            { status: 500, headers: corsHeaders }
          );
        }
        return NextResponse.json({ data: updatedUser, new: false }, { status: 200, headers: corsHeaders });
      }
      return NextResponse.json({ data: existingUser, new: false }, { status: 200, headers: corsHeaders });
    }

    // 5. If user does not exist, create a new profile
    if (fetchError && fetchError.code === "PGRST116") {
      const { data: newUser, error: insertError } = await supabase
        .from("users")
        .insert({
          auth_user_id: authUser.id,
          full_name,
          email,
          avatar_url,
        })
        .select()
        .single();

      if (insertError) {
        console.error("Error creating user profile:", insertError);
        return NextResponse.json(
          { error: "Failed to create user profile" },
          { status: 500, headers: corsHeaders }
        );
      }
      return NextResponse.json({ data: newUser, new: true }, { status: 201, headers: corsHeaders });
    }

    // Handle other database errors
    console.error("Database error:", fetchError);
    return NextResponse.json(
      { error: "A database error occurred" },
      { status: 500, headers: corsHeaders }
    );

  } catch (error) {
    console.error("Unexpected error:", error);
    return NextResponse.json(
      { error: "An internal server error occurred" },
      { status: 500, headers: corsHeaders }
    );
  }
}
