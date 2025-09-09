import { NextRequest, NextResponse } from "next/server";
import { sweepAllFunds } from "../../../../lib/sweep";
import { z } from "zod";
import supabase from "../../../../utils/supabase";
import { logTransaction } from "../../../../lib/transaction_history";

const sweepSchema = z.object({
  privy_id: z.string(),
  wallet_address: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = sweepSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.format() },
        { status: 400 }
      );
    }

    const { privy_id, wallet_address } = validation.data;
    const { signature, sweepAmount } = await sweepAllFunds(
      privy_id,
      wallet_address
    );

    if (signature && sweepAmount > 0) {
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
        }
      }
    }

    return NextResponse.json({ signature, sweepAmount });
  } catch (err: any) {
    console.error("Error sweeping wallet:", err);
    return NextResponse.json(
      { error: "Internal server error", details: err.message },
      { status: 500 }
    );
  }
}
