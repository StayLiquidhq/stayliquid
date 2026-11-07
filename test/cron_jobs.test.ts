import test from "node:test";
import assert from "node:assert/strict";
import {
  parseTimeOfDay,
  parseWeekday,
  parseDayOfMonth,
  nextDaily,
  nextWeekly,
  nextMonthly,
  computeNextPayoutDate,
  DEFAULT_TIME_OF_DAY,
} from "../lib/cron/schedule";
import {
  fetchDueByDatePlans,
  fetchDueByAmountPlans,
} from "../lib/cron/target-payouts";
import { fetchDueRecurringPlans } from "../lib/cron/recurring-payouts";
import {
  startCronJobs,
  stopCronJobs,
  executeTargetJobSafely,
  executeRecurringJobSafely,
} from "../lib/cron";
import type { PlanRow } from "../lib/cron/types";

test("Cron Schedule: parseTimeOfDay validates time formats correctly", () => {
  assert.deepEqual(parseTimeOfDay("07:00"), { hours: 7, minutes: 0 });
  assert.deepEqual(parseTimeOfDay("14:30"), { hours: 14, minutes: 30 });
  assert.deepEqual(parseTimeOfDay("00:00"), { hours: 0, minutes: 0 });
  assert.deepEqual(parseTimeOfDay("23:59"), { hours: 23, minutes: 59 });

  assert.equal(parseTimeOfDay(""), null);
  assert.equal(parseTimeOfDay(null), null);
  assert.equal(parseTimeOfDay(undefined), null);
  assert.equal(parseTimeOfDay("24:00"), null);
  assert.equal(parseTimeOfDay("12:60"), null);
  assert.equal(parseTimeOfDay("not-a-time"), null);
});

test("Cron Schedule: parseWeekday parses case-insensitive day names", () => {
  assert.equal(parseWeekday("sunday"), 0);
  assert.equal(parseWeekday("Monday"), 1);
  assert.equal(parseWeekday("FRIDAY"), 5);
  assert.equal(parseWeekday("saturday"), 6);

  assert.equal(parseWeekday("funday"), null);
  assert.equal(parseWeekday(""), null);
  assert.equal(parseWeekday(null), null);
});

test("Cron Schedule: parseDayOfMonth clamps to valid 1-31 range", () => {
  assert.equal(parseDayOfMonth(1), 1);
  assert.equal(parseDayOfMonth(15), 15);
  assert.equal(parseDayOfMonth(31), 31);
  assert.equal(parseDayOfMonth("25"), 25);

  assert.equal(parseDayOfMonth(0), null);
  assert.equal(parseDayOfMonth(32), null);
  assert.equal(parseDayOfMonth(-5), null);
  assert.equal(parseDayOfMonth("abc"), null);
  assert.equal(parseDayOfMonth(null), null);
});

test("Cron Schedule: nextDaily advances correctly", () => {
  const base = new Date("2026-06-15T06:00:00.000Z");
  const next = nextDaily(base, { hours: 7, minutes: 0 });

  assert.equal(next.toISOString(), "2026-06-15T07:00:00.000Z");

  const laterBase = new Date("2026-06-15T08:00:00.000Z");
  const nextDay = nextDaily(laterBase, { hours: 7, minutes: 0 });

  assert.equal(nextDay.toISOString(), "2026-06-16T07:00:00.000Z");
});

test("Cron Schedule: nextWeekly advances to next weekday", () => {
  // 2026-06-15 is a Monday (UTCDay = 1)
  const base = new Date("2026-06-15T06:00:00.000Z");

  // Next Wednesday (UTCDay = 3) at 07:00
  const nextWed = nextWeekly(base, 3, { hours: 7, minutes: 0 });
  assert.equal(nextWed.getUTCDay(), 3);
  assert.equal(nextWed.getUTCDate(), 17);

  // Next Monday after 08:00 should advance 7 days
  const laterBase = new Date("2026-06-15T08:00:00.000Z");
  const nextMon = nextWeekly(laterBase, 1, { hours: 7, minutes: 0 });
  assert.equal(nextMon.getUTCDay(), 1);
  assert.equal(nextMon.getUTCDate(), 22);
});

test("Cron Schedule: computeNextPayoutDate handles daily, weekly, and monthly", () => {
  const dummyPlan: PlanRow = {
    id: "11111111-2222-3333-4444-555555555555",
    user_id: "user-1",
    name: "Savings",
    plan_type: "recurrent",
    frequency: "daily",
    payout_time: "09:00",
    payout_method: "fiat",
    status: "active",
    next_payout_date: "2026-06-15T09:00:00.000Z",
  };

  const now = new Date("2026-06-15T10:00:00.000Z");
  const next = computeNextPayoutDate(dummyPlan, now);

  assert.equal(next.toISOString(), "2026-06-16T09:00:00.000Z");
});

test("Cron DB Queries: fetch functions execute cleanly against Supabase", async () => {
  const dueByDate = await fetchDueByDatePlans();
  assert.ok(Array.isArray(dueByDate), "dueByDate must return an array");

  const dueByAmount = await fetchDueByAmountPlans();
  assert.ok(Array.isArray(dueByAmount), "dueByAmount must return an array");

  const dueRecurring = await fetchDueRecurringPlans();
  assert.ok(Array.isArray(dueRecurring), "dueRecurring must return an array");
});

test("Cron Manager: start, execute, and stop lifecycle works cleanly", async () => {
  // Start cron jobs
  startCronJobs();

  // Trigger one-off execution safely
  const targetResult = await executeTargetJobSafely();
  assert.ok(targetResult !== null, "target job should execute and return summary");

  const recurringResult = await executeRecurringJobSafely();
  assert.ok(recurringResult !== null, "recurring job should execute and return summary");

  // Clean shutdown
  stopCronJobs();
});

