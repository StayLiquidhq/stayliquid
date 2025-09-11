import { NextRequest, NextResponse } from "next/server";
import { sweepFunds } from "../../../../lib/sweep";
import { z } from "zod";
import supabase from "../../../../utils/supabase";
import { logTransaction } from "../../../../lib/transaction_history";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";

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

const SOLANA_DEVNET = "https://api.devnet.solana.com";
const USDC_DEVNET_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

async function checkUsdcBalance(userWalletAddress: string) {
  const connection = new Connection(SOLANA_DEVNET);
  const userPublicKey = new PublicKey(userWalletAddress);

  try {
    const userTokenAccount = await getAssociatedTokenAddress(
      USDC_DEVNET_MINT,
      userPublicKey
    );
    const tokenBalance = await connection.getTokenAccountBalance(
      userTokenAccount
    );

    if (!tokenBalance.value.uiAmount) {
      return 0;
    }

    return tokenBalance.value.uiAmount;
  } catch (error) {
    return 0;
  }
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

    const balance = await checkUsdcBalance(wallet_address);

    if (balance === 0) {
      return NextResponse.json(
        { signature: null, sweepAmount: 0, message: "No balance to sweep" },
        { headers: corsHeaders }
      );
    }

    const { signature, sweepAmount } = await sweepFunds(
      privy_id,
      wallet_address,
      balance
    );

    if (signature && sweepAmount > 0) {
      const { error: claimError } = await supabase
        .from("processed_transactions")
        .insert({ signature });
      if (claimError) {
        if ((claimError as any).code === "23505") {
          console.log(
            `Sweep transaction ${signature} already claimed. Skipping.`
          );
          return NextResponse.json(
            { signature, sweepAmount, message: "Sweep already processed" },
            { headers: corsHeaders }
          );
        }
        console.error(
          `Failed to claim sweep transaction ${signature}:`,
          claimError
        );
        return NextResponse.json(
          {
            error: "Internal server error",
            details: "Failed to claim sweep transaction",
          },
          { status: 500, headers: corsHeaders }
        );
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
        await supabase
          .from("processed_transactions")
          .delete()
          .eq("signature", signature);
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
          await supabase
            .from("processed_transactions")
            .delete()
            .eq("signature", signature);
          return NextResponse.json(
            { error: "Failed to update balance" },
            { status: 500, headers: corsHeaders }
          );
        } else {
          console.log(
            `Successfully swept and updated balance for wallet ${wallet_address}`
          );
          try {
            await logTransaction({
              wallet_id: wallet.id,
              type: "credit",
              amount: sweepAmount,
              currency: "USDC",
              description: `Wallet balance updated`,
            });
          } catch (e) {
            console.error(
              `Failed to log transaction for ${wallet_address}:`,
              e
            );
          }
        }
      }
    }

    return NextResponse.json(
      { signature, sweepAmount },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    console.error("Error sweeping wallet:", err);
    return NextResponse.json(
      { error: "Internal server error", details: err.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
