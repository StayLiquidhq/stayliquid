import { NextRequest, NextResponse } from "next/server";
import supabase from "../../../../utils/supabase";
import { logTransaction } from "../../../../lib/transaction_history";
import { sweepFunds } from "../../../../lib/sweep";
import { z } from "zod";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

const fiatPayoutSchema = z.object({
  plan_id: z.string().uuid(),
  wallet_id: z.string().uuid(),
  user_wallet_address: z.string().min(1),
  amount: z.number().positive(),
  fiat_transaction_id: z.string().min(1),
  description: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate the service request
    const authHeader = request.headers.get("authorization");
    const authToken = process.env.PAYOUT_AUTH_TOKEN;
    if (!authToken || authHeader !== `Bearer ${authToken}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    // 2. Validate body
    const body = await request.json();
    const validation = fiatPayoutSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error.format() }, { status: 400, headers: corsHeaders });
    }
    const { plan_id, wallet_id, user_wallet_address, amount, fiat_transaction_id, description } = validation.data;

    // 3. Sweep funds from the user's wallet
    try {
      await sweepFunds(user_wallet_address, amount);
    } catch (sweepError) {
      console.error(`Failed to sweep funds for plan ${plan_id}:`, sweepError);
      return NextResponse.json({ error: "Failed to sweep funds" }, { status: 500, headers: corsHeaders });
    }

    // 4. Log the fiat transaction
    const { error: logError } = await logTransaction({
      wallet_id,
      type: 'debit',
      amount,
      currency: 'NGN',
      description,
      fiat_transaction_id,
    });

    if (logError) {
      // Note: At this point, funds have been swept. This is a critical state.
      console.error(`CRITICAL: Funds swept but failed to log transaction for plan ${plan_id}.`);
      return NextResponse.json({ error: "Failed to log fiat transaction after sweeping funds" }, { status: 500, headers: corsHeaders });
    }

    // 5. Fetch the plan to determine how to update it
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('plan_type, frequency')
      .eq('id', plan_id)
      .single();

    if (planError) {
      console.error(`CRITICAL: Transaction logged but failed to fetch plan ${plan_id} for final update.`);
      return NextResponse.json({ error: "Failed to fetch plan details for final update" }, { status: 500, headers: corsHeaders });
    }

    // 6. Update the plan based on its type
    if (plan.plan_type === 'target') {
      const { error: updateError } = await supabase
        .from('plans')
        .update({ status: 'completed', last_payout_date: new Date().toISOString() })
        .eq('id', plan_id);

      if (updateError) {
        console.error(`CRITICAL: Failed to mark target plan ${plan_id} as completed.`);
        return NextResponse.json({ error: "Failed to mark target plan as completed" }, { status: 500, headers: corsHeaders });
      }
    } else {
      const now = new Date();
      let next_payout_date: Date | null = new Date(now);

      switch (plan.frequency.toLowerCase()) {
        case "daily":
          next_payout_date.setDate(next_payout_date.getDate() + 1);
          break;
        case "weekly":
          next_payout_date.setDate(next_payout_date.getDate() + 7);
          break;
        case "monthly":
          next_payout_date.setMonth(next_payout_date.getMonth() + 1);
          break;
        default:
          next_payout_date = null;
          break;
      }

      const { error: updateError } = await supabase
        .from('plans')
        .update({
          last_payout_date: now.toISOString(),
          next_payout_date: next_payout_date ? next_payout_date.toISOString() : null,
        })
        .eq('id', plan_id);

      if (updateError) {
        console.error(`CRITICAL: Failed to update next payout date for recurring plan ${plan_id}.`);
        return NextResponse.json({ error: "Failed to update recurring plan payout dates" }, { status: 500, headers: corsHeaders });
      }
    }

    return NextResponse.json({ success: true, message: "Fiat payout processed successfully." }, { headers: corsHeaders });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "An unknown error occurred";
    console.error(err);
    return NextResponse.json({ error: errorMessage }, { status: 500, headers: corsHeaders });
  }
}
