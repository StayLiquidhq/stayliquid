import { NextRequest } from "next/server";
import { z } from "zod";
import supabase from "@/utils/supabase";
import { getOnChainTokenBalance } from "@/lib/cdp_balance";
import { executeSplitPayout, SplitPayoutResult } from "@/lib/cdp_transfers";
import { getPlatformFeesWallet } from "@/lib/treasury";
import { parseChainWithFallback, parseTokenWithFallback } from "@/lib/tokens";
import { logger } from "@/lib/logger";
import { recordAuditLog } from "@/lib/audit";
import { computeNextPayoutDate } from "@/lib/cron/schedule";
import type { PlanRow } from "@/lib/cron/types";
import type { Json } from "@/lib/supabase/types";
import {
  completeTransferRecoveryJob,
  failTransferRecoveryJob,
  getTransferRecoveryJob,
  markTransferRecoveryExternalSucceeded,
  prepareTransferRecoveryJob,
} from "@/lib/recovery";

export interface PayoutExecutionResult {
  success: boolean;
  httpStatus: number;
  status?: "completed" | "pending" | "skipped" | "failed";
  message?: string;
  error?: string;
  details?: unknown;
  payoutTx?: string;
  feeTx?: string | null;
  signature?: string;
  txHash?: string;
  totalAmount?: number;
  payoutAmount?: number;
  feeAmount?: number;
  chain?: string;
  token?: string;
  next_payout_date?: string | null;
  recoveryPending?: boolean;
}

const WalletItemSchema = z.object({
  id: z.string().uuid(),
  address: z.string(),
  chain_type: z.string(),
});

const PlanWithWalletsSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string(),
  payout_method: z.string().default("fiat"),
  payout_wallet_address: z.string().nullable().optional(),
  recurrent_payout: z.number().nullable().optional(),
  frequency: z.string().nullable().optional(),
  status: z.string(),
  next_payout_date: z.string().nullable().optional(),
  payout_time: z.string().nullable().optional(),
  target_date: z.string().nullable().optional(),
  chain: z.string().nullable().optional(),
  token: z.string().nullable().optional(),
  wallets: z.array(WalletItemSchema).min(1),
});

type PlanWithWallets = z.infer<typeof PlanWithWalletsSchema>;

const SavedRecoverySchema = z.object({
  payoutTx: z.string().optional(),
  feeTx: z.string().nullable().optional(),
  signature: z.string().optional(),
  txHash: z.string().optional(),
  totalAmount: z.number().optional(),
  payoutAmount: z.number().optional(),
  feeAmount: z.number().optional(),
  chain: z.string().optional(),
  token: z.string().optional(),
  next_payout_date: z.string().nullable().optional(),
});

function buildPlanRow(plan: PlanWithWallets): PlanRow {
  return {
    id: plan.id,
    user_id: plan.user_id,
    plan_type: "recurring",
    payout_method: plan.payout_method,
    status: plan.status,
    payout_time: plan.payout_time,
    next_payout_date: plan.next_payout_date,
    target_date: plan.target_date,
    frequency: plan.frequency,
    recurrent_payout: plan.recurrent_payout,
    payout_wallet_address: plan.payout_wallet_address,
    chain: plan.chain,
    token: plan.token,
  };
}

export async function executeRecurringPayoutForPlan(
  planId: string,
  request?: NextRequest,
): Promise<PayoutExecutionResult> {
  const { data: rawPlan, error: planError } = await supabase
    .from("plans")
    .select(`
      id,
      user_id,
      payout_method,
      payout_wallet_address,
      recurrent_payout,
      frequency,
      status,
      next_payout_date,
      payout_time,
      target_date,
      chain,
      token,
      wallets (id, address, chain_type)
    `)
    .eq("id", planId)
    .single();

  if (planError || !rawPlan) {
    logger.error("Plan not found for recurring payout", {
      module: "payout-service/recurring",
      planId,
    }, planError);

    return {
      success: false,
      httpStatus: 404,
      error: "Plan or wallet not found",
    };
  }

  const parsedPlan = PlanWithWalletsSchema.safeParse(rawPlan);

  if (!parsedPlan.success) {
    logger.error("Invalid plan or wallet data for recurring payout", {
      module: "payout-service/recurring",
      planId,
    });

    return {
      success: false,
      httpStatus: 404,
      error: "Plan or wallet not found",
    };
  }

  const plan = parsedPlan.data;

  if (plan.status !== "active") {
    return {
      success: false,
      httpStatus: 400,
      error: `Plan is not active (current status: ${plan.status})`,
    };
  }

  const wallet = plan.wallets[0];
  const payoutAmount = plan.recurrent_payout;

  if (plan.payout_method === "fiat") {
    logger.info("Plan is a fiat payout. Skipping on-chain transfer.", {
      module: "payout-service/recurring",
      planId,
    });

    return {
      success: true,
      status: "skipped",
      httpStatus: 200,
      message: "Fiat payout scheduled, handled by webhook.",
    };
  }

  const recipientAddress = plan.payout_wallet_address;

  if (!recipientAddress) {
    return {
      success: false,
      httpStatus: 400,
      error: "Payout wallet address not set for this plan",
    };
  }

  if (!payoutAmount || payoutAmount <= 0) {
    return {
      success: false,
      httpStatus: 400,
      error: "Invalid recurrent payout amount for this plan",
    };
  }

  const chain = parseChainWithFallback(plan.chain, parseChainWithFallback(wallet.chain_type));
  const tokenSymbol = parseTokenWithFallback(plan.token);

  const payoutSlot = plan.next_payout_date ?? new Date().toISOString().slice(0, 10);
  const idempotencyKey = `payout:${planId}:${payoutSlot}`;
  const recoveryScope = "plans/payout";

  const existingRecovery = await getTransferRecoveryJob(recoveryScope, idempotencyKey);

  if (existingRecovery?.status === "completed" && existingRecovery.response) {
    const parsedRecovery = SavedRecoverySchema.safeParse(existingRecovery.response);

    if (parsedRecovery.success) {
      const saved = parsedRecovery.data;

      return {
        success: true,
        status: "completed",
        httpStatus: 200,
        payoutTx: saved.payoutTx,
        feeTx: saved.feeTx,
        signature: saved.signature,
        txHash: saved.txHash,
        totalAmount: saved.totalAmount ?? payoutAmount,
        payoutAmount: saved.payoutAmount,
        feeAmount: saved.feeAmount,
        chain: saved.chain ?? chain,
        token: saved.token ?? tokenSymbol,
        next_payout_date: saved.next_payout_date,
      };
    }
  }

  if (existingRecovery && existingRecovery.status !== "failed") {
    return {
      success: false,
      status: "pending",
      recoveryPending: true,
      httpStatus: 202,
      error: existingRecovery.last_error ?? "Transfer recovery in progress",
    };
  }

  const liveOnChainBalance = await getOnChainTokenBalance({
    address: wallet.address,
    chain,
    token: tokenSymbol,
  });

  if (liveOnChainBalance < payoutAmount) {
    logger.warn("Insufficient on-chain balance for recurring payout", {
      module: "payout-service/recurring",
      planId,
      walletAddress: wallet.address,
      onChainBalance: liveOnChainBalance,
      requiredAmount: payoutAmount,
      chain,
      token: tokenSymbol,
    });

    return {
      success: false,
      httpStatus: 400,
      error: "Insufficient on-chain balance for payout",
      details: { onChainBalance: liveOnChainBalance, payoutAmount },
    };
  }

  const now = new Date();
  let nextPayoutDateIso: string | null = null;

  try {
    const planForCron = buildPlanRow(plan);

    nextPayoutDateIso = computeNextPayoutDate(planForCron, now).toISOString();
  } catch {
    const fallbackDate = new Date(now);

    switch (plan.frequency?.toLowerCase()) {
      case "daily":
        fallbackDate.setDate(fallbackDate.getDate() + 1);
        break;
      case "weekly":
        fallbackDate.setDate(fallbackDate.getDate() + 7);
        break;
      case "monthly":
        fallbackDate.setMonth(fallbackDate.getMonth() + 1);
        break;
      default:
        fallbackDate.setDate(fallbackDate.getDate() + 1);
        break;
    }

    nextPayoutDateIso = fallbackDate.toISOString();
  }

  const recoveryRequest = {
    amount: payoutAmount,
    recipient: recipientAddress,
    last_payout_date: now.toISOString(),
    next_payout_date: nextPayoutDateIso,
    is_solana: chain === "solana",
  } satisfies { [key: string]: Json | undefined };

  await prepareTransferRecoveryJob({
    scope: recoveryScope,
    key: idempotencyKey,
    operationType: "recurring_payout",
    userId: plan.user_id,
    planId,
    walletId: wallet.id,
    chain,
    token: tokenSymbol,
    request: recoveryRequest,
  });

  const feeTreasury = getPlatformFeesWallet(chain);

  logger.info("Executing recurring split payout directly from user wallet", {
    module: "payout-service/recurring",
    planId,
    senderWalletAddress: wallet.address,
    recipientAddress,
    feeTreasury,
    totalAmount: payoutAmount,
    chain,
    token: tokenSymbol,
  });

  let result: SplitPayoutResult;

  try {
    result = await executeSplitPayout({
      senderWalletAddress: wallet.address,
      recipientAddress,
      feeTreasuryAddress: feeTreasury,
      totalAmount: payoutAmount,
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

  const externalSucceededData = {
    payoutTx: result.payoutTx,
    feeTx: result.feeTx,
    payoutAmount: result.payoutAmount,
    feeAmount: result.feeAmount,
  } satisfies { [key: string]: Json | undefined };

  await markTransferRecoveryExternalSucceeded(recoveryScope, idempotencyKey, externalSucceededData);

  const { error: recordError } = await supabase.rpc("record_recurring_payout", {
    p_plan_id: planId,
    p_wallet_id: wallet.id,
    p_tx: result.payoutTx,
    p_amount: result.payoutAmount,
    p_currency: tokenSymbol,
    p_recipient: recipientAddress,
    p_last_payout_date: now.toISOString(),
    p_next_payout_date: nextPayoutDateIso ?? undefined,
    p_is_solana: chain === "solana",
  });

  if (result.feeTx && result.feeAmount > 0) {
    await supabase.from("transactions").insert({
      wallet_id: wallet.id,
      type: "platform_fee",
      amount: result.feeAmount,
      currency: tokenSymbol,
      description: "Platform fee (5%) for recurring savings payout",
      solana_signature: chain === "solana" ? result.feeTx : null,
      transaction_hash: chain !== "solana" ? result.feeTx : null,
      created_at: now.toISOString(),
    });
  }

  const responseBody: PayoutExecutionResult = {
    success: true,
    status: "completed",
    httpStatus: recordError ? 202 : 200,
    payoutTx: result.payoutTx,
    feeTx: result.feeTx,
    signature: result.payoutTx,
    txHash: result.payoutTx,
    totalAmount: payoutAmount,
    payoutAmount: result.payoutAmount,
    feeAmount: result.feeAmount,
    chain,
    token: tokenSymbol,
    next_payout_date: nextPayoutDateIso,
    recoveryPending: Boolean(recordError),
    message: recordError ? "Transfer broadcasted; database recovery is queued." : undefined,
  };

  if (recordError) {
    logger.error("Failed to persist recurring payout records", {
      module: "payout-service/recurring",
      planId,
      tx: result.payoutTx,
    }, recordError);

    return responseBody;
  }

  const completedJobData = {
    success: true,
    payoutTx: result.payoutTx,
    feeTx: result.feeTx,
    signature: result.payoutTx,
    txHash: result.payoutTx,
    totalAmount: payoutAmount,
    payoutAmount: result.payoutAmount,
    feeAmount: result.feeAmount,
    chain,
    token: tokenSymbol,
    next_payout_date: nextPayoutDateIso,
  } satisfies { [key: string]: Json | undefined };

  await completeTransferRecoveryJob(recoveryScope, idempotencyKey, completedJobData);

  recordAuditLog({ userId: plan.user_id, eventType: "payout", request });

  return responseBody;
}

export async function executeTargetPayoutForPlan(
  planId: string,
  request?: NextRequest,
): Promise<PayoutExecutionResult> {
  const { data: rawPlan, error: planError } = await supabase
    .from("plans")
    .select(`
      id,
      user_id,
      payout_method,
      payout_wallet_address,
      status,
      chain,
      token,
      wallets (id, address, chain_type)
    `)
    .eq("id", planId)
    .single();

  if (planError || !rawPlan) {
    logger.error("Plan not found for target payout", {
      module: "payout-service/target",
      planId,
    }, planError);

    return {
      success: false,
      httpStatus: 404,
      error: "Plan or wallet not found",
    };
  }

  const TargetPlanSchema = z.object({
    id: z.string().uuid(),
    user_id: z.string(),
    payout_method: z.string().default("fiat"),
    payout_wallet_address: z.string().nullable().optional(),
    status: z.string(),
    chain: z.string().nullable().optional(),
    token: z.string().nullable().optional(),
    wallets: z.array(WalletItemSchema).min(1),
  });

  const parsedPlan = TargetPlanSchema.safeParse(rawPlan);

  if (!parsedPlan.success) {
    logger.error("Invalid target plan or wallet data", {
      module: "payout-service/target",
      planId,
    });

    return {
      success: false,
      httpStatus: 404,
      error: "Plan or wallet not found",
    };
  }

  const plan = parsedPlan.data;

  if (plan.status !== "active") {
    return {
      success: false,
      httpStatus: 400,
      error: `Plan is already ${plan.status}`,
    };
  }

  const wallet = plan.wallets[0];

  if (plan.payout_method === "fiat") {
    logger.info("Plan is a fiat payout. Skipping on-chain transfer.", {
      module: "payout-service/target",
      planId,
    });

    return {
      success: true,
      status: "skipped",
      httpStatus: 200,
      message: "Fiat target payout acknowledged.",
    };
  }

  const recipientAddress = plan.payout_wallet_address;

  if (!recipientAddress) {
    return {
      success: false,
      httpStatus: 400,
      error: "Payout wallet address not set",
    };
  }

  const chain = parseChainWithFallback(plan.chain, parseChainWithFallback(wallet.chain_type));
  const tokenSymbol = parseTokenWithFallback(plan.token);
  const idempotencyKey = `payout-target:${planId}`;
  const recoveryScope = "plans/payout-target";

  const existingRecovery = await getTransferRecoveryJob(recoveryScope, idempotencyKey);

  if (existingRecovery?.status === "completed" && existingRecovery.response) {
    const parsedRecovery = SavedRecoverySchema.safeParse(existingRecovery.response);

    if (parsedRecovery.success) {
      const saved = parsedRecovery.data;

      return {
        success: true,
        status: "completed",
        httpStatus: 200,
        payoutTx: saved.payoutTx,
        feeTx: saved.feeTx,
        signature: saved.signature,
        txHash: saved.txHash,
        totalAmount: saved.totalAmount,
        payoutAmount: saved.payoutAmount,
        feeAmount: saved.feeAmount,
        chain: saved.chain ?? chain,
        token: saved.token ?? tokenSymbol,
      };
    }
  }

  if (existingRecovery && existingRecovery.status !== "failed") {
    return {
      success: false,
      status: "pending",
      recoveryPending: true,
      httpStatus: 202,
      error: existingRecovery.last_error ?? "Transfer recovery in progress",
    };
  }

  const liveOnChainBalance = await getOnChainTokenBalance({
    address: wallet.address,
    chain,
    token: tokenSymbol,
  });

  if (liveOnChainBalance <= 0) {
    logger.warn("Zero on-chain balance for target payout", {
      module: "payout-service/target",
      planId,
      walletAddress: wallet.address,
      chain,
      token: tokenSymbol,
    });

    return {
      success: false,
      httpStatus: 400,
      error: "No balance to pay out in wallet",
    };
  }

  const recoveryRequest = {
    amount: liveOnChainBalance,
    recipient: recipientAddress,
    is_solana: chain === "solana",
  } satisfies { [key: string]: Json | undefined };

  await prepareTransferRecoveryJob({
    scope: recoveryScope,
    key: idempotencyKey,
    operationType: "target_payout",
    userId: plan.user_id,
    planId,
    walletId: wallet.id,
    chain,
    token: tokenSymbol,
    request: recoveryRequest,
  });

  const feeTreasury = getPlatformFeesWallet(chain);

  logger.info("Executing target split payout directly from user wallet", {
    module: "payout-service/target",
    planId,
    senderWalletAddress: wallet.address,
    recipientAddress,
    feeTreasury,
    payoutAmount: liveOnChainBalance,
    chain,
    token: tokenSymbol,
  });

  let result: SplitPayoutResult;

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

  const externalSucceededData = {
    payoutTx: result.payoutTx,
    feeTx: result.feeTx,
    payoutAmount: result.payoutAmount,
    feeAmount: result.feeAmount,
  } satisfies { [key: string]: Json | undefined };

  await markTransferRecoveryExternalSucceeded(recoveryScope, idempotencyKey, externalSucceededData);

  const { error: recordError } = await supabase.rpc("record_target_payout", {
    p_plan_id: planId,
    p_wallet_id: wallet.id,
    p_tx: result.payoutTx,
    p_amount: result.payoutAmount,
    p_currency: tokenSymbol,
    p_recipient: recipientAddress,
    p_is_solana: chain === "solana",
  });

  const now = new Date();

  if (result.feeTx && result.feeAmount > 0) {
    await supabase.from("transactions").insert({
      wallet_id: wallet.id,
      type: "platform_fee",
      amount: result.feeAmount,
      currency: tokenSymbol,
      description: "Platform fee (5%) for target savings payout",
      solana_signature: chain === "solana" ? result.feeTx : null,
      transaction_hash: chain !== "solana" ? result.feeTx : null,
      created_at: now.toISOString(),
    });
  }

  const responseBody: PayoutExecutionResult = {
    success: true,
    status: "completed",
    httpStatus: recordError ? 202 : 200,
    payoutTx: result.payoutTx,
    feeTx: result.feeTx,
    signature: result.payoutTx,
    txHash: result.payoutTx,
    totalAmount: liveOnChainBalance,
    payoutAmount: result.payoutAmount,
    feeAmount: result.feeAmount,
    chain,
    token: tokenSymbol,
    recoveryPending: Boolean(recordError),
    message: recordError ? "Transfer broadcasted; database recovery is queued." : undefined,
  };

  if (recordError) {
    logger.error("Failed to persist target payout records", {
      module: "payout-service/target",
      planId,
      tx: result.payoutTx,
    }, recordError);

    return responseBody;
  }

  const completedJobData = {
    success: true,
    payoutTx: result.payoutTx,
    feeTx: result.feeTx,
    signature: result.payoutTx,
    txHash: result.payoutTx,
    totalAmount: liveOnChainBalance,
    payoutAmount: result.payoutAmount,
    feeAmount: result.feeAmount,
    chain,
    token: tokenSymbol,
  } satisfies { [key: string]: Json | undefined };

  await completeTransferRecoveryJob(recoveryScope, idempotencyKey, completedJobData);

  recordAuditLog({ userId: plan.user_id, eventType: "payout", request });

  return responseBody;
}
