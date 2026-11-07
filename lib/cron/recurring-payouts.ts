import supabase from "@/utils/supabase";
import { optionalEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { advancePlanSchedule } from "./schedule";
import {
  type PlanRow,
  type PlanWithWallets,
  PlanWithWalletsSchema,
  type ProcessSummary,
} from "./types";

export async function fetchDueRecurringPlans(): Promise<PlanRow[]> {
  const now = new Date();

  const { data, error } = await supabase
    .from("plans")
    .select(`
      *,
      wallets (
        balance
      )
    `)
    .eq("status", "active")
    .lte("next_payout_date", now.toISOString());

  if (error) {
    logger.error("Error fetching due recurring plans", { module: "cron/recurring" }, error);
    throw new Error(`Could not fetch recurring plans: ${error.message}`);
  }

  const sufficientBalancePlans: PlanRow[] = [];

  for (const item of data ?? []) {
    const parsed = PlanWithWalletsSchema.safeParse(item);

    if (!parsed.success) continue;

    const plan: PlanWithWallets = parsed.data;
    const wallet = Array.isArray(plan.wallets) ? plan.wallets[0] : plan.wallets;

    if (!wallet) {
      logger.warn("Plan has no associated wallet; skipping", {
        module: "cron/recurring",
        planId: plan.id,
      });

      continue;
    }

    const balance = wallet.balance ?? 0;
    const required = plan.recurrent_payout ?? 0;

    if (balance < required) {
      logger.info("Plan dropped due to insufficient balance", {
        module: "cron/recurring",
        planId: plan.id,
        balance,
        required,
      });

      continue;
    }

    sufficientBalancePlans.push(plan);
  }

  return sufficientBalancePlans;
}

async function sendFiatRecurringPayoutRequest(plan: PlanRow): Promise<void> {
  const originalNext = plan.next_payout_date ? String(plan.next_payout_date) : "";

  const { count: existingCount, error: countError } = await supabase
    .from("alerts")
    .select("id", { count: "exact", head: true })
    .filter("data->>id", "eq", String(plan.id))
    .filter("data->>next_payout_date", "eq", originalNext);

  if (countError) {
    logger.error("Error checking existing alerts for recurring plan", {
      module: "cron/recurring",
      planId: plan.id,
    }, countError);

    throw new Error(`Could not verify duplicates for plan ${plan.id}: ${countError.message}`);
  }

  if (Number.isFinite(existingCount) && (existingCount ?? 0) > 0) {
    logger.info("Duplicate recurring fiat alert skipped", {
      module: "cron/recurring",
      planId: plan.id,
      scheduledAt: originalNext,
    });

    return;
  }

  const payload = {
    ...plan,
    event: "recurring_payout_fiat",
    scheduled_for: new Date().toISOString().split("T")[0],
    idempotency_key: `payout_recurring_fiat_${plan.id}_${originalNext}`,
  };

  const { error: insertError } = await supabase
    .from("alerts")
    .insert([{ data: payload }]);

  if (insertError) {
    logger.error("Error storing recurring fiat payout alert", {
      module: "cron/recurring",
      planId: plan.id,
    }, insertError);

    throw new Error(`Failed to store recurring fiat payout for plan ${plan.id}: ${insertError.message}`);
  }

  logger.info("Successfully stored recurring fiat payout alert", {
    module: "cron/recurring",
    planId: plan.id,
  });
}

async function sendCryptoRecurringPayoutRequest(plan: PlanRow): Promise<void> {
  const url = optionalEnv("PAYOUT_ENDPOINT_URL");
  const token = optionalEnv("PAYOUT_AUTH_TOKEN") ?? optionalEnv("SERVICE_AUTH_TOKEN");

  if (!url || !token) {
    throw new Error("Missing required crypto payout configuration (PAYOUT_ENDPOINT_URL or token)");
  }

  const payload = { plan_id: plan.id };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Crypto recurring payout request failed (${response.status} ${response.statusText}): ${errorBody}`);
  }

  logger.info("Successfully dispatched crypto recurring payout request", {
    module: "cron/recurring",
    planId: plan.id,
  });
}

export async function processRecurringPlans(plans: PlanRow[]): Promise<ProcessSummary> {
  const results: ProcessSummary = { successful: 0, failed: 0, details: [] };

  const promises = plans.map(async (plan) => {
    try {
      if (plan.payout_method === "fiat") {
        await sendFiatRecurringPayoutRequest(plan);
        await advancePlanSchedule(plan);
        results.successful++;
        results.details.push({ planId: plan.id, type: "fiat", status: "success" });
      } else {
        await sendCryptoRecurringPayoutRequest(plan);
        await advancePlanSchedule(plan);
        results.successful++;
        results.details.push({ planId: plan.id, type: "crypto", status: "success" });
      }
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      logger.error("Failed to process recurring plan", {
        module: "cron/recurring",
        planId: plan.id,
      }, errorObj);

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

export async function runRecurringPayoutsJob(): Promise<ProcessSummary> {
  logger.info("Starting recurring payout scheduling process", { module: "cron/recurring" });

  const duePlans = await fetchDueRecurringPlans();

  if (duePlans.length === 0) {
    logger.debug("No recurring plans due for payout", { module: "cron/recurring" });

    return { successful: 0, failed: 0, details: [] };
  }

  logger.info("Processing due recurring plans", {
    module: "cron/recurring",
    count: duePlans.length,
  });

  return await processRecurringPlans(duePlans);
}
