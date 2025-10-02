import { NextRequest, NextResponse } from "next/server";
import supabase from "../../../../utils/supabase";
import { z } from "zod";

// Strict CORS allowlist (aligned with other routes)
const ALLOWED_ORIGINS = new Set<string>([
  "https://liquid-frontend-gray.vercel.app",
  "https://liquid-frontend-aq6izit64-pleaseamsorry3-gmailcoms-projects.vercel.app",
  "https://savewithliquid.xyz",
  "https://savewithliquid.com",
]);

function createCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

// Request body validation
const FetchTransactionsSchema = z.object({
  wallet_id: z.union([z.string().uuid(), z.number().int().positive()]),
});

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const headers = createCorsHeaders(origin);
  headers["Access-Control-Max-Age"] = "600";
  return new NextResponse(null, { status: 204, headers });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = createCorsHeaders(origin);
  try {
    // Enforce allowlist only when Origin header is present (browser requests)
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return NextResponse.json(
        { error: "Origin not allowed" },
        { status: 403, headers: corsHeaders }
      );
    }
    // 1. Authenticate the user
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

    // 2. Get wallet_id from the request body
    const body = await request.json().catch(() => null);
    const parsed = FetchTransactionsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400, headers: corsHeaders }
      );
    }
    const { wallet_id } = parsed.data;

    // 3. Verify the user owns the wallet they are requesting history for
    const { data: planOwner, error: ownerError } = await supabase
      .from("plans")
      .select("user_id, wallets!inner(id)")
      .eq("wallets.id", wallet_id)
      .eq("user_id", user.id)
      .single();

    if (ownerError || !planOwner) {
      console.error(
        `Ownership verification failed for wallet ${wallet_id} and user ${user.id}. Error: ${ownerError?.message}`
      );
      return NextResponse.json(
        { error: "Forbidden or wallet not found" },
        { status: 403, headers: corsHeaders }
      );
    }

    // 4. Fetch transaction history
    const { data: transactions, error: historyError } = await supabase
      .from("transactions")
      .select("*")
      .eq("wallet_id", wallet_id)
      .order("created_at", { ascending: false });

    if (historyError) {
      console.error(
        `Error fetching transaction history for wallet ${wallet_id}:`,
        historyError
      );
      return NextResponse.json(
        { error: "Failed to fetch transaction history" },
        { status: 500, headers: corsHeaders }
      );
    }

    return NextResponse.json({ transactions }, { headers: corsHeaders });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "An unknown error occurred";
    console.error(err);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500, headers: corsHeaders }
    );
  }
}
