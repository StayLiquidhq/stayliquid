import { NextRequest, NextResponse } from "next/server";
import { sweepAllFunds } from "../../../../lib/sweep";
import { z } from "zod";
import supabase from "../../../../utils/supabase";
import { logTransaction } from "../../../../lib/transaction_history";

const sweepSchema = z.object({
  privy_id: z.string(),
  wallet_address: z.string(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = sweepSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.format() },
        { status: 400, headers: corsHeaders }
      );
    }

    const { privy_id, wallet_address } = validation.data;
    const { signature, sweepAmount } = await sweepAllFunds(
      privy_id,
      wallet_address
    );

    if (signature && sweepAmount > 0) {
      // Check if this sweep transaction has already been processed
      const { data: existingTx, error: txCheckError } = await supabase
        .from("processed_transactions")
        .select("signature")
        .eq("signature", signature)
        .single();

      if (txCheckError && txCheckError.code !== 'PGRST116') { // Ignore 'not found' error
        console.error(`Error checking for existing transaction ${signature}:`, txCheckError);
        return NextResponse.json({ error: "Internal server error", details: "Failed to check transaction history" }, { status: 500, headers: corsHeaders });
      }

      if (existingTx) {
        console.log(`Sweep transaction ${signature} has already been processed. Skipping balance update.`);
        return NextResponse.json({ signature, sweepAmount, message: "Sweep already processed" }, { headers: corsHeaders });
      }
      
      const { data: wallet, error: fetchError } = await supabase
        .from("wallets")
        .select("id")
        .eq("address", wallet_address)
        .single();

      if (fetchError || !wallet) {
        console.error(
          `Wallet not found for address ${wallet_address}, cannot update balance.`
        );
      } else {
        const { error: rpcError } = await supabase.rpc("increment_balance", {
          wallet_address: wallet_address,
          amount_to_add: sweepAmount,
        });

        if (rpcError) {
          console.error(
            `Failed to update balance for wallet ${wallet_address}:`,
            rpcError
          );
        } else {
          console.log(
            `Successfully swept and updated balance for wallet ${wallet_address}`
          );
          await logTransaction({
            wallet_id: wallet.id,
            type: "credit",
            amount: sweepAmount,
            currency: "USDC",
            description: `Wallet balance updated`,
          });

          // Mark the transaction as processed
          const { error: insertError } = await supabase
            .from("processed_transactions")
            .insert({ signature });

          if (insertError) {
            console.error(`Failed to mark transaction ${signature} as processed:`, insertError);
          }
        }
      }
    }

    return NextResponse.json({ signature, sweepAmount }, { headers: corsHeaders });
  } catch (err: any) {
    console.error("Error sweeping wallet:", err);
    return NextResponse.json(
      { error: "Internal server error", details: err.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
