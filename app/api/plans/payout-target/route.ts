import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { getOnChainTokenBalance } from "@/lib/cdp_balance";
import { executeDirectTransfer } from "@/lib/cdp_transfers";
import { parseChainWithFallback, parseTokenWithFallback } from "@/lib/tokens";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import { withIdempotency } from "@/lib/idempotency";
import { recordAuditLog } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { requireEnv } from "@/lib/env";

interface PlanRecord {
  id: string;
  user_id: string;
  payout_method: string;
  payout_wallet_address: string | null;
  status: string;
  chain: string | null;
  token: string | null;
  wallets: Array<{ id: string; address: string; chain_type: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const authHeader = request.headers.get("authorization");
    const authToken = requireEnv("PAYOUT_AUTH_TOKEN");

    if (!authToken || authHeader !== `Bearer ${authToken}`) {
      logger.warn("Unauthorized target payout trigger attempt", { module: "plans/payout-target" });

      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { plan_id } = body;

    if (!plan_id) {
      return NextResponse.json(
        { error: "Missing plan_id" },
        { status: 400, headers: corsHeaders }
      );
    }

    const { data: rawPlan, error: planError } = await supabase
      .from("plans")
      .select(
        `
        id,
        user_id,
        payout_method,
        payout_wallet_address,
        status,
        chain,
        token,
        wallets (id, address, chain_type)
      `
      )
      .eq("id", plan_id)
      .single();

    if (
      planError ||
      !rawPlan ||
      !rawPlan.wallets ||
      !Array.isArray(rawPlan.wallets) ||
      rawPlan.wallets.length === 0
    ) {
      logger.error("Plan or wallet not found", { module: "plans/payout-target", planId: plan_id }, planError);

      return NextResponse.json(
        { error: "Plan or wallet not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    // SAFETY: rawPlan existence and non-empty wallets array verified above
    const plan = rawPlan as PlanRecord;

    if (plan.status !== "active") {
      return NextResponse.json(
        { error: `Plan is already ${plan.status}` },
        { status: 400, headers: corsHeaders }
      );
    }

    const wallet = plan.wallets[0];

    if (plan.payout_method === "fiat") {
      logger.info("Plan is a fiat payout. Skipping on-chain transfer.", {
        module: "plans/payout-target",
        planId: plan_id,
      });

      return NextResponse.json(
        { success: true, message: "Fiat target payout acknowledged." },
        { headers: corsHeaders }
      );
    }

    const recipientAddress = plan.payout_wallet_address;

    if (!recipientAddress) {
      return NextResponse.json(
        { error: "Payout wallet address not set" },
        { status: 400, headers: corsHeaders }
      );
    }

    const chain = parseChainWithFallback(plan.chain, parseChainWithFallback(wallet.chain_type));
    const tokenSymbol = parseTokenWithFallback(plan.token);

    return await withIdempotency(
      request,
      { scope: "plans/payout-target", key: `payout-target:${plan_id}` },
      async () => {
        const liveOnChainBalance = await getOnChainTokenBalance({
          address: wallet.address,
          chain,
          token: tokenSymbol,
        });

        if (liveOnChainBalance <= 0) {
          logger.warn("Zero on-chain balance for target payout", {
            module: "plans/payout-target",
            planId: plan_id,
            walletAddress: wallet.address,
            chain,
            token: tokenSymbol,
          });

          return NextResponse.json(
            { error: "No balance to pay out in wallet" },
            { status: 400, headers: corsHeaders }
          );
        }

        logger.info("Executing target payout directly from user Coinbase wallet", {
          module: "plans/payout-target",
          planId: plan_id,
          senderWalletAddress: wallet.address,
          recipientAddress,
          payoutAmount: liveOnChainBalance,
          chain,
          token: tokenSymbol,
        });

        const { tx } = await executeDirectTransfer({
          senderWalletAddress: wallet.address,
          recipientAddress,
          amount: liveOnChainBalance,
          chain,
          token: tokenSymbol,
        });

        const { error: recordError } = await supabase.rpc("record_target_payout", {
          p_plan_id: plan_id,
          p_wallet_id: wallet.id,
          p_tx: tx,
          p_amount: liveOnChainBalance,
          p_currency: tokenSymbol,
          p_recipient: recipientAddress,
          p_is_solana: chain === "solana",
        });

        if (recordError) {
          logger.error("Failed to persist target payout records", {
            module: "plans/payout-target",
            planId: plan_id,
            tx,
          }, recordError);
        }

        recordAuditLog({ userId: plan.user_id, eventType: "payout", request });

        return NextResponse.json(
          {
            success: true,
            signature: tx,
            txHash: tx,
            payoutAmount: liveOnChainBalance,
            chain,
            token: tokenSymbol,
          },
          { headers: corsHeaders }
        );
      }
    );
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    logger.error("Target payout execution failed", { module: "plans/payout-target" }, errorObj);

    return NextResponse.json(
      { error: errorObj.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
