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

const SOLANA_DEVNET = "https://api.devnet.solana.com";
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
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }

    // 2. Get plan_id from the request body
    const { plan_id } = await request.json();
    if (!plan_id) {
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
        wallets (id)
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
      return NextResponse.json(
        { error: "Plan or wallet not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    const walletId = plan.wallets[0].id;
    const recipientAddress = plan.payout_wallet_address;

    if (!recipientAddress) {
      return NextResponse.json(
        { error: "Payout wallet address not set" },
        { status: 400, headers: corsHeaders }
      );
    }

    // 4. Atomically fetch and reset the user's balance
    const { data: totalAmount, error: rpcError } = await supabase.rpc(
      "reset_wallet_balance",
      { p_wallet_id: walletId }
    );

    if (rpcError || totalAmount === null) {
      return NextResponse.json(
        { error: "Failed to fetch or reset balance" },
        { status: 500, headers: corsHeaders }
      );
    }

    if (totalAmount <= 0) {
      return NextResponse.json(
        { error: "No balance to pay out" },
        { status: 400, headers: corsHeaders }
      );
    }

    // 5. Environment variables and keypairs
    const payoutPrivateKey = process.env.PAYOUT_PRIVATE_KEY;
    if (!payoutPrivateKey) {
      return NextResponse.json(
        { error: "Payout wallet not configured" },
        { status: 500, headers: corsHeaders }
      );
    }

    const connection = new Connection(SOLANA_DEVNET);
    const payoutKeypair = Keypair.fromSecretKey(bs58.decode(payoutPrivateKey));
    const sender = payoutKeypair.publicKey;
    const recipient = new PublicKey(recipientAddress);

    // 6. Get associated token accounts and check dev wallet balance
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
      if (senderBalance === null || senderBalance < totalAmount) {
        return NextResponse.json(
          { error: "Insufficient funds in the payout wallet." },
          { status: 503 }
        );
      }
    } catch (error) {
      return NextResponse.json(
        { error: "Could not verify the payout wallet's balance." },
        { status: 500 }
      );
    }

    // 7. Build the transaction
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
        totalAmount * 10 ** 6
      )
    );
    tx.feePayer = sender;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // 8. Sign and send the transaction
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

    // 9. Log the final payout transaction
    try {
      await logTransaction({
        wallet_id: walletId,
        type: "debit",
        amount: totalAmount,
        currency: "USDC",
        description: `Target plan payout to ${recipientAddress}`,
        solana_signature: signature,
      });
    } catch (e) {
      console.error(
        `Failed to log payout transaction for wallet ${walletId}:`,
        e
      );
    }

    // 10. Mark the plan as completed
    const { error: updateError } = await supabase
      .from("plans")
      .update({ status: "completed" })
      .eq("id", plan_id);
    if (updateError) {
      console.error(
        `Failed to update plan ${plan_id} as completed after transaction ${signature}:`,
        updateError
      );
      // Release claim so it can be retried
      await supabase
        .from("processed_transactions")
        .delete()
        .eq("signature", signature);
      return NextResponse.json(
        { error: "Failed to mark plan as completed" },
        { status: 500, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      { success: true, signature },
      { headers: corsHeaders }
    );
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "An unknown error occurred";
    console.error(err);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500, headers: corsHeaders }
    );
  }
}
