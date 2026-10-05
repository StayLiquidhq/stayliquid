import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import supabase from "@/utils/supabase";
import { getOnChainTokenBalance } from "@/lib/cdp_balance";
import { parseChainWithFallback, parseTokenWithFallback } from "@/lib/tokens";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import { logger } from "@/lib/logger";

const querySchema = z.object({
  wallet_address: z.string().min(1, "wallet_address is required"),
});

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

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
    const validation = querySchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.format() },
        { status: 400, headers: corsHeaders }
      );
    }

    const { wallet_address } = validation.data;

    const { data: walletData, error: walletError } = await supabase
      .from("wallets")
      .select("id, plan_id, chain_type")
      .eq("address", wallet_address)
      .single();

    if (walletError || !walletData) {
      return NextResponse.json(
        { error: "Wallet not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    const { data: planData, error: planError } = await supabase
      .from("plans")
      .select("user_id, chain, token")
      .eq("id", walletData.plan_id)
      .single();

    if (planError || !planData || planData.user_id !== user.id) {
      return NextResponse.json(
        { error: "Forbidden: User does not own this wallet" },
        { status: 403, headers: corsHeaders }
      );
    }

    const chain = parseChainWithFallback(planData.chain, parseChainWithFallback(walletData.chain_type));
    const tokenSymbol = parseTokenWithFallback(planData.token);

    const onChainBalance = await getOnChainTokenBalance({
      address: wallet_address,
      chain,
      token: tokenSymbol,
    });

    logger.info("Retrieved on-chain balance for wallet", {
      module: "wallets/balance-query",
      walletAddress: wallet_address,
      chain,
      token: tokenSymbol,
      onChainBalance,
    });

    return NextResponse.json(
      {
        wallet_address,
        balance: onChainBalance,
        currency: tokenSymbol,
        chain,
        source: chain === "base" ? "onchain_base" : "onchain_solana",
        message: "Balance verified live on-chain. Funds securely held in user Coinbase wallet.",
      },
      { headers: corsHeaders }
    );
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    logger.error("Error querying on-chain balance", { module: "wallets/balance-query" }, errorObj);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
