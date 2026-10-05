import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { z } from "zod";
import { executeDirectTransfer } from "@/lib/cdp_transfers";
import { parseChainWithFallback, parseTokenWithFallback } from "@/lib/tokens";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import { withIdempotency } from "@/lib/idempotency";
import { logger } from "@/lib/logger";
import { requireEnv } from "@/lib/env";
import { getPlatformFeesWallet } from "@/lib/treasury";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

const fiatPayoutSchema = z.object({
  plan_id: z.string().uuid(),
  wallet_id: z.string().uuid(),
  user_wallet_address: z.string().min(1),
  amount: z.number().positive(),
  fiat_transaction_id: z.string().min(1),
  description: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const authHeader = request.headers.get("authorization");
    const authToken = requireEnv("PAYOUT_AUTH_TOKEN");

    if (!authToken || authHeader !== `Bearer ${authToken}`) {
      logger.warn("Unauthorized fiat webhook request", { module: "plans/fiat-webhook" });

      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json().catch(() => ({}));
    const validation = fiatPayoutSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.format() },
        { status: 400, headers: corsHeaders }
      );
    }

    const {
      plan_id,
      wallet_id,
      user_wallet_address,
      amount,
      fiat_transaction_id,
      description,
    } = validation.data;

    return await withIdempotency(
      request,
      { scope: "plans/fiat-webhook", key: `fiat-payout:${fiat_transaction_id}` },
      async () => {
        const { data: plan, error: planError } = await supabase
          .from("plans")
          .select("plan_type, frequency, chain, token")
          .eq("id", plan_id)
          .single();

        if (planError || !plan) {
          logger.error("Failed to fetch plan details for fiat payout", {
            module: "plans/fiat-webhook",
            planId: plan_id,
          }, planError);

          return NextResponse.json(
            { error: "Failed to fetch plan details" },
            { status: 500, headers: corsHeaders }
          );
        }

        const chain = parseChainWithFallback(plan.chain);
        const tokenSymbol = parseTokenWithFallback(plan.token);

        const treasury = getPlatformFeesWallet(chain);
        logger.info("Transferring settlement tokens for fiat payout", {
          module: "plans/fiat-webhook",
          planId: plan_id,
          walletAddress: user_wallet_address,
          treasury,
          amount,
          chain,
          token: tokenSymbol,
        });

        const { tx } = await executeDirectTransfer({
          senderWalletAddress: user_wallet_address,
          recipientAddress: treasury,
          amount,
          chain,
          token: tokenSymbol,
        });

        const { error: recordError } = await supabase.rpc("record_fiat_payout", {
          p_plan_id: plan_id,
          p_wallet_id: wallet_id,
          p_amount: amount,
          p_currency: tokenSymbol,
          p_description: description,
          p_fiat_transaction_id: fiat_transaction_id,
          p_tx: tx,
          p_is_solana: chain === "solana",
        });

        if (recordError) {
          logger.error("Failed to persist fiat payout records", {
            module: "plans/fiat-webhook",
            planId: plan_id,
            fiatTransactionId: fiat_transaction_id,
          }, recordError);
        }

        return NextResponse.json(
          { success: true, signature: tx, message: "Fiat payout settled and processed successfully." },
          { headers: corsHeaders }
        );
      }
    );
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    logger.error("Fiat payout webhook error", { module: "plans/fiat-webhook" }, errorObj);

    return NextResponse.json(
      { error: errorObj.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
