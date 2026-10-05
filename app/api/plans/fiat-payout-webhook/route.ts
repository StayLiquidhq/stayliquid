import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { z } from "zod";
import { executeDirectTransfer } from "@/lib/cdp_transfers";
import { parseChainWithFallback, parseTokenWithFallback } from "@/lib/tokens";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import { withIdempotency } from "@/lib/idempotency";
import { logger } from "@/lib/logger";
import { getPlatformFeesWallet } from "@/lib/treasury";
import { enforceRateLimit } from "@/lib/rate-limit";
import { unauthorizedServiceResponse, verifyServiceToken } from "@/lib/service-auth";
import { notifyNewFiatPayout } from "@/lib/telegram-bot";
import {
  completeTransferRecoveryJob,
  failTransferRecoveryJob,
  getTransferRecoveryJob,
  markTransferRecoveryExternalSucceeded,
  prepareTransferRecoveryJob,
} from "@/lib/recovery";

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
    const rateLimited = await enforceRateLimit(request, {
      scope: "plans-fiat-payout-webhook",
      limit: 60,
      windowSeconds: 60,
      headers: corsHeaders,
    });

    if (rateLimited) return rateLimited;

    if (!verifyServiceToken(request)) {
      return unauthorizedServiceResponse("plans/fiat-webhook", corsHeaders);
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
        const recoveryScope = "plans/fiat-webhook";
        const idempotencyKey = `fiat-payout:${fiat_transaction_id}`;
        const existingRecovery = await getTransferRecoveryJob(recoveryScope, idempotencyKey);

        if (existingRecovery?.status === "completed" && existingRecovery.response) {
          return NextResponse.json(existingRecovery.response, { headers: corsHeaders });
        }

        if (existingRecovery && existingRecovery.status !== "failed") {
          return NextResponse.json(
            { success: false, status: existingRecovery.status, recoveryPending: true, error: existingRecovery.last_error },
            { status: 202, headers: corsHeaders }
          );
        }

        const { data: plan, error: planError } = await supabase
          .from("plans")
          .select(
            "name, plan_type, frequency, chain, token, bank_name, account_name, payout_account_number"
          )
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

        await prepareTransferRecoveryJob({
          scope: recoveryScope,
          key: idempotencyKey,
          operationType: "fiat_payout",
          planId: plan_id,
          walletId: wallet_id,
          chain,
          token: tokenSymbol,
          request: {
            amount,
            description,
            fiat_transaction_id,
            is_solana: chain === "solana",
          },
        });

        logger.info("Transferring settlement tokens for fiat payout", {
          module: "plans/fiat-webhook",
          planId: plan_id,
          walletAddress: user_wallet_address,
          treasury,
          amount,
          chain,
          token: tokenSymbol,
        });

        let tx: string;

        try {
          const result = await executeDirectTransfer({
            senderWalletAddress: user_wallet_address,
            recipientAddress: treasury,
            amount,
            chain,
            token: tokenSymbol,
            idempotencyKey,
          });

          tx = result.tx;
        } catch (error) {
          const errorObj = error instanceof Error ? error : new Error(String(error));
          await failTransferRecoveryJob(recoveryScope, idempotencyKey, errorObj.message);
          throw errorObj;
        }

        await markTransferRecoveryExternalSucceeded(recoveryScope, idempotencyKey, { tx });

        await notifyNewFiatPayout({
          planId: plan_id,
          walletId: wallet_id,
          amount,
          token: tokenSymbol,
          chain,
          bankName: plan.bank_name,
          accountNumber: plan.payout_account_number,
          accountName: plan.account_name,
          fiatTransactionId: fiat_transaction_id,
          onchainTx: tx,
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

        const responseBody = {
          success: true,
          signature: tx,
          message: "Fiat payout settled and processed successfully.",
        };

        if (recordError) {
          logger.error("Failed to persist fiat payout records", {
            module: "plans/fiat-webhook",
            planId: plan_id,
            fiatTransactionId: fiat_transaction_id,
          }, recordError);

          return NextResponse.json(
            { ...responseBody, recoveryPending: true, message: "Transfer broadcasted; database recovery is queued." },
            { status: 202, headers: corsHeaders }
          );
        }

        await completeTransferRecoveryJob(recoveryScope, idempotencyKey, responseBody);

        return NextResponse.json(responseBody, { headers: corsHeaders });
      }
    );
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    logger.error("Fiat payout webhook error", { module: "plans/fiat-webhook" }, errorObj);

    return NextResponse.json(
      { error: "Fiat payout webhook processing failed" },
      { status: 500, headers: corsHeaders }
    );
  }
}
