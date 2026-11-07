import supabase from "@/utils/supabase";
import { logger } from "@/lib/logger";
import type { PlanRow, TimeOfDay } from "./types";

export const DEFAULT_TIME_OF_DAY: TimeOfDay = { hours: 7, minutes: 0 };

const WEEKDAY_NAME_TO_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
} as const;

type WeekdayName = keyof typeof WEEKDAY_NAME_TO_INDEX;

function isWeekdayName(value: string): value is WeekdayName {
  return value in WEEKDAY_NAME_TO_INDEX;
}

export function parseTimeOfDay(timeStr?: string | null): TimeOfDay | null {
  if (!timeStr) return null;

  const match = timeStr.match(/^\s*(\d{1,2}):(\d{2})\s*$/);

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return { hours, minutes };
}

export function parseWeekday(weekdayStr?: string | null): number | null {
  if (!weekdayStr) return null;

  const key = weekdayStr.trim().toLowerCase();

  if (!isWeekdayName(key)) return null;

  return WEEKDAY_NAME_TO_INDEX[key];
}

export function parseDayOfMonth(value?: string | number | null): number | null {
  if (value == null) return null;

  const n = Number(String(value).trim());

  if (!Number.isInteger(n)) return null;

  if (n < 1 || n > 31) return null;

  return n;
}

function withTime(date: Date, hours: number, minutes: number): Date {
  const d = new Date(date.getTime());
  d.setUTCHours(hours, minutes, 0, 0);

  return d;
}

export function clampToMonthDay(year: number, monthIndex: number, day: number): number {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

  return Math.min(day, lastDay);
}

export function nextDaily(base: Date, timeOfDay: TimeOfDay): Date {
  const { hours, minutes } = timeOfDay;
  const candidate = withTime(base, hours, minutes);

  if (candidate <= base) {
    const next = new Date(candidate.getTime());
    next.setUTCDate(next.getUTCDate() + 1);

    return next;
  }

  return candidate;
}

export function nextWeekly(base: Date, weekdayIndex: number, timeOfDay: TimeOfDay): Date {
  const { hours, minutes } = timeOfDay;
  const candidate = withTime(base, hours, minutes);
  const baseWeekday = candidate.getUTCDay();

  let delta = (weekdayIndex - baseWeekday + 7) % 7;

  if (delta === 0 && candidate <= base) {
    delta = 7;
  }

  const next = new Date(candidate.getTime());
  next.setUTCDate(next.getUTCDate() + delta);

  return next;
}

export function nextMonthly(base: Date, dayOfMonth: number, timeOfDay: TimeOfDay): Date {
  const { hours, minutes } = timeOfDay;
  const baseUTC = new Date(base.getTime());
  const year = baseUTC.getUTCFullYear();
  const month = baseUTC.getUTCMonth();

  const dayThisMonth = clampToMonthDay(year, month, dayOfMonth);
  const candidate = new Date(Date.UTC(year, month, dayThisMonth, hours, minutes, 0, 0));

  if (candidate <= base) {
    const nextMonth = (month + 1) % 12;
    const nextYear = month === 11 ? year + 1 : year;
    const dayNextMonth = clampToMonthDay(nextYear, nextMonth, dayOfMonth);

    return new Date(Date.UTC(nextYear, nextMonth, dayNextMonth, hours, minutes, 0, 0));
  }

  return candidate;
}

function getTimeOfDayForPlan(plan: PlanRow, fallbackDate?: Date): TimeOfDay {
  const parsed = parseTimeOfDay(plan.payout_time);

  if (parsed) return parsed;

  if (fallbackDate) {
    return {
      hours: fallbackDate.getUTCHours(),
      minutes: fallbackDate.getUTCMinutes(),
    };
  }

  return DEFAULT_TIME_OF_DAY;
}

function getWeekdayForPlan(plan: PlanRow, fallbackDate?: Date): number {
  const parsed = parseWeekday(plan.payout_time);

  if (Number.isFinite(parsed) && parsed !== null) return parsed;

  if (fallbackDate) return fallbackDate.getUTCDay();

  return new Date().getUTCDay();
}

function getDayOfMonthForPlan(plan: PlanRow, fallbackDate?: Date): number {
  const parsedFromPayoutTime = parseDayOfMonth(plan.payout_time);

  if (parsedFromPayoutTime) return parsedFromPayoutTime;

  if (plan.target_date) {
    const t = new Date(plan.target_date);

    if (!Number.isNaN(t.getTime())) return t.getUTCDate();
  }

  if (fallbackDate) return fallbackDate.getUTCDate();

  return new Date().getUTCDate();
}

export function computeNextPayoutDate(plan: PlanRow, nowDate?: Date): Date {
  const now = nowDate ?? new Date();
  const lastScheduled = plan.next_payout_date ? new Date(plan.next_payout_date) : now;
  const base = now > lastScheduled ? now : lastScheduled;
  const frequency = (plan.frequency ?? "").toLowerCase();

  const timeOfDay = getTimeOfDayForPlan(plan, lastScheduled);

  if (frequency === "daily") {
    return nextDaily(base, timeOfDay);
  }

  if (frequency === "weekly") {
    const weekday = getWeekdayForPlan(plan, lastScheduled);

    return nextWeekly(base, weekday, timeOfDay);
  }

  if (frequency === "monthly") {
    const dayOfMonth = getDayOfMonthForPlan(plan, lastScheduled);

    return nextMonthly(base, dayOfMonth, timeOfDay);
  }

  return nextDaily(base, timeOfDay);
}

export async function advancePlanSchedule(plan: PlanRow): Promise<boolean> {
  const processedAt = new Date();
  const originalNext = plan.next_payout_date;

  let nextDate: Date;

  try {
    nextDate = computeNextPayoutDate(plan, processedAt);
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    logger.error("Failed to compute next payout date for plan", { module: "cron/schedule", planId: plan.id }, errorObj);

    return false;
  }

  const updatePayload = {
    last_payout_date: processedAt.toISOString(),
    next_payout_date: nextDate.toISOString(),
  };

  const { data, error } = await supabase
    .from("plans")
    .update(updatePayload)
    .eq("id", plan.id)
    .eq("next_payout_date", originalNext ?? "")
    .select("id");

  if (error) {
    logger.error("Error updating schedule for plan", { module: "cron/schedule", planId: plan.id }, error);

    return false;
  }

  if (!data || data.length === 0) {
    logger.warn("Schedule not advanced; concurrent update detected", {
      module: "cron/schedule",
      planId: plan.id,
    });

    return false;
  }

  logger.info("Advanced plan schedule", {
    module: "cron/schedule",
    planId: plan.id,
    nextPayoutDate: updatePayload.next_payout_date,
  });

  return true;
}
