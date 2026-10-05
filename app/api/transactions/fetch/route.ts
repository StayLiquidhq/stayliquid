import { NextRequest, NextResponse } from "next/server";
import supabase from "../../../../utils/supabase";
import { z } from "zod";
import { handleCorsPreflight, validateOrigin } from "@/lib/cors";
import { TRANSACTION_COLUMNS } from "@/lib/selects";

const FetchTransactionsSchema = z.object({
  wallet_id: z.string().min(1),
});

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

export async function POST(request: NextRequest) {
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

    const body = await request.json().catch(() => null);
    const parsed = FetchTransactionsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400, headers: corsHeaders }
      );
    }

    const { wallet_id } = parsed.data;

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

    const { data: transactions, error: historyError } = await supabase
      .from("transactions")
      .select(TRANSACTION_COLUMNS)
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
      err instanceof Error ? err.message : "Failed to fetch transaction history";

    console.error(err);

    return NextResponse.json(
      { error: errorMessage },
      { status: 500, headers: corsHeaders }
    );
  }
}
