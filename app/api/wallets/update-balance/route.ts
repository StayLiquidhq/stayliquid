import { NextRequest, NextResponse } from "next/server";
import supabase from "../../../../utils/supabase";
import { sweepFunds } from "../../../../lib/sweep";

interface TokenTransfer {
  fromUserAccount: string;
  mint: string;
  toUserAccount: string;
  tokenAmount: number;
}

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
            (t: TokenTransfer) => t.mint === USDC_MINT
          );

          for (const transfer of usdcTransfers) {
            const { fromUserAccount, toUserAccount, tokenAmount } = transfer;
            // We only care about funds coming *into* our users' wallets
            await processIncomingTransfer(fromUserAccount, toUserAccount, tokenAmount);
          }
        }
      }
    }

    return NextResponse.json({ success: true, message: "Webhook processed" });

  } catch (err) {
    console.error("Error processing webhook:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function processIncomingTransfer(fromAddress: string, toAddress: string, amount: number) {
  if (!toAddress) return;

  try {
    // 1. Find the wallet in our database to get its ID, privy_id, and current balance
    const { data: wallet, error: fetchError } = await supabase
      .from("wallets")
      .select("id, privy_id, balance")
      .eq("address", toAddress)
      .single();

    if (fetchError || !wallet) {
      console.log(`Wallet not in DB, skipping sweep for: ${toAddress}`);
      return;
    }

    console.log(`Processing incoming transfer of ${amount} USDC to wallet ${toAddress}`);
    // 2. Sweep the incoming amount to the dev wallet
    await sweepFunds(wallet.privy_id, toAddress);

    // 3. After a successful sweep, update the user's wallet balance and log the transaction atomically
    const { error: rpcError } = await supabase.rpc("credit_wallet", {
      wallet_address: toAddress,
      amount_to_add: amount,
      from_address: fromAddress,
    });

    if (rpcError) {
      console.error(`Failed to update balance and log transaction for wallet ${toAddress}:`, rpcError);
    } else {
      console.log(`Successfully swept, updated balance, and logged transaction for wallet ${toAddress}`);
    }
  } catch (error) {
    console.error(`Error processing transfer for ${toAddress}:`, error);
  }
}
