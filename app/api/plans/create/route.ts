import { NextRequest, NextResponse } from "next/server";
import createSupabaseServerClient from "@/lib/supabase/serverClient";
import { z } from "zod";
import { createWallet } from "../../../../lib/CreateWallet";

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
  z.object({
    plan_type: z.literal("target"),
    target_type: z.enum(["amount", "date"]),
    target_amount: z.number().positive().optional(),
    target_date: z.string().optional(),
  }).refine(
    (d) => (d.target_type === "amount" ? d.target_amount != null : true),
    { message: "Target amount required", path: ["target_amount"] }
  ).refine(
    (d) => (d.target_type === "date" ? d.target_date != null : true),
    { message: "Target date required", path: ["target_date"] }
  ),
]);

const createPlanSchema = z.intersection(planSchema, payoutSchema);

// --- Endpoint ---
export async function POST(request: NextRequest) {
  const response = NextResponse.next();
  const supabase = createSupabaseServerClient(request, response);

  try {
    // 1. Authenticate user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Get internal user_id
    const { data: userData } = await supabase
      .from("users")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!userData) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const internalUserId = userData.id;

    // 3. Validate body
    const body = await request.json();
    const validation = createPlanSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error.format() }, { status: 400 });
    }
    const validatedData = validation.data;

    // 4. Insert plan
    const { data: newPlan, error: planError } = await supabase
      .from("plans")
      .insert({
        user_id: internalUserId,
        plan_type: validatedData.plan_type,
        details: validatedData,
      })
      .select()
      .single();

    if (planError) {
      return NextResponse.json({ error: "Failed to create plan" }, { status: 500 });
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
      return NextResponse.json({ error: "Plan created but wallet failed" }, { status: 500 });
    }

    // 7. Return response
    return NextResponse.json(
      { plan: newPlan, wallet: newWallet },
      { status: 201 }
    );

  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
