import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { z } from "zod";
import { createWallet } from "../../../../lib/CreateWallet";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}



// --- Zod Validation ---
const payoutSchema = z.union([
  z.object({
    payout_method: z.literal("fiat"),
    payout_account_number: z.string().min(1),
    bank_name: z.string().min(1),
    account_name: z.string().min(1),
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

const createPlanSchema = z.intersection(planSchema, payoutSchema);

// --- Endpoint ---
export async function POST(request: NextRequest) {
  try {
    // 1. Extract and validate the Bearer token from the header
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized: Missing or invalid Authorization header" },
        { status: 401, headers: corsHeaders }
      );
    }
    const token = authHeader.split(" ")[1];

    // 2. Verify the token and retrieve the authenticated user
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

    // 3. Validate body
    const body = await request.json();
    const validation = createPlanSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.format() },
        { status: 400, headers: corsHeaders }
      );
    }
    const validatedData = validation.data;

    // 4. Insert plan
    const { data: newPlan, error: planError } = await supabase
      .from("plans")
      .insert({
        user_id: user.id,
        ...validatedData,
      })
      .select()
      .single();

    if (planError) {
      return NextResponse.json(
        { error: "Failed to create plan" },
        { status: 500, headers: corsHeaders }
      );
    }

    // Check and update has_created_plan status
    const { data: userProfile, error: profileError } = await supabase
      .from("users")
      .select("has_created_plan")
      .eq("auth_user_id", user.id)
      .single();

    // Log profile fetch error but don't block
    if (profileError) {
      console.error("Error fetching user profile:", profileError.message);
    }

    if (userProfile && !userProfile.has_created_plan) {
      const { error: updateUserError } = await supabase
        .from("users")
        .update({ has_created_plan: true })
        .eq("auth_user_id", user.id);

      // Log update error but don't block
      if (updateUserError) {
        console.error(
          "Failed to update has_created_plan:",
          updateUserError.message
        );
      }
    }

    // 5. Create wallet via Privy
    const wallet = await createWallet();

    // 6. Save wallet in DB
    const { data: newWallet, error: walletError } = await supabase
      .from("wallets")
      .insert({
        plan_id: newPlan.id,
        privy_id: wallet.privyId,
        address: wallet.address,
        chain_type: "solana",
      })
      .select()
      .single();

    if (walletError) {
      return NextResponse.json(
        { error: "Plan created but wallet failed" },
        { status: 500, headers: corsHeaders }
      );
    }

    // 7. Return response
    return NextResponse.json(
      { plan: newPlan, wallet: newWallet },
      { status: 201, headers: corsHeaders }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
