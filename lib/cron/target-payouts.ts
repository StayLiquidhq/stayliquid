import supabase from "@/utils/supabase";
import { logger } from "@/lib/logger";
import { executeTargetPayoutForPlan } from "@/lib/payout-service";
import {
  type PlanRow,
  type PlanWithWallets,
  PlanRowSchema,
  PlanWithWalletsSchema,
  type ProcessSummary,
} from "./types";

export async function fetchDueByDatePlans(): Promise<PlanRow[]> {
  const today = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .eq("target_type", "date")
    .eq("status", "active")
    .lte("target_date", today);

  if (error) {
    logger.error("Error fetching due by date plans", { module: "cron/target" }, error);
    throw error;
  }

  const validPlans: PlanRow[] = [];

  for (const item of data ?? []) {
    const parsed = PlanRowSchema.safeParse(item);

    if (parsed.success) {
      validPlans.push(parsed.data);
    }
  }

  return validPlans;
}

export async function fetchDueByAmountPlans(): Promise<PlanRow[]> {
  const { data, error } = await supabase
    .from("plans")
    .select(`
      *,
      wallets (
        balance
      )
    `)
    .eq("target_type", "amount")
    .eq("status", "active");

  if (error) {
    logger.error("Error fetching due by amount plans", { module: "cron/target" }, error);
    throw error;
  }

  const duePlans: PlanRow[] = [];

  for (const item of data ?? []) {
    const parsed = PlanWithWalletsSchema.safeParse(item);

    if (!parsed.success) continue;

    const plan: PlanWithWallets = parsed.data;
    const wallet = Array.isArray(plan.wallets) ? plan.wallets[0] : plan.wallets;
    const balance = wallet?.balance ?? 0;
    const targetAmount = plan.target_amount ?? Number.POSITIVE_INFINITY;

    if (balance >= targetAmount) {
      duePlans.push(plan);
    }
  }

  return duePlans;
}

async function sendFiatTargetPayoutRequest(plan: PlanRow): Promise<void> {
  const scheduledFor = new Date().toISOString().split("T")[0];

  const { data: existing, error: checkError } = await supabase
    .from("alerts")
    .select("id")
    .eq("data->>id", String(plan.id))
    .eq("data->>scheduled_for", scheduledFor)
    .limit(1);

  if (checkError) {
    logger.error("Error checking existing fiat payout alert", {
      module: "cron/target",
      planId: plan.id,
    }, checkError);

    throw new Error(`Failed idempotency check for plan ${plan.id}: ${checkError.message}`);
  }

  if (Array.isArray(existing) && existing.length > 0) {
    logger.info("Fiat payout request already exists for plan date; skipping insert", {
      module: "cron/target",
      planId: plan.id,
      scheduledFor,
    });

    return;
  }

  const payload = {
    ...plan,
    scheduled_for: scheduledFor,
    event: "target_payout_fiat",
    idempotency_key: `payout_fiat_${plan.id}_${scheduledFor}`,
  };

  const { error: insertError } = await supabase
    .from("alerts")
    .insert([{ data: payload }]);

  if (insertError) {
    logger.error("Error storing fiat payout alert", { module: "cron/target", planId: plan.id }, insertError);
    throw new Error(`Failed to store fiat payout for plan ${plan.id}: ${insertError.message}`);
  }

  logger.info("Successfully stored fiat payout alert for target plan", {
    module: "cron/target",
    planId: plan.id,
  });
}

async function executeCryptoTargetPayout(plan: PlanRow): Promise<void> {
  const result = await executeTargetPayoutForPlan(plan.id);

  if (!result.success) {
    throw new Error(result.error ?? "Crypto target payout failed");
  }

  logger.info("Successfully executed crypto payout for target plan", {
    module: "cron/target",
    planId: plan.id,
    txHash: result.txHash,
    payoutAmount: result.payoutAmount,
    feeAmount: result.feeAmount,
  });
}

export async function processTargetPlans(plans: PlanRow[]): Promise<ProcessSummary> {
  const results: ProcessSummary = { successful: 0, failed: 0, details: [] };

  const promises = plans.map(async (plan) => {
    try {
      if (plan.payout_method === "fiat") {
        await sendFiatTargetPayoutRequest(plan);
        results.successful++;
        results.details.push({ planId: plan.id, type: "fiat", status: "success" });
      } else {
        await executeCryptoTargetPayout(plan);
        results.successful++;
        results.details.push({ planId: plan.id, type: "crypto", status: "success" });
      }
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      logger.error("Failed to process target plan", { module: "cron/target", planId: plan.id }, errorObj);

      results.failed++;
      results.details.push({
        planId: plan.id,
        type: plan.payout_method,
        status: "failed",
        error: errorObj.message,
      });
    }
  });

  await Promise.allSettled(promises);

  return results;
}

export async function runTargetPayoutsJob(): Promise<ProcessSummary> {
  logger.info("Starting target payout scheduling process", { module: "cron/target" });

  const dueByDate = await fetchDueByDatePlans();
  const dueByAmount = await fetchDueByAmountPlans();

  const allDue = [...dueByDate, ...dueByAmount];

  if (allDue.length === 0) {
    logger.debug("No target plans due for payout", { module: "cron/target" });

    return { successful: 0, failed: 0, details: [] };
  }

  const uniquePlansMap = new Map<string, PlanRow>();

  for (const plan of allDue) {
    uniquePlansMap.set(plan.id, plan);
  }

  const uniqueDuePlans = Array.from(uniquePlansMap.values());

  logger.info("Processing due target plans", {
    module: "cron/target",
    count: uniqueDuePlans.length,
  });

  return await processTargetPlans(uniqueDuePlans);
}

