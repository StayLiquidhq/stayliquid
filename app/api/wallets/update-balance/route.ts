import { NextRequest, NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
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

        // Idempotency guard: attempt to claim ONLY transactions we will process
        // Requires a unique constraint on processed_transactions.signature to be fully effective
        const { error: claimError } = await supabase
          .from("processed_transactions")
          .insert({ signature });
        if (claimError) {
          // If unique violation (23505), another worker already claimed/processed it
          if ((claimError as any).code === "23505") {
            console.log(`Transaction ${signature} already claimed. Skipping.`);
            continue;
          }
          console.error(
            `Failed to claim transaction ${signature} for processing:`,
            claimError
          );
          continue;
        }

        // Process each destination once with the aggregated amount
        for (const [toUserAccount, { amount, from }] of aggregation.entries()) {
          await processIncomingTransfer(from, toUserAccount, amount, signature);
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
) {
  if (!toAddress) return;

  try {
    const connection = new Connection(
      `${process.env.HELIUS_URL}/?api-key=${process.env.HELIUS_API_KEY}`,
      "confirmed"
    );

    const { value: status } = await connection.getSignatureStatus(signature);

    if (status && status.confirmationStatus === "finalized") {
      console.log(`Transaction ${signature} already finalized.`);
    } else {
      const latestBlockHash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
        signature: signature,
      });
    }

    // 1. Find the wallet in our database to get its ID, and current balance
    const { data: wallet, error: fetchError } = await supabase
    .from("wallets")
    .select("id, balance")
    .eq("address", toAddress)
    .single();

  if (fetchError || !wallet) {
    console.log(`Wallet not in DB, skipping sweep for: ${toAddress}. Removing from processed transactions.`);
    await supabase
      .from("processed_transactions")
      .delete()
      .eq("signature", signature);
    return;
  }

  // 2. Sweep the incoming amount to the dev wallet
  const { sweepAmount } = await sweepFunds(
    toAddress,
    amount
  );

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
    throw new Error(
      `Failed to update balance for wallet ${toAddress}: ${rpcError.message}`
    );
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
    }
  } catch (error) {
    console.error(`Error processing transfer for ${toAddress}:`, error);
  }
}
