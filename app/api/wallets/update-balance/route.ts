import { NextRequest, NextResponse } from "next/server";
import supabase from "../../../../utils/supabase";
import { sweepFunds } from "../../../../lib/sweep";
import { logTransaction } from "../../../../lib/transaction_history";

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

    // 2. Sweep the incoming amount to the dev wallet with a retry mechanism
    let sweepAmount;
    let attempts = 0;
    const maxAttempts = 2;
    const delay = 20000; // 20 seconds

    while (attempts < maxAttempts) {
      try {
        const result = await sweepFunds(wallet.privy_id, toAddress, amount);
        sweepAmount = result.sweepAmount;
        break; // Success, exit the loop
      } catch (error: any) {
        attempts++;
        if (error.message.includes("insufficient funds") && attempts < maxAttempts) {
          console.log(`Attempt ${attempts} failed for ${toAddress}: insufficient funds. Retrying in ${delay / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw error; // Re-throw other errors or if max attempts are reached
        }
      }
    }

    if (sweepAmount === undefined) {
      console.error(`All sweep attempts failed for wallet ${toAddress}.`);
      return;
    }

    // 3. After a successful sweep, update the user's wallet balance in our DB atomically
    const { error: rpcError } = await supabase.rpc("increment_balance", {
      wallet_address: toAddress,
      amount_to_add: sweepAmount,
    });

    if (rpcError) {
      console.error(`Failed to update balance for wallet ${toAddress}:`, rpcError);
    } else {
      console.log(`Successfully swept and updated balance for wallet ${toAddress}`);
      // Log the credit transaction after balance is successfully updated
      await logTransaction({
        wallet_id: wallet.id,
        type: 'credit',
        amount: sweepAmount,
        currency: 'USDC',
        description: `Received from ${fromAddress}`,
      });
    }
  } catch (error) {
    console.error(`Error processing transfer for ${toAddress}:`, error);
  }
}
