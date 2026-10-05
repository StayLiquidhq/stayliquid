import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { logTransaction } from "@/lib/transaction_history";
import { getOnChainTokenBalance } from "@/lib/cdp_balance";
import { isSupportedChain, isSupportedToken, SupportedChain, SupportedToken } from "@/lib/tokens";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import { logger } from "@/lib/logger";
import { requireEnv } from "@/lib/env";
import { enforceRateLimit } from "@/lib/rate-limit";
import { verifySignedWebhook } from "@/lib/webhook-security";
import { verifyDepositTransaction } from "@/lib/deposit-verification";

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
    const rawBody = await request.text();

    const rateLimited = await enforceRateLimit(request, {
      scope: "wallets-update-balance",
      limit: 120,
      windowSeconds: 60,
      headers: corsHeaders,
    });

    if (rateLimited) return rateLimited;

    if (!verifySignedWebhook(request, rawBody, webhookSecret)) {
      logger.warn("Invalid CDP webhook signature", { module: "webhook/deposit" });

      return NextResponse.json(
        { error: "Invalid webhook signature" },
        { status: 401, headers: corsHeaders }
      );
    }

    let body = null;

    try {
      body = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      return NextResponse.json(
        { message: "Invalid JSON payload" },
        { status: 400, headers: corsHeaders }
      );
    }

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
        { status: 400, headers: corsHeaders }
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

      const isVerifiedDeposit = await verifyDepositTransaction({
        txId,
        walletAddress,
        chain,
        token,
        amount: depositAmount,
      });

      if (!isVerifiedDeposit) {
        logger.warn("Deposit webhook transaction did not match on-chain facts. Releasing claim.", {
          module: "webhook/deposit",
          txId,
          walletAddress,
          chain,
          token,
        });
        await supabase.from("processed_transactions").delete().eq("signature", txId);
        continue;
      }

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
