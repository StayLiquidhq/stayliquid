import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { sweepFunds } from "@/lib/sweep";

// Using Devnet USDC mint for this example. Change to mainnet if needed.
const USDC_MINT = process.env.USDC_MINT; // Mainnet USDC mint

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    console.log("Received webhook payload:", JSON.stringify(payload, null, 2));

    if (Array.isArray(payload)) {
      for (const transaction of payload) {
        if (transaction.transactionError !== null) continue;

        if (Array.isArray(transaction.tokenTransfers)) {
          const usdcTransfers = transaction.tokenTransfers.filter(
            (t: any) => t.mint === USDC_MINT
          );

          for (const transfer of usdcTransfers) {
            const { toUserAccount, tokenAmount } = transfer;
            // We only care about funds coming *into* our users' wallets
            await processIncomingTransfer(toUserAccount, tokenAmount);
          }
        }
      }
    }

    return NextResponse.json({ success: true, message: "Webhook processed" });

  } catch (err: any) {
    console.error("Error processing webhook:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function processIncomingTransfer(walletAddress: string, amount: number) {
  if (!walletAddress) return;

  try {
    // 1. Find the wallet in our database to get its privy_id and current balance
    const { data: wallet, error: fetchError } = await supabase
      .from("wallets")
      .select("privy_id, balance")
      .eq("address", walletAddress)
      .single();

    if (fetchError || !wallet) {
      console.log(`Wallet not in DB, skipping sweep for: ${walletAddress}`);
      return;
    }

    // 2. Sweep the incoming amount to the dev wallet
    await sweepFunds(wallet.privy_id, walletAddress, amount);

    // 3. After a successful sweep, update the user's wallet balance in our DB atomically
    const { error: rpcError } = await supabase.rpc("increment_balance", {
      wallet_address: walletAddress,
      amount_to_add: amount,
    });

    if (rpcError) {
      console.error(`Failed to update balance for wallet ${walletAddress}:`, rpcError);
    } else {
      console.log(`Successfully swept and updated balance for wallet ${walletAddress}`);
    }
  } catch (error) {
    console.error(`Error processing transfer for ${walletAddress}:`, error);
  }
}
