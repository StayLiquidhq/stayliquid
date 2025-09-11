import { NextRequest, NextResponse } from "next/server";
import supabase from "../../../../utils/supabase";
import {
  Connection,
  PublicKey,
  Transaction,
  Keypair,
  SendTransactionError,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";
import { logTransaction } from "../../../../lib/transaction_history";

const SOLANA_DEVNET = `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
const USDC_DEVNET_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

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
    // 1. Authenticate the service request
    const authHeader = request.headers.get("authorization");
    const authToken = process.env.PAYOUT_AUTH_TOKEN;

    if (!authToken || authHeader !== `Bearer ${authToken}`) {
      console.error("Unauthorized access attempt to payout endpoint.");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    // 2. Get plan_id from the request body
    const { plan_id } = await request.json();
    if (!plan_id) {
      console.error("Payout endpoint called without a plan_id.");
      return NextResponse.json(
        { error: "Missing plan_id" },
        { status: 400, headers: corsHeaders }
      );
    }

    // 3. Fetch plan details
    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select(
        `
        payout_wallet_address,
        recurrent_payout,
        frequency,
        wallets (id, balance)
      `
      )
      .eq("id", plan_id)
      .single();

    if (
      planError ||
      !plan ||
      !plan.wallets ||
      !Array.isArray(plan.wallets) ||
      plan.wallets.length === 0
    ) {
      console.error(
        `Failed to fetch plan or wallet for plan_id: ${plan_id}. Error:`,
        planError?.message
      );
      return NextResponse.json(
        { error: "Plan or wallet not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    const wallet = plan.wallets[0];
    const recipientAddress = plan.payout_wallet_address;
    const payoutAmount = plan.recurrent_payout;

    if (!recipientAddress) {
      console.error(`Plan ${plan_id} is missing a payout_wallet_address.`);
      return NextResponse.json(
        { error: "Payout wallet address not set for this plan" },
        { status: 400, headers: corsHeaders }
      );
    }

    if (payoutAmount <= 0) {
      console.error(
        `Plan ${plan_id} has a recurrent_payout of ${payoutAmount}, which is not valid.`
      );
      return NextResponse.json(
        { error: "No recurrent payout amount set for this plan" },
        { status: 400, headers: corsHeaders }
      );
    }

    if (wallet.balance < payoutAmount) {
      console.error(
        `Plan ${plan_id} has insufficient balance. Wallet Balance: ${wallet.balance}, Payout Amount: ${payoutAmount}`
      );
      return NextResponse.json(
        { error: "Insufficient balance for payout" },
        { status: 400, headers: corsHeaders }
      );
    }

    // 4. Environment variables and keypairs for the transaction
    const payoutPrivateKey = process.env.PAYOUT_PRIVATE_KEY;
    if (!payoutPrivateKey) {
      console.error(
        "CRITICAL: PAYOUT_PRIVATE_KEY environment variable is not set."
      );
      return NextResponse.json(
        { error: "Payout wallet not configured on server" },
        { status: 500, headers: corsHeaders }
      );
    }

    const connection = new Connection(SOLANA_DEVNET);
    const payoutKeypair = Keypair.fromSecretKey(bs58.decode(payoutPrivateKey));
    const sender = payoutKeypair.publicKey;
    const recipient = new PublicKey(recipientAddress);

    // 5. Get associated token accounts and check dev wallet balance
    const senderTokenAccount = await getAssociatedTokenAddress(
      USDC_DEVNET_MINT,
      sender
    );
    const recipientTokenAccount = await getAssociatedTokenAddress(
      USDC_DEVNET_MINT,
      recipient
    );

    try {
      const senderTokenAccountInfo = await connection.getTokenAccountBalance(
        senderTokenAccount
      );
      const senderBalance = senderTokenAccountInfo.value.uiAmount;
      if (senderBalance === null || senderBalance < payoutAmount) {
        console.error(
          `Insufficient balance in dev payout wallet. Has: ${senderBalance}, Needs: ${payoutAmount}`
        );
        return NextResponse.json(
          {
            error:
              "Insufficient funds in the payout wallet to process this transaction.",
          },
          { status: 503, headers: corsHeaders }
        ); // 503 Service Unavailable is appropriate here
      }
    } catch (error) {
      // This can happen if the token account doesn't exist yet.
      console.error(
        "Could not fetch dev payout wallet balance. It may not have a USDC token account.",
        error
      );
      return NextResponse.json(
        { error: "Could not verify the payout wallet's balance." },
        { status: 500, headers: corsHeaders }
      );
    }

    // 6. Build the transaction
    const tx = new Transaction();
    const recipientInfo = await connection.getAccountInfo(
      recipientTokenAccount
    );
    if (!recipientInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          sender,
          recipientTokenAccount,
          recipient,
          USDC_DEVNET_MINT
        )
      );
    }
    tx.add(
      createTransferInstruction(
        senderTokenAccount,
        recipientTokenAccount,
        sender,
        payoutAmount * 10 ** 6 // Adjust for USDC decimals
      )
    );
    tx.feePayer = sender;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // 7. Sign and send the transaction
    const signature = await connection.sendTransaction(tx, [payoutKeypair]);
    await connection.confirmTransaction(signature, "confirmed");

    // Idempotency: claim this payout's signature upfront. Requires unique constraint on processed_transactions.signature
    const { error: claimError } = await supabase
      .from("processed_transactions")
      .insert({ signature });
    if (claimError) {
      if ((claimError as any).code === "23505") {
        console.log(
          `Payout transaction ${signature} already claimed. Skipping.`
        );
        return NextResponse.json(
          { success: true, signature, message: "Payout already processed" },
          { headers: corsHeaders }
        );
      }
      console.error(
        `Failed to claim payout transaction ${signature}:`,
        claimError
      );
      return NextResponse.json(
        {
          error: "Internal server error",
          details: "Failed to claim payout transaction",
        },
        { status: 500, headers: corsHeaders }
      );
    }

    // 8. Decrement wallet balance and update payout dates
    const newBalance = wallet.balance - payoutAmount;
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
        // If frequency is unknown, set next payout to null to stop recurrence
        next_payout_date = null;
        break;
    }

    // 9. Log the transaction
    try {
      await logTransaction({
        wallet_id: wallet.id,
        type: "debit",
        amount: payoutAmount,
        currency: "USDC",
        description: `Sent to ${recipientAddress}`,
        solana_signature: signature,
      });
    } catch (e) {
      console.error(
        `Failed to log payout transaction for wallet ${wallet.id}:`,
        e
      );
    }

    // 10. Atomically update wallet and plan using the database function
    const { error: rpcError } = await supabase.rpc("process_payout_update", {
      p_plan_id: plan_id,
      p_new_balance: newBalance,
      p_last_payout_date: now.toISOString(),
      p_next_payout_date: next_payout_date
        ? next_payout_date.toISOString()
        : null,
    });

    if (rpcError) {
      console.error(
        `CRITICAL: Transaction ${signature} succeeded but the atomic database update failed for plan ${plan_id}. Error: ${rpcError.message}`
      );
      // Release claim so it can be retried
      await supabase
        .from("processed_transactions")
        .delete()
        .eq("signature", signature);
      return NextResponse.json(
        { error: "Failed to update plan and wallet" },
        { status: 500, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      { success: true, signature },
      { headers: corsHeaders }
    );
  } catch (err) {
    if (err instanceof SendTransactionError) {
      const connection = new Connection(SOLANA_DEVNET);
      err.getLogs(connection).then((logs) => {
        console.error("Transaction failed logs:", logs);
      });
    }
    const errorMessage =
      err instanceof Error ? err.message : "An unknown error occurred";
    console.error(err);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500, headers: corsHeaders }
    );
  }
}
