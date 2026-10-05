import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { getOnChainTokenBalance } from "@/lib/cdp_balance";
import { executeDirectTransfer } from "@/lib/cdp_transfers";
import { parseChainWithFallback, parseTokenWithFallback } from "@/lib/tokens";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import { withIdempotency } from "@/lib/idempotency";
import { recordAuditLog } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/rate-limit";
import { unauthorizedServiceResponse, verifyServiceBearerToken } from "@/lib/service-auth";
import {
  completeTransferRecoveryJob,
  failTransferRecoveryJob,
  getTransferRecoveryJob,
  markTransferRecoveryExternalSucceeded,
  prepareTransferRecoveryJob,
} from "@/lib/recovery";

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
    const rateLimited = await enforceRateLimit(request, {
      scope: "plans-payout-target",
      limit: 30,
      windowSeconds: 60,
      headers: corsHeaders,
    });

    if (rateLimited) return rateLimited;

    if (!verifyServiceBearerToken(request, "TARGET_PAYOUT_AUTH_TOKEN")) {
      return unauthorizedServiceResponse("plans/payout-target", corsHeaders);
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
    const idempotencyKey = `payout-target:${plan_id}`;
    const recoveryScope = "plans/payout-target";

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

        const recoveryRequest = {
          amount: liveOnChainBalance,
          recipient: recipientAddress,
          is_solana: chain === "solana",
        };

        await prepareTransferRecoveryJob({
          scope: recoveryScope,
          key: idempotencyKey,
          operationType: "target_payout",
          userId: plan.user_id,
          planId: plan_id,
          walletId: wallet.id,
          chain,
          token: tokenSymbol,
          request: recoveryRequest,
        });

        logger.info("Executing target payout directly from user Coinbase wallet", {
          module: "plans/payout-target",
          planId: plan_id,
          senderWalletAddress: wallet.address,
          recipientAddress,
          payoutAmount: liveOnChainBalance,
          chain,
          token: tokenSymbol,
        });

        let tx: string;

        try {
          const result = await executeDirectTransfer({
            senderWalletAddress: wallet.address,
            recipientAddress,
            amount: liveOnChainBalance,
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

        const { error: recordError } = await supabase.rpc("record_target_payout", {
          p_plan_id: plan_id,
          p_wallet_id: wallet.id,
          p_tx: tx,
          p_amount: liveOnChainBalance,
          p_currency: tokenSymbol,
          p_recipient: recipientAddress,
          p_is_solana: chain === "solana",
        });

        const responseBody = {
          success: true,
          signature: tx,
          txHash: tx,
          payoutAmount: liveOnChainBalance,
          chain,
          token: tokenSymbol,
        };

        if (recordError) {
          logger.error("Failed to persist target payout records", {
            module: "plans/payout-target",
            planId: plan_id,
            tx,
          }, recordError);

          return NextResponse.json(
            { ...responseBody, recoveryPending: true, message: "Transfer broadcasted; database recovery is queued." },
            { status: 202, headers: corsHeaders }
          );
        }

        await completeTransferRecoveryJob(recoveryScope, idempotencyKey, responseBody);

        recordAuditLog({ userId: plan.user_id, eventType: "payout", request });

        return NextResponse.json(responseBody, { headers: corsHeaders });
      }
    );
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    logger.error("Target payout execution failed", { module: "plans/payout-target" }, errorObj);

    return NextResponse.json(
      { error: "Target payout execution failed" },
      { status: 500, headers: corsHeaders }
    );
  }
}
