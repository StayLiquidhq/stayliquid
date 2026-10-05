import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { z } from "zod";
import { createWallet } from "../../../../lib/CreateWallet";
import { updateWebhookWithNewAddress } from "../../../../lib/update_webhook";

import { handleCorsPreflight, validateOrigin } from "@/lib/cors";
import { withIdempotency } from "@/lib/idempotency";
import { recordAuditLog } from "@/lib/audit";
import { logger } from "@/lib/logger";

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

const payoutSchema = z.union([
  z.object({
    payout_method: z.literal("fiat"),
    payout_account_number: z.string().min(1),
    bank_name: z.string().min(1),
    account_name: z.string().min(1),
    bank_code: z.string().min(1),
  }),
  z.object({
    payout_method: z.literal("crypto"),
    payout_wallet_address: z.string().min(1),
  }),
]);

const planSchema = z.union([
  z.object({
    plan_type: z.enum(["locked", "flexible"]),
    received_amount: z.number().positive(),
    recurrent_payout: z.number().positive(),
    frequency: z.string().min(1),
    payout_time: z.string().min(1),
  }),
  z
    .object({
      plan_type: z.literal("target"),
      target_type: z.enum(["amount", "date"]),
      target_amount: z.number().positive().optional(),
      target_date: z.string().optional(),
    })
    .refine(
      (d) => (d.target_type === "amount" ? d.target_amount != null : true),
      { message: "Target amount required", path: ["target_amount"] }
    )
    .refine((d) => (d.target_type === "date" ? d.target_date != null : true), {
      message: "Target date required",
      path: ["target_date"],
    }),
]);

const createPlanSchema = z.intersection(planSchema, payoutSchema).and(
  z.object({
    name: z.string().min(1),
    chain: z.enum(["base", "solana"]).default("solana"),
    token: z.enum(["USDC", "USDT"]).default("USDC"),
  })
);

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

    const { count, error: countError } = await supabase
      .from("plans")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    if (countError) {
      return NextResponse.json(
        { error: "Failed to retrieve plan count" },
        { status: 500, headers: corsHeaders }
      );
    }

    if (count !== null && count >= 4) {
      return NextResponse.json(
        { error: "Plan limit reached. You can only create up to 4 plans." },
        { status: 403, headers: corsHeaders }
      );
    }

    const body = await request.json();
    const validation = createPlanSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.format() },
        { status: 400, headers: corsHeaders }
      );
    }

    const validatedData = validation.data;

    let next_payout_date = null;

    if ("frequency" in validatedData && "payout_time" in validatedData) {
      const { frequency, payout_time } = validatedData;
      const now = new Date();
      now.setSeconds(0, 0);

      switch (frequency.toLowerCase()) {
        case "daily":
          const [hours, minutes] = payout_time.split(":").map(Number);
          now.setHours(hours, minutes);

          if (now < new Date()) {
            now.setDate(now.getDate() + 1);
          }

          break;
        case "weekly":
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
        case "monthly":
          const targetDate = parseInt(payout_time, 10);
          now.setDate(targetDate);

          if (now < new Date()) {
            now.setMonth(now.getMonth() + 1);
          }

          break;
      }

      next_payout_date = now.toISOString();
    }

    return await withIdempotency(
      request,
      { scope: "plans/create", userId: user.id, payload: validatedData },
      async () => {
        const { chain = "solana", token = "USDC", ...planFields } = validatedData;

        const wallet = await createWallet({ chain });

        const { data, error: createError } = await supabase.rpc("create_plan_and_wallet", {
          p_user_id: user.id,
          p_plan: { ...planFields, chain, token, next_payout_date },
          p_wallet_address: wallet.address,
        });

        if (createError || !data) {
          logger.error(
            "Failed to persist plan and wallet",
            { module: "plans/create", userId: user.id },
            createError,
          );

          return NextResponse.json(
            { error: "Failed to create plan" },
            { status: 500, headers: corsHeaders }
          );
        }

        updateWebhookWithNewAddress(wallet.address);

        recordAuditLog({ userId: user.id, eventType: "plan_create", request });

        return NextResponse.json(
          { plan: data.plan, wallet: data.wallet },
          { status: 201, headers: corsHeaders }
        );
      }
    );
  } catch (err) {
    console.error("Unexpected error:", err);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
