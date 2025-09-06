import { NextRequest, NextResponse } from "next/server";
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
    const { amount } = await request.json();

    const userPrivyId = "j21do8fnsegg0i5cl5b92dff";
    const userWalletAddress = "FLd6tC1DVS45M6pSfShiDwaE6dtg8omwMKdmm8e3VS5W";
    const recipientAddress = "4BKvqCZUc9nbp59RVEPW6bTdyf2sVwW5699o9GNaaTHg";
    const devPrivateKey = process.env.DEV_WALLET_PRIVATE_KEY;
    const privyAppId = process.env.PRIVY_APP_ID;
    const privyAppSecret = process.env.PRIVY_APP_SECRET;

    if (!devPrivateKey || !amount || !privyAppId || !privyAppSecret) {
      return NextResponse.json({ error: "Missing config" }, { status: 400, headers: corsHeaders });
    }

    const connection = new Connection(SOLANA_DEVNET);
    const devKeypair = Keypair.fromSecretKey(bs58.decode(devPrivateKey));

    const sender = new PublicKey(userWalletAddress);
    const recipient = new PublicKey(recipientAddress);

    // Get sender & recipient token accounts
    const senderTokenAccount = await getAssociatedTokenAddress(USDC_DEVNET_MINT, sender);
    const recipientTokenAccount = await getAssociatedTokenAddress(USDC_DEVNET_MINT, recipient);

    // Build transaction
    const tx = new Transaction();

    // ✅ Check if recipient's token account exists
    const recipientInfo = await connection.getAccountInfo(recipientTokenAccount);
    if (!recipientInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          devKeypair.publicKey,  // payer
          recipientTokenAccount, // ata
          recipient,             // owner
          USDC_DEVNET_MINT        // token mint
        )
      );
    }

    // Add transfer instruction
    const transferIx = createTransferInstruction(
      senderTokenAccount,
      recipientTokenAccount,
      sender,
      amount * 10 ** 6
    );
    transferIx.keys.find(k => k.pubkey.equals(sender))!.isSigner = true;
    tx.add(transferIx);

    // Set fee payer and blockhash
    tx.feePayer = devKeypair.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // Encode creds for Privy
    const encoded = Buffer.from(`${privyAppId}:${privyAppSecret}`).toString("base64");

    // Send to Privy for user signature
    const privyResponse = await fetch(`https://api.privy.io/v1/wallets/${userPrivyId}/rpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${encoded}`,
        "privy-app-id": privyAppId,
      },
      body: JSON.stringify({
        method: "signTransaction",
        params: {
          transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"),
          encoding: "base64",
        },
      }),
    });

    const privyData = await privyResponse.json();
    if (!privyData.data?.signed_transaction) {
      throw new Error("User failed to sign transaction");
    }

    // Add dev wallet signature
    const signedTx = Transaction.from(Buffer.from(privyData.data.signed_transaction, "base64"));
    signedTx.partialSign(devKeypair);

    // Send transaction
    try {
      const signature = await connection.sendRawTransaction(signedTx.serialize());
      await connection.confirmTransaction(signature, "confirmed");
      return NextResponse.json({ success: true, signature }, { headers: corsHeaders });
    } catch (sendErr) {
      if (sendErr instanceof SendTransactionError) {
        const logs = await sendErr.getLogs(connection);
        console.error("Transaction failed logs:", logs);
      }
      throw sendErr;
    }

  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500, headers: corsHeaders });
  }
}
