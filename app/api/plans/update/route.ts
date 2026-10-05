import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { z } from "zod";
import { handleCorsPreflight, validateOrigin } from "@/lib/cors";
import { Database } from "@/lib/supabase/types";
import { PLAN_COLUMNS } from "@/lib/selects";
import { logger } from "@/lib/logger";

type PlanUpdate = Database["public"]["Tables"]["plans"]["Update"];

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

const updatePlanSchema = z.object({
  plan_id: z.string().uuid(),
  plan_type: z.enum(["locked", "flexible", "target"]).optional(),
  received_amount: z.number().positive().optional(),
  recurrent_payout: z.number().positive().optional(),
  frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
  payout_time: z.string().min(1).optional(),
  target_type: z.enum(["amount", "date"]).optional(),
  target_amount: z.number().positive().optional(),
  target_date: z.string().optional(),
  payout_method: z.enum(["fiat", "crypto"]).optional(),
  payout_account_number: z.string().min(1).optional(),
  bank_name: z.string().min(1).optional(),
  account_name: z.string().min(1).optional(),
  bank_code: z.string().min(1).optional(),
  payout_wallet_address: z.string().min(1).optional(),
});

export async function POST(request: NextRequest) {
  const { isAllowed, headers: corsHeaders } = validateOrigin(request);

  if (!isAllowed) {
    return NextResponse.json(
      { error: "Origin not allowed" },
      { status: 403, headers: corsHeaders }
    );
  }

  try {
    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized" },
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
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json().catch(() => ({}));
    const validation = updatePlanSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.format() },
        { status: 400, headers: corsHeaders }
      );
    }

    const { plan_id, ...updateData } = validation.data;

    const updatePayload: PlanUpdate = {
      ...updateData,
    };

    if (updateData.frequency && updateData.payout_time) {
      const { frequency, payout_time } = updateData;
      const now = new Date();
      now.setSeconds(0, 0);

      switch (frequency.toLowerCase()) {
        case "daily": {
          const [hours, minutes] = payout_time.split(":").map(Number);
          now.setHours(hours, minutes);

          if (now < new Date()) {
            now.setDate(now.getDate() + 1);
          }

          break;
        }

        case "weekly": {
          const weekdays = [
            "sunday",
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
          ];

          const targetDay = weekdays.indexOf(payout_time.toLowerCase());
          const currentDay = now.getDay();
          let dayDifference = targetDay - currentDay;

          if (dayDifference < 0) {
            dayDifference += 7;
          }

          now.setDate(now.getDate() + dayDifference);
          break;
        }

        case "monthly": {
          const targetDate = parseInt(payout_time, 10);
          now.setDate(targetDate);

          if (now < new Date()) {
            now.setMonth(now.getMonth() + 1);
          }

          break;
        }
      }

      updatePayload.next_payout_date = now.toISOString();
    }

    if (updateData.payout_method === "fiat") {
      updatePayload.payout_wallet_address = null;
    } else if (updateData.payout_method === "crypto") {
      updatePayload.payout_account_number = null;
      updatePayload.bank_name = null;
      updatePayload.account_name = null;
      updatePayload.bank_code = null;
    }

    logger.info("Updating plan for user", {
      module: "plans/update",
      planId: plan_id,
      userId: user.id,
    });

    const { data: updatedPlan, error: planError } = await supabase
      .from("plans")
      .update(updatePayload)
      .eq("id", plan_id)
      .eq("user_id", user.id)
      .select(PLAN_COLUMNS)
      .single();

    if (planError) {
      logger.error("Failed to update plan in DB", { module: "plans/update", planId: plan_id }, planError);

      return NextResponse.json(
        { error: "Failed to update plan or plan not found" },
        { status: 500, headers: corsHeaders }
      );
    }

    return NextResponse.json(updatedPlan, {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    logger.error("Unexpected error in plans/update", { module: "plans/update" }, errorObj);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
