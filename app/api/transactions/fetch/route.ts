import { NextRequest, NextResponse } from "next/server";
import supabase from "../../../../utils/supabase";

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
    // 1. Authenticate the user
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }
    const token = authHeader.split(" ")[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    // 2. Get wallet_id from the request body
    const { wallet_id } = await request.json();
    if (!wallet_id) {
      return NextResponse.json({ error: "Missing wallet_id" }, { status: 400, headers: corsHeaders });
    }

    // 3. Verify the user owns the wallet they are requesting history for
    const { data: planOwner, error: ownerError } = await supabase
        .from('plans')
        .select('user_id, wallets!inner(id)')
        .eq('wallets.id', wallet_id)
        .eq('user_id', user.id)
        .single();

    if (ownerError || !planOwner) {
        console.error(`Ownership verification failed for wallet ${wallet_id} and user ${user.id}. Error: ${ownerError?.message}`);
        return NextResponse.json({ error: "Forbidden or wallet not found" }, { status: 403, headers: corsHeaders });
    }

    // 4. Fetch transaction history
    const { data: transactions, error: historyError } = await supabase
      .from("transactions")
      .select("*")
      .eq("wallet_id", wallet_id)
      .order("created_at", { ascending: false });

    if (historyError) {
      console.error(`Error fetching transaction history for wallet ${wallet_id}:`, historyError);
      return NextResponse.json({ error: "Failed to fetch transaction history" }, { status: 500, headers: corsHeaders });
    }

    return NextResponse.json({ transactions }, { headers: corsHeaders });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "An unknown error occurred";
    console.error(err);
    return NextResponse.json({ error: errorMessage }, { status: 500, headers: corsHeaders });
  }
}
