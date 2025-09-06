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

    // 3. Fetch plan and wallet details
    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select(`
        payout_wallet_address,
        wallets (id, balance)
      `)
      .eq("id", plan_id)
      .eq("user_id", user.id)
      .single();

    if (planError || !plan || !plan.wallets || !Array.isArray(plan.wallets) || plan.wallets.length === 0) {
      return NextResponse.json({ error: "Plan or wallet not found" }, { status: 404, headers: corsHeaders });
    }

    const wallet = plan.wallets[0];
    const { id: walletId, balance } = wallet;
    const recipientAddress = plan.payout_wallet_address;
    const totalAmount = Number(balance);

    if (!recipientAddress) {
      return NextResponse.json({ error: "Payout wallet address not set" }, { status: 400, headers: corsHeaders });
    }
    if (totalAmount <= 0) {
      return NextResponse.json({ error: "No balance to break" }, { status: 400, headers: corsHeaders });
    }

    // 4. Calculate fees and payout
    const feeAmount = totalAmount * 0.02;
    const payoutAmount = totalAmount - feeAmount;

    // 5. Environment variables and keypairs
    const payoutPrivateKey = process.env.PAYOUT_PRIVATE_KEY;
    if (!payoutPrivateKey) {
      return NextResponse.json({ error: "Payout wallet not configured" }, { status: 500, headers: corsHeaders });
    }

    const connection = new Connection(SOLANA_DEVNET);
    const payoutKeypair = Keypair.fromSecretKey(bs58.decode(payoutPrivateKey));
    const sender = payoutKeypair.publicKey;
    const recipient = new PublicKey(recipientAddress);

    // 6. Get associated token accounts
    const senderTokenAccount = await getAssociatedTokenAddress(USDC_DEVNET_MINT, sender);
    const recipientTokenAccount = await getAssociatedTokenAddress(USDC_DEVNET_MINT, recipient);

    // 7. Build the transaction
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

    // 8. Sign and send the transaction
    const signature = await connection.sendTransaction(tx, [payoutKeypair]);
    await connection.confirmTransaction(signature, "confirmed");

    // 9. Update wallet balance in the database
    const { error: updateError } = await supabase
      .from("wallets")
      .update({ balance: 0, balance_updated_at: new Date().toISOString() })
      .eq("id", walletId);

    if (updateError) {
      console.error("Failed to update wallet balance:", updateError);
    }

    return NextResponse.json({ success: true, signature }, { headers: corsHeaders });

  } catch (err: any) {
    if (err instanceof SendTransactionError) {
      const logs = await err.getLogs(new Connection(SOLANA_DEVNET));
      console.error("Transaction failed logs:", logs);
    }
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500, headers: corsHeaders });
  }
}
