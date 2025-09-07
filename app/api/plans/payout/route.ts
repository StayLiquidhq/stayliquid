import { NextRequest, NextResponse } from "next/server";
import supabase from "../../../../utils/supabase";
import { 
  Connection, PublicKey, Transaction, Keypair, SendTransactionError 
} from "@solana/web3.js";
import bs58 from "bs58";
import { 
  getAssociatedTokenAddress, 
  createAssociatedTokenAccountInstruction, 
  createTransferInstruction 
} from "@solana/spl-token";

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
    // 1. Authenticate the service request
    const authHeader = request.headers.get("authorization");
    const authToken = process.env.PAYOUT_AUTH_TOKEN;

    // Detailed logging for debugging authorization
    console.log("Received Authorization Header:", authHeader);
    console.log("Expected Auth Token Snippet:", `Bearer ${authToken ? authToken.substring(0, 5) + '...' : 'NOT SET'}`);

    if (!authToken || authHeader !== `Bearer ${authToken}`) {
      console.error("Authorization failed. Header received does not match expected token.");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    // 2. Get plan_id from the request body
    const { plan_id } = await request.json();
    if (!plan_id) {
      return NextResponse.json({ error: "Missing plan_id" }, { status: 400, headers: corsHeaders });
    }

    // 3. Fetch plan details
    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select(`
        payout_wallet_address,
        recurrent_payout,
        frequency,
        wallets (id, balance)
      `)
      .eq("id", plan_id)
      .single();

    if (planError || !plan || !plan.wallets || !Array.isArray(plan.wallets) || plan.wallets.length === 0) {
      return NextResponse.json({ error: "Plan or wallet not found" }, { status: 404, headers: corsHeaders });
    }

    const wallet = plan.wallets[0];
    const recipientAddress = plan.payout_wallet_address;
    const payoutAmount = plan.recurrent_payout;

    if (!recipientAddress) {
      return NextResponse.json({ error: "Payout wallet address not set for this plan" }, { status: 400, headers: corsHeaders });
    }
    
    if (payoutAmount <= 0) {
        return NextResponse.json({ error: "No recurrent payout amount set for this plan" }, { status: 400, headers: corsHeaders });
    }

    if (wallet.balance < payoutAmount) {
      return NextResponse.json({ error: "Insufficient balance for payout" }, { status: 400, headers: corsHeaders });
    }

    // 4. Environment variables and keypairs for the transaction
    const payoutPrivateKey = process.env.PAYOUT_PRIVATE_KEY;
    if (!payoutPrivateKey) {
      return NextResponse.json({ error: "Payout wallet not configured on server" }, { status: 500, headers: corsHeaders });
    }

    const connection = new Connection(SOLANA_DEVNET);
    const payoutKeypair = Keypair.fromSecretKey(bs58.decode(payoutPrivateKey));
    const sender = payoutKeypair.publicKey;
    const recipient = new PublicKey(recipientAddress);

    // 5. Get associated token accounts
    const senderTokenAccount = await getAssociatedTokenAddress(USDC_DEVNET_MINT, sender);
    const recipientTokenAccount = await getAssociatedTokenAddress(USDC_DEVNET_MINT, recipient);

    // 6. Build the transaction
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
        payoutAmount * 10 ** 6 // Adjust for USDC decimals
      )
    );
    tx.feePayer = sender;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // 7. Sign and send the transaction
    const signature = await connection.sendTransaction(tx, [payoutKeypair]);
    await connection.confirmTransaction(signature, "confirmed");

    // 8. Decrement wallet balance and update payout dates
    const newBalance = wallet.balance - payoutAmount;
    const now = new Date();
    let next_payout_date: Date | null = new Date(now);

    switch (plan.frequency.toLowerCase()) {
        case 'daily':
            next_payout_date.setDate(next_payout_date.getDate() + 1);
            break;
        case 'weekly':
            next_payout_date.setDate(next_payout_date.getDate() + 7);
            break;
        case 'monthly':
            next_payout_date.setMonth(next_payout_date.getMonth() + 1);
            break;
        default:
            // If frequency is unknown, set next payout to null to stop recurrence
            next_payout_date = null; 
            break;
    }

    // Update wallet and plan in a single transaction if possible, or separately.
    const { error: walletUpdateError } = await supabase
      .from("wallets")
      .update({ balance: newBalance })
      .eq("id", wallet.id);

    if (walletUpdateError) {
        console.error(`CRITICAL: Transaction ${signature} succeeded but failed to update wallet balance for plan ${plan_id}. Error: ${walletUpdateError.message}`);
    }

    const { error: planUpdateError } = await supabase
        .from("plans")
        .update({ 
            last_payout_date: now.toISOString(),
            next_payout_date: next_payout_date ? next_payout_date.toISOString() : null
        })
        .eq("id", plan_id);

    if (planUpdateError) {
        console.error(`CRITICAL: Failed to update next payout date for plan ${plan_id}. Error: ${planUpdateError.message}`);
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
