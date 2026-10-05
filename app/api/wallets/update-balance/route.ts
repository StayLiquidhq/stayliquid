import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { logTransaction } from "@/lib/transaction_history";
import { getOnChainTokenBalance } from "@/lib/cdp_balance";
import { isSupportedChain, isSupportedToken, SupportedChain, SupportedToken } from "@/lib/tokens";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import { logger } from "@/lib/logger";
import { requireEnv } from "@/lib/env";

import { z } from "zod";

const cdpPayloadSchema = z.object({
  event_type: z.string().optional(),
  transaction_hash: z.string().optional(),
  transaction_signature: z.string().optional(),
  address: z.string().optional(),
  network: z.string().optional(),
  amount: z.union([z.number(), z.string()]).optional(),
  token: z.string().optional(),
  symbol: z.string().optional(),
});

const cdpWebhookListSchema = z.union([
  z.array(cdpPayloadSchema),
  cdpPayloadSchema.transform((item) => [item]),
]);

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const webhookSecret = requireEnv("CDP_WEBHOOK_SECRET");

    const authHeader = request.headers.get("authorization") || request.headers.get("x-webhook-secret");

    if (authHeader !== `Bearer ${webhookSecret}` && authHeader !== webhookSecret) {
      logger.warn("Unauthorized webhook request attempt", { module: "webhook/deposit" });

      return NextResponse.json(
        { error: "Unauthorized webhook request" },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json().catch(() => null);

    if (!body) {
      return NextResponse.json(
        { message: "Empty payload received" },
        { status: 200, headers: corsHeaders }
      );
    }

    const parseResult = cdpWebhookListSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { message: "Invalid payload format" },
        { status: 200, headers: corsHeaders }
      );
    }

    const items = parseResult.data;

    for (const item of items) {
      const txId = item.transaction_hash || item.transaction_signature;
      const walletAddress = item.address;

      if (!txId || !walletAddress) {
        continue;
      }

      const { error: claimError } = await supabase
        .from("processed_transactions")
        .insert({ signature: txId });

      if (claimError) {
        if (claimError.code === "23505") {
          logger.debug("Transaction already processed. Skipping duplicate.", {
            module: "webhook/deposit",
            txId,
          });
          continue;
        }

        logger.error("Failed to claim transaction signature in DB", {
          module: "webhook/deposit",
          txId,
        }, claimError);
        continue;
      }

      const { data: wallet, error: walletError } = await supabase
        .from("wallets")
        .select("id, plan_id, chain_type")
        .eq("address", walletAddress)
        .single();

      if (walletError || !wallet) {
        logger.info("Address is not a registered Liquid wallet. Releasing claim.", {
          module: "webhook/deposit",
          address: walletAddress,
          txId,
        });
        await supabase.from("processed_transactions").delete().eq("signature", txId);
        continue;
      }

      const chain: SupportedChain = isSupportedChain(wallet.chain_type) ? wallet.chain_type : "solana";
      const rawToken = item.symbol || item.token || "USDC";
      const token: SupportedToken = isSupportedToken(rawToken) ? rawToken : "USDC";
      const depositAmount = item.amount ? Number(item.amount) : 0;

      await logTransaction({
        wallet_id: wallet.id,
        type: "credit",
        amount: depositAmount,
        currency: token,
        description: `Deposit confirmed on ${chain} (${token})`,
        solana_signature: chain === "solana" ? txId : undefined,
        transaction_hash: chain === "base" ? txId : undefined,
      });

      logger.info("Deposit successfully confirmed and logged. Funds safely held on-chain.", {
        module: "webhook/deposit",
        walletAddress,
        chain,
        token,
        txId,
      });

      const { data: plan } = await supabase
        .from("plans")
        .select("id, target_type, target_amount, status")
        .eq("id", wallet.plan_id)
        .single();

      if (
        plan &&
        plan.status === "active" &&
        plan.target_type === "amount" &&
        plan.target_amount
      ) {
        const liveBalance = await getOnChainTokenBalance({
          address: walletAddress,
          chain,
          token,
        });

        if (liveBalance >= plan.target_amount) {
          logger.info("Target plan goal achieved on-chain! Ready for payout.", {
            module: "webhook/deposit",
            planId: plan.id,
            targetAmount: plan.target_amount,
            liveBalance,
          });
        }
      }
    }

    return NextResponse.json(
      { success: true, message: "CDP webhook processed successfully" },
      { headers: corsHeaders }
    );
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    logger.error("Error processing deposit webhook", { module: "webhook/deposit" }, errorObj);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
