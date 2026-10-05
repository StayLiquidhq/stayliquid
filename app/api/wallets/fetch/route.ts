import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { handleCorsPreflight, validateOrigin } from "@/lib/cors";
import { getMultipleOnChainTokenBalances, WalletTokenTarget } from "@/lib/cdp_balance";
import { parseChainWithFallback, parseTokenWithFallback } from "@/lib/tokens";
import { logger } from "@/lib/logger";

interface PlanWithWallets {
  id: string;
  plan_type: string;
  name: string;
  chain: string | null;
  token: string | null;
  wallets: Array<{
    id: string;
    address: string;
    chain_type: string;
    created_at: string;
  }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

export async function GET(request: NextRequest) {
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

    const { data: plans, error: plansError } = await supabase
      .from("plans")
      .select(
        `
        id,
        plan_type,
        name,
        chain,
        token,
        wallets (
          id,
          address,
          chain_type,
          created_at
        )
      `
      )
      .eq("user_id", user.id);

    if (plansError) {
      logger.error("Error fetching plans from DB", { module: "wallets/fetch", userId: user.id }, plansError);

      return NextResponse.json(
        { error: "Failed to fetch user wallets" },
        { status: 500, headers: corsHeaders }
      );
    }

    // SAFETY: Supabase query joins plans table with related wallets records
    const typedPlans = (plans as PlanWithWallets[]) || [];

    const targets: WalletTokenTarget[] = [];

    for (const plan of typedPlans) {
      const planChain = parseChainWithFallback(plan.chain);
      const planToken = parseTokenWithFallback(plan.token);

      for (const w of plan.wallets || []) {
        if (w.address) {
          const chain = parseChainWithFallback(w.chain_type, planChain);

          targets.push({
            address: w.address,
            chain,
            token: planToken,
          });
        }
      }
    }

    const balanceMap = await getMultipleOnChainTokenBalances(targets);

    const walletDetails = typedPlans.flatMap((plan) => {
      const planChain = parseChainWithFallback(plan.chain);
      const planToken = parseTokenWithFallback(plan.token);

      return (plan.wallets || []).map((wallet) => {
        const chain = parseChainWithFallback(wallet.chain_type, planChain);

        const onChainBalance = balanceMap.get(wallet.address) ?? 0;

        return {
          wallet_id: wallet.id,
          name: plan.name,
          user_id: user.id,
          address: wallet.address,
          balance: onChainBalance.toString(),
          usd_value: onChainBalance.toFixed(2),
          currency: planToken,
          chain,
          created_at: wallet.created_at,
          plan_type: plan.plan_type,
          plan_id: plan.id,
          source: chain === "base" ? "onchain_base" : "onchain_solana",
        };
      });
    });

    return NextResponse.json(walletDetails, {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    logger.error("Unexpected error in wallets/fetch", { module: "wallets/fetch" }, errorObj);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
