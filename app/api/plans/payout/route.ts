import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { getOnChainTokenBalance } from "@/lib/cdp_balance";
import { executeDirectTransfer } from "@/lib/cdp_transfers";
import { parseChainWithFallback, parseTokenWithFallback } from "@/lib/tokens";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import { withIdempotency } from "@/lib/idempotency";
import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/rate-limit";
import { unauthorizedServiceResponse, verifyServiceToken } from "@/lib/service-auth";
import {
  completeTransferRecoveryJob,
  failTransferRecoveryJob,
  getTransferRecoveryJob,
  markTransferRecoveryExternalSucceeded,
  prepareTransferRecoveryJob,
} from "@/lib/recovery";

interface PlanRecord {
  id: string;
  payout_method: string;
  payout_wallet_address: string | null;
  recurrent_payout: number | null;
  frequency: string | null;
  status: string;
  next_payout_date: string | null;
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
    const rateLimited = await enforceRateLimit(request, {
      scope: "plans-payout",
      limit: 30,
      windowSeconds: 60,
      headers: corsHeaders,
    });

    if (rateLimited) return rateLimited;

    if (!verifyServiceToken(request)) {
      return unauthorizedServiceResponse("plans/payout", corsHeaders);
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
        payout_method,
        payout_wallet_address,
        recurrent_payout,
        frequency,
        status,
        next_payout_date,
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
      logger.error("Plan or wallet not found", { module: "plans/payout", planId: plan_id }, planError);

      return NextResponse.json(
        { error: "Plan or wallet not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    // SAFETY: rawPlan existence and non-empty wallets array verified above
    const plan = rawPlan as PlanRecord;

    if (plan.status !== "active") {
      return NextResponse.json(
        { error: `Plan is not active (current status: ${plan.status})` },
        { status: 400, headers: corsHeaders }
      );
    }

    const wallet = plan.wallets[0];
    const payoutAmount = plan.recurrent_payout;

    if (plan.payout_method === "fiat") {
      logger.info("Plan is a fiat payout. Skipping on-chain transfer.", {
        module: "plans/payout",
        planId: plan_id,
      });

      return NextResponse.json(
        { success: true, message: "Fiat payout scheduled, handled by webhook." },
        { headers: corsHeaders }
      );
    }

    const recipientAddress = plan.payout_wallet_address;

    if (!recipientAddress) {
      return NextResponse.json(
        { error: "Payout wallet address not set for this plan" },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!payoutAmount || payoutAmount <= 0) {
      return NextResponse.json(
        { error: "Invalid recurrent payout amount for this plan" },
        { status: 400, headers: corsHeaders }
      );
    }

    const chain = parseChainWithFallback(plan.chain, parseChainWithFallback(wallet.chain_type));
    const tokenSymbol = parseTokenWithFallback(plan.token);

    const payoutSlot = plan.next_payout_date ?? new Date().toISOString().slice(0, 10);
    const idempotencyKey = `payout:${plan_id}:${payoutSlot}`;
    const recoveryScope = "plans/payout";

    return await withIdempotency(
      request,
      { scope: recoveryScope, key: idempotencyKey },
      async () => {
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

        const liveOnChainBalance = await getOnChainTokenBalance({
          address: wallet.address,
          chain,
          token: tokenSymbol,
        });

        if (liveOnChainBalance < payoutAmount) {
          logger.warn("Insufficient on-chain balance for recurring payout", {
            module: "plans/payout",
            planId: plan_id,
            walletAddress: wallet.address,
            onChainBalance: liveOnChainBalance,
            requiredAmount: payoutAmount,
            chain,
            token: tokenSymbol,
          });

          return NextResponse.json(
            {
              error: "Insufficient on-chain balance for payout",
              details: { onChainBalance: liveOnChainBalance, payoutAmount },
            },
            { status: 400, headers: corsHeaders }
          );
        }

        const now = new Date();
        let next_payout_date: Date | null = new Date(now);

        switch (plan.frequency?.toLowerCase()) {
          case "daily":
            next_payout_date.setDate(next_payout_date.getDate() + 1);
            break;
          case "weekly":
            next_payout_date.setDate(next_payout_date.getDate() + 7);
            break;
          case "monthly":
            next_payout_date.setMonth(next_payout_date.getMonth() + 1);
            break;
          default:
            next_payout_date = null;
            break;
        }

        const nextPayoutDateIso = next_payout_date ? next_payout_date.toISOString() : null;

        const recoveryRequest = {
          amount: payoutAmount,
          recipient: recipientAddress,
          last_payout_date: now.toISOString(),
          next_payout_date: nextPayoutDateIso,
          is_solana: chain === "solana",
        };

        await prepareTransferRecoveryJob({
          scope: recoveryScope,
          key: idempotencyKey,
          operationType: "recurring_payout",
          planId: plan_id,
          walletId: wallet.id,
          chain,
          token: tokenSymbol,
          request: recoveryRequest,
        });

        logger.info("Executing recurring payout directly from user Coinbase wallet", {
          module: "plans/payout",
          planId: plan_id,
          senderWalletAddress: wallet.address,
          recipientAddress,
          payoutAmount,
          chain,
          token: tokenSymbol,
        });

        let tx: string;

        try {
          const result = await executeDirectTransfer({
            senderWalletAddress: wallet.address,
            recipientAddress,
            amount: payoutAmount,
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

        const { error: recordError } = await supabase.rpc("record_recurring_payout", {
          p_plan_id: plan_id,
          p_wallet_id: wallet.id,
          p_tx: tx,
          p_amount: payoutAmount,
          p_currency: tokenSymbol,
          p_recipient: recipientAddress,
          p_last_payout_date: now.toISOString(),
          p_next_payout_date: nextPayoutDateIso ?? undefined,
          p_is_solana: chain === "solana",
        });

        const responseBody = {
          success: true,
          signature: tx,
          txHash: tx,
          payoutAmount,
          chain,
          token: tokenSymbol,
          next_payout_date: nextPayoutDateIso,
        };

        if (recordError) {
          logger.error("Failed to persist recurring payout records", {
            module: "plans/payout",
            planId: plan_id,
            tx,
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
    logger.error("Payout endpoint execution failed", { module: "plans/payout" }, errorObj);

    return NextResponse.json(
      { error: "Payout execution failed" },
      { status: 500, headers: corsHeaders }
    );
  }
}
