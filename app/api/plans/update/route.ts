import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { z } from "zod";

// Strict CORS allowlist (aligned with other routes)
const ALLOWED_ORIGINS = new Set<string>([
  "https://liquid-frontend-gray.vercel.app",
  "https://liquid-frontend-aq6izit64-pleaseamsorry3-gmailcoms-projects.vercel.app",
  "https://savewithliquid.xyz",
]);

function createCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const headers = createCorsHeaders(origin);
  headers["Access-Control-Max-Age"] = "600";
  return new NextResponse(null, { status: 204, headers });
}

// --- Zod Validation ---
const updatePlanSchema = z.object({
  plan_id: z.string().uuid(),
  // Making all fields optional for update
  plan_type: z.enum(["locked", "flexible", "target"]).optional(),
  received_amount: z.number().positive().optional(),
  recurrent_payout: z.number().positive().optional(),
  frequency: z.string().min(1).optional(),
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

// --- Endpoint ---
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders = createCorsHeaders(origin);
  try {
    // Enforce allowlist only when Origin header is present (browser requests)
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return NextResponse.json(
        { error: "Origin not allowed" },
        { status: 403, headers: corsHeaders }
      );
    }
    // 1. Authenticate user
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

    // 2. Validate body
    const body = await request.json();
    const validation = updatePlanSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.format() },
        { status: 400, headers: corsHeaders }
      );
    }
    const { plan_id, ...updateData } = validation.data;

    // Recalculate next_payout_date if frequency or payout_time is updated
    if (updateData.frequency && updateData.payout_time) {
      const { frequency, payout_time } = updateData;
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
      (updateData as any).next_payout_date = now.toISOString();
    }

    // If payout_method is being updated, nullify the other method's fields
    if (updateData.payout_method === "fiat") {
      (updateData as any).payout_wallet_address = null;
    } else if (updateData.payout_method === "crypto") {
      (updateData as any).payout_account_number = null;
      (updateData as any).bank_name = null;
      (updateData as any).account_name = null;
      (updateData as any).bank_code = null;
    }

    console.log(
      `updating plan ${plan_id} for user ${user.id} with data:`,
      updateData
    );
    // 3. Update plan
    const { data: updatedPlan, error: planError } = await supabase
      .from("plans")
      .update(updateData)
      .eq("id", plan_id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (planError) {
      return NextResponse.json(
        { error: "Failed to update plan or plan not found" },
        { status: 500, headers: corsHeaders }
      );
    }

    // 4. Return response
    return NextResponse.json(updatedPlan, {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
