import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import supabase from "@/utils/supabase";
import { getOnChainTokenBalance } from "@/lib/cdp_balance";
import { executeSplitPayout } from "@/lib/cdp_transfers";
import { parseChainWithFallback, parseTokenWithFallback } from "@/lib/tokens";
import { getPlatformFeesWallet } from "@/lib/treasury";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import { withIdempotency } from "@/lib/idempotency";
import { recordAuditLog } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/rate-limit";
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
  status: string;
  payout_wallet_address: string | null;
  chain: string | null;
  token: string | null;
  wallets: Array<{ id: string; address: string; chain_type: string }>;
}

const BreakRequestSchema = z.object({
  plan_id: z.string().uuid("Invalid plan_id format"),
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

    const rateLimited = await enforceRateLimit(request, {
      scope: "plans-break",
      identity: user.id,
      limit: 10,
      windowSeconds: 60,
      headers: corsHeaders,
    });

    if (rateLimited) return rateLimited;

    const body = await request.json().catch(() => null);
    const parsed = BreakRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400, headers: corsHeaders }
      );
    }

    const { plan_id } = parsed.data;

    const { data: rawPlan, error: planError } = await supabase
      .from("plans")
      .select(
        `
        id,
        user_id,
        status,
        payout_wallet_address,
        chain,
        token,
        wallets (id, address, chain_type)
      `
      )
      .eq("id", plan_id)
      .eq("user_id", user.id)
      .single();

    if (
      planError ||
      !rawPlan ||
      !rawPlan.wallets ||
      !Array.isArray(rawPlan.wallets) ||
      rawPlan.wallets.length === 0
    ) {
      return NextResponse.json(
        { error: "Plan or wallet not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    // SAFETY: rawPlan existence and non-empty wallets array verified above
    const plan = rawPlan as PlanRecord;

    if (plan.status !== "active") {
      return NextResponse.json(
        { error: `Cannot break plan with status '${plan.status}'` },
        { status: 400, headers: corsHeaders }
      );
    }

    const wallet = plan.wallets[0];
    const recipientAddress = plan.payout_wallet_address;

    if (!recipientAddress) {
      return NextResponse.json(
        { error: "Payout wallet address not configured for this plan" },
        { status: 400, headers: corsHeaders }
      );
    }

    const chain = parseChainWithFallback(plan.chain, parseChainWithFallback(wallet.chain_type));
    const tokenSymbol = parseTokenWithFallback(plan.token);
    const idempotencyKey = request.headers.get("idempotency-key") ?? `break:${user.id}:${plan_id}`;
    const recoveryScope = "plans/break";

    return await withIdempotency(
      request,
      { scope: recoveryScope, key: idempotencyKey, userId: user.id, payload: { plan_id } },
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
          logger.warn("Zero on-chain balance to break", {
            module: "plans/break",
            planId: plan_id,
            walletAddress: wallet.address,
            chain,
            token: tokenSymbol,
          });

          return NextResponse.json(
            { error: "No balance to break in this wallet" },
            { status: 400, headers: corsHeaders }
          );
        }

        const feeTreasury = getPlatformFeesWallet(chain);

        await prepareTransferRecoveryJob({
          scope: recoveryScope,
          key: idempotencyKey,
          operationType: "plan_break",
          userId: user.id,
          planId: plan_id,
          walletId: wallet.id,
          chain,
          token: tokenSymbol,
          request: {
            total_balance: liveOnChainBalance,
            recipient: recipientAddress,
            is_solana: chain === "solana",
          },
        });

        let result: Awaited<ReturnType<typeof executeSplitPayout>>;

        try {
          result = await executeSplitPayout({
            senderWalletAddress: wallet.address,
            recipientAddress,
            feeTreasuryAddress: feeTreasury,
            totalAmount: liveOnChainBalance,
            feePercent: 0.05,
            chain,
            token: tokenSymbol,
            idempotencyKey,
          });
        } catch (error) {
          const errorObj = error instanceof Error ? error : new Error(String(error));
          await failTransferRecoveryJob(recoveryScope, idempotencyKey, errorObj.message);
          throw errorObj;
        }

        await markTransferRecoveryExternalSucceeded(recoveryScope, idempotencyKey, {
          payoutTx: result.payoutTx,
          feeTx: result.feeTx,
          payoutAmount: result.payoutAmount,
          feeAmount: result.feeAmount,
        });

        const { error: recordError } = await supabase.rpc("record_plan_break", {
          p_plan_id: plan_id,
          p_wallet_id: wallet.id,
          p_payout_tx: result.payoutTx,
          p_fee_tx: result.feeTx,
          p_payout_amount: result.payoutAmount,
          p_fee_amount: result.feeAmount,
          p_currency: tokenSymbol,
          p_is_solana: chain === "solana",
          p_recipient: recipientAddress,
        });

        const responseBody = {
          success: true,
          payoutTx: result.payoutTx,
          feeTx: result.feeTx,
          signature: result.payoutTx,
          totalBalance: liveOnChainBalance,
          payoutAmount: result.payoutAmount,
          feeAmount: result.feeAmount,
          chain,
          token: tokenSymbol,
        };

        if (recordError) {
          logger.error("Failed to persist plan break records", {
            module: "plans/break",
            planId: plan_id,
            payoutTx: result.payoutTx,
          }, recordError);

          return NextResponse.json(
            { ...responseBody, recoveryPending: true, message: "Transfer broadcasted; database recovery is queued." },
            { status: 202, headers: corsHeaders }
          );
        }

        await completeTransferRecoveryJob(recoveryScope, idempotencyKey, responseBody);

        recordAuditLog({ userId: user.id, eventType: "plan_break", request });

        return NextResponse.json(responseBody, { headers: corsHeaders });
      }
    );
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    logger.error("Error breaking plan", { module: "plans/break" }, errorObj);

    return NextResponse.json(
      { error: "Plan break failed" },
      { status: 500, headers: corsHeaders }
    );
  }
}
