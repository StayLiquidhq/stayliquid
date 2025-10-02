import { NextRequest, NextResponse } from "next/server";
import supabase from "../../../../utils/supabase";
import { sweepFunds } from "../../../../lib/sweep";
import { logTransaction } from "../../../../lib/transaction_history";
import { getTransactionStatus } from "../../../../lib/transaction_status";

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

        const signature: string | undefined = transaction.signature;
        if (!signature) continue;

        // Aggregate USDC transfers by destination address within this transaction
        const aggregation = new Map<string, { amount: number; from: string }>();
        if (Array.isArray(transaction.tokenTransfers)) {
          for (const t of transaction.tokenTransfers as TokenTransfer[]) {
            if (t.mint !== USDC_MINT) continue;
            if (!t.toUserAccount) continue;
            if (typeof t.tokenAmount !== "number" || t.tokenAmount <= 0)
              continue;
            const current = aggregation.get(t.toUserAccount);
            if (current) {
              current.amount += t.tokenAmount;
            } else {
              aggregation.set(t.toUserAccount, {
                amount: t.tokenAmount,
                from: t.fromUserAccount,
              });
            }
          }
        }

        // If no relevant USDC transfers found, skip without claiming idempotency
        if (aggregation.size === 0) {
          console.log(
            `No relevant USDC transfers found in tx ${signature}. Skipping without claiming.`
          );
          continue;
        }

        // Idempotency guard: check if transaction has already been processed
        const { data: existingTx, error: fetchError } = await supabase
          .from("processed_transactions")
          .select("signature")
          .eq("signature", signature)
          .single();

        if (fetchError && fetchError.code !== "PGRST116") {
          // PGRST116: row not found, which is what we want.
          console.error(
            `Error checking for processed transaction ${signature}:`,
            fetchError
          );
          continue;
        }

        if (existingTx) {
          console.log(
            `Transaction ${signature} already processed. Skipping.`
          );
          continue;
        }

        // Process each destination once with the aggregated amount
        let allSuccessful = true;
        for (const [toUserAccount, { amount, from }] of aggregation.entries()) {
          const success = await processIncomingTransfer(
            from,
            toUserAccount,
            amount,
            signature
          );
          if (!success) {
            allSuccessful = false;
            console.error(
              `Failed to process transfer for ${toUserAccount} in transaction ${signature}. Aborting processing for this transaction.`
            );
            break; // Stop processing other transfers in this transaction
          }
        }

        // If all transfers were processed successfully, mark the transaction as processed
        if (allSuccessful) {
          const { error: insertError } = await supabase
            .from("processed_transactions")
            .insert({ signature });
          if (insertError) {
            console.error(
              `Failed to mark transaction ${signature} as processed:`,
              insertError
            );
          }
        }
      }
    }

    return NextResponse.json({ success: true, message: "Webhook processed" });
  } catch (err) {
    console.error("Error processing webhook:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

async function processIncomingTransfer(
  fromAddress: string,
  toAddress: string,
  amount: number,
  signature: string
): Promise<boolean> {
  if (!toAddress) return false;

  try {
    let status = await getTransactionStatus(signature);
    console.log(`Initial status for ${signature}: ${status}`);
    let attempts = 0;
    const maxAttempts = 4;
    const delay = 10000; // 10 seconds

    while (status !== "finalized" && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      status = await getTransactionStatus(signature);
      console.log(`Rechecked status for ${signature}: ${status}`);
      attempts++;
    }

    if (status !== "finalized") {
      console.error(
        `Transaction ${signature} for ${toAddress} did not succeed. Status: ${status}`
      );
      return false;
    }

    // 1. Find the wallet in our database to get its ID, and current balance
    const { data: wallet, error: fetchError } = await supabase
      .from("wallets")
      .select("id, balance")
      .eq("address", toAddress)
      .single();

    if (fetchError || !wallet) {
      console.log(`Wallet not in DB, skipping sweep for: ${toAddress}`);
      return false; // Not an error, just no action needed.
    }

    // 2. Sweep the incoming amount to the dev wallet
    const { sweepAmount } = await sweepFunds(toAddress, amount);

    // 3. After a successful sweep, update the user's wallet balance in our DB atomically
    const { error: rpcError } = await supabase.rpc("increment_balance", {
      wallet_address: toAddress,
      amount_to_add: sweepAmount,
    });

    if (rpcError) {
      console.error(
        `Failed to update balance for wallet ${toAddress}:`,
        rpcError
      );
      return false;
    } else {
      console.log(
        `Successfully swept and updated balance for wallet ${toAddress}`
      );
      // Log the credit transaction after balance is successfully updated
      await logTransaction({
        wallet_id: wallet.id,
        type: "credit",
        amount: sweepAmount,
        currency: "USDC",
        description: `Received from ${fromAddress}`,
      });
      return true;
    }
  } catch (error) {
    console.error(`Error processing transfer for ${toAddress}:`, error);
    return false;
  }
}
