import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { z } from "zod";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
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
  payout_wallet_address: z.string().min(1).optional(),
});

// --- Endpoint ---
export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }
    const token = authHeader.split(" ")[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    // 2. Validate body
    const body = await request.json();
    const validation = updatePlanSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error.format() }, { status: 400, headers: corsHeaders });
    }
    const { plan_id, ...updateData } = validation.data;

    console.log(`updating plan ${plan_id} for user ${user.id} with data:`, updateData);
    // 3. Update plan
    const { data: updatedPlan, error: planError } = await supabase
      .from("plans")
      .update(updateData)
      .eq("id", plan_id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (planError) {
      return NextResponse.json({ error: "Failed to update plan or plan not found" }, { status: 500, headers: corsHeaders });
    }

    // 4. Return response
    return NextResponse.json(updatedPlan, { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
