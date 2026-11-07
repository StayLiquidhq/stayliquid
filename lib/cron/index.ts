import cron, { ScheduledTask } from "node-cron";

import { optionalEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { runRecurringPayoutsJob } from "./recurring-payouts";
import { runTargetPayoutsJob } from "./target-payouts";
import type { ProcessSummary } from "./types";

export * from "./types";

export * from "./schedule";

export * from "./target-payouts";

export * from "./recurring-payouts";

let targetTask: ScheduledTask | null = null;

let recurringTask: ScheduledTask | null = null;

let isTargetRunning = false;

let isRecurringRunning = false;

const DEFAULT_CRON_SCHEDULE = "*/5 * * * *";

export async function executeTargetJobSafely(): Promise<ProcessSummary | null> {
  if (isTargetRunning) {
    logger.warn("Target payout cron job already running; skipping cycle", { module: "cron/manager" });

    return null;
  }

  isTargetRunning = true;

  try {
    return await runTargetPayoutsJob();
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    logger.error("Target payout cron execution failed", { module: "cron/manager" }, errorObj);

    return null;
  } finally {
    isTargetRunning = false;
  }
}

export async function executeRecurringJobSafely(): Promise<ProcessSummary | null> {
  if (isRecurringRunning) {
    logger.warn("Recurring payout cron job already running; skipping cycle", { module: "cron/manager" });

    return null;
  }

  isRecurringRunning = true;

  try {
    return await runRecurringPayoutsJob();
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    logger.error("Recurring payout cron execution failed", { module: "cron/manager" }, errorObj);

    return null;
  } finally {
    isRecurringRunning = false;
  }
}

export function startCronJobs(): void {
  if (targetTask || recurringTask) {
    logger.info("Cron jobs are already initialized and running", { module: "cron/manager" });

    return;
  }

  const scheduleExpression = optionalEnv("CRON_SCHEDULE_EXPRESSION") ?? DEFAULT_CRON_SCHEDULE;

  logger.info("Initializing Liquid backend cron jobs", {
    module: "cron/manager",
    schedule: scheduleExpression,
  });

  targetTask = cron.schedule(scheduleExpression, async () => {
    logger.info("Running scheduled target payouts cron job", { module: "cron/manager" });
    await executeTargetJobSafely();
  });

  recurringTask = cron.schedule(scheduleExpression, async () => {
    logger.info("Running scheduled recurring payouts cron job", { module: "cron/manager" });
    await executeRecurringJobSafely();
  });
}

export function stopCronJobs(): void {
  if (targetTask) {
    targetTask.stop();
    targetTask = null;
  }

  if (recurringTask) {
    recurringTask.stop();
    recurringTask = null;
  }

  logger.info("Stopped all Liquid backend cron jobs", { module: "cron/manager" });
}
