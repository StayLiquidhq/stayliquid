import { NextRequest, NextResponse } from "next/server";
import createSupabaseServerClient from "@/lib/supabase/serverClient";

export async function GET(request: NextRequest) {
  const response = NextResponse.next();
  const supabase = createSupabaseServerClient(request, response);

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    console.error("Authentication error:", authError);
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  }

  const google_id = user.id;

  const { data: planData, error: planError } = await supabase
    .from("plans")
    .select("*, users!inner(google_id)")
    .eq("users.google_id", google_id);

  if (planError) {
    console.error("Error fetching plans:", planError);
    return NextResponse.json(
      { data: null, error: planError.message },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { data: planData, error: null },
    { status: 200 }
  );
}