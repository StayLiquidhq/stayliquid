import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { 
  Connection, PublicKey, Transaction, Keypair, SendTransactionError 
} from "@solana/web3.js";
import bs58 from "bs58";
import { 
  getAssociatedTokenAddress, 
  createAssociatedTokenAccountInstruction, 
  createTransferInstruction 
} from "@solana/spl-token";
import { logTransaction } from "../../../../lib/transaction_history";

const SOLANA_DEVNET = "https://api.devnet.solana.com";
const USDC_DEVNET_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

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
    // 1. Authenticate the user
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }
    const token = authHeader.split(" ")[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    // 2. Get plan_id from the request body
    const { plan_id } = await request.json();
    if (!plan_id) {
      return NextResponse.json({ error: "Missing plan_id" }, { status: 400, headers: corsHeaders });
    }

    // 3. Fetch plan details to get the payout address and wallet ID
    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select(`
        payout_wallet_address,
        wallets (id)
      `)
      .eq("id", plan_id)
      .eq("user_id", user.id)
      .single();

    if (planError || !plan || !plan.wallets || !Array.isArray(plan.wallets) || plan.wallets.length === 0) {
      return NextResponse.json({ error: "Plan or wallet not found" }, { status: 404, headers: corsHeaders });
    }

    const walletId = plan.wallets[0].id;
    const recipientAddress = plan.payout_wallet_address;

    if (!recipientAddress) {
      return NextResponse.json({ error: "Payout wallet address not set" }, { status: 400, headers: corsHeaders });
    }

    // 4. Atomically fetch and reset the user's balance
    const { data: totalAmount, error: rpcError } = await supabase.rpc(
      "reset_wallet_balance",
      { p_wallet_id: walletId }
    );

    if (rpcError || totalAmount === null) {
      return NextResponse.json({ error: "Failed to fetch or reset balance" }, { status: 500, headers: corsHeaders });
    }
    
    if (totalAmount <= 0) {
      return NextResponse.json({ error: "No balance to break" }, { status: 400, headers: corsHeaders });
    }

    // 5. Calculate fees and payout
    const feeAmount = totalAmount * 0.02;
    const payoutAmount = totalAmount - feeAmount;

    // 6. Environment variables and keypairs
    const payoutPrivateKey = process.env.PAYOUT_PRIVATE_KEY;
    if (!payoutPrivateKey) {
      return NextResponse.json({ error: "Payout wallet not configured" }, { status: 500, headers: corsHeaders });
    }

    const connection = new Connection(SOLANA_DEVNET);
    const payoutKeypair = Keypair.fromSecretKey(bs58.decode(payoutPrivateKey));
    const sender = payoutKeypair.publicKey;
    const recipient = new PublicKey(recipientAddress);

    // 7. Get associated token accounts
    const senderTokenAccount = await getAssociatedTokenAddress(USDC_DEVNET_MINT, sender);
    const recipientTokenAccount = await getAssociatedTokenAddress(USDC_DEVNET_MINT, recipient);

    // 8. Build the transaction
    const tx = new Transaction();
    const recipientInfo = await connection.getAccountInfo(recipientTokenAccount);
    if (!recipientInfo) {
      tx.add(createAssociatedTokenAccountInstruction(sender, recipientTokenAccount, recipient, USDC_DEVNET_MINT));
    }
    tx.add(
      createTransferInstruction(
        senderTokenAccount,
        recipientTokenAccount,
        sender,
        payoutAmount * 10 ** 6
      )
    );
    tx.feePayer = sender;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // 9. Sign and send the transaction
    const signature = await connection.sendTransaction(tx, [payoutKeypair]);
    await connection.confirmTransaction(signature, "confirmed");

    // Check if this break transaction has already been processed
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
      console.log(`Break transaction ${signature} has already been processed. Skipping database update.`);
      return NextResponse.json({ success: true, signature, message: "Break already processed" }, { headers: corsHeaders });
    }

    // 10. Log the transactions
    await logTransaction({
      wallet_id: walletId,
      type: 'debit',
      amount: payoutAmount,
      currency: 'USDC',
      description: `Plan broken. Payout to ${recipientAddress}`,
      solana_signature: signature,
    });

    await logTransaction({
        wallet_id: walletId,
        type: 'debit',
        amount: feeAmount,
        currency: 'USDC',
        description: 'Plan breakage fee',
        solana_signature: signature,
    });

    // Mark the transaction as processed
    const { error: insertError } = await supabase
      .from("processed_transactions")
      .insert({ signature });

    if (insertError) {
      console.error(`Failed to mark transaction ${signature} as processed:`, insertError);
    }

    return NextResponse.json({ success: true, signature }, { headers: corsHeaders });

  } catch (err) {
    if (err instanceof SendTransactionError) {
      const connection = new Connection(SOLANA_DEVNET);
      err.getLogs(connection).then(logs => {
        console.error("Transaction failed logs:", logs);
      });
    }
    const errorMessage = err instanceof Error ? err.message : "An unknown error occurred";
    console.error(err);
    return NextResponse.json({ error: errorMessage }, { status: 500, headers: corsHeaders });
  }
}
