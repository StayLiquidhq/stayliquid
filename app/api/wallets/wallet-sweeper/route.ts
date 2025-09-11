import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import supabase from "../../../../utils/supabase";
import { logTransaction } from "../../../../lib/transaction_history";
import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";
import cdp from "@/utils/cdp";

const sweepSchema = z.object({
  wallet_address: z.string(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

const SOLANA_RPC = `${process.env.HELIUS_URL}/?api-key=${process.env.HELIUS_API_KEY}`;
const USDC_MINT = new PublicKey(process.env.USDC_MINT!);
const DEV_WALLET_PUBLIC_KEY = process.env.DEV_WALLET_PUBLIC_KEY!;
const FEES_PAYER_WALLET = process.env.FEES_PAYER_WALLET!;

async function checkUsdcBalance(userWalletAddress: string) {
  const connection = new Connection(SOLANA_RPC);
  const userPublicKey = new PublicKey(userWalletAddress);

  try {
    const userTokenAccount = await getAssociatedTokenAddress(
      USDC_MINT,
      userPublicKey
    );
    const tokenBalance = await connection.getTokenAccountBalance(
      userTokenAccount
    );

    if (!tokenBalance.value.uiAmount) {
      return 0;
    }

    return tokenBalance.value.uiAmount;
  } catch (error) {
    return 0;
  }
}

export async function POST(request: NextRequest) {
  try {
    // 1. Extract and validate the Bearer token from the header
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized: Missing or invalid Authorization header" },
        { status: 401, headers: corsHeaders }
      );
    }
    const token = authHeader.split(" ")[1];

    // 2. Verify the token and retrieve the authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid or expired token" },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json();
    const validation = sweepSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.format() },
        { status: 400, headers: corsHeaders }
      );
    }

    const { wallet_address } = validation.data;

    // 3. Verify user owns the wallet
    const { data: walletOwner, error: ownerError } = await supabase
      .from("wallets")
      .select("user_id")
      .eq("address", wallet_address)
      .single();

    if (ownerError || !walletOwner || walletOwner.user_id !== user.id) {
        return NextResponse.json(
            { error: "Forbidden: User does not own this wallet" },
            { status: 403, headers: corsHeaders }
        );
    }

    const balance = await checkUsdcBalance(wallet_address);

    if (balance === 0) {
      return NextResponse.json(
        { signature: null, sweepAmount: 0, message: "No balance to sweep" },
        { headers: corsHeaders }
      );
    }

    console.log(`Starting sweep for wallet: ${wallet_address}`);
    const sweepAmount = balance;

    const connection = new Connection(SOLANA_RPC);
    const sender = new PublicKey(wallet_address);
    const recipient = new PublicKey(DEV_WALLET_PUBLIC_KEY);
    const feePayer = new PublicKey(FEES_PAYER_WALLET);

    console.log("Fetching token accounts...");
    const senderTokenAccount = await getAssociatedTokenAddress(USDC_MINT, sender);
    const recipientTokenAccount = await getAssociatedTokenAddress(
      USDC_MINT,
      recipient
    );

    const instructions = [];
    console.log("Checking recipient token account info...");
    const recipientInfo = await connection.getAccountInfo(recipientTokenAccount);
    if (!recipientInfo) {
      console.log("Recipient token account not found. Creating one...");
      instructions.push(
        createAssociatedTokenAccountInstruction(
          feePayer,
          recipientTokenAccount,
          recipient,
          USDC_MINT
        )
      );
    }

    console.log("Creating transfer instruction...");
    instructions.push(
      createTransferInstruction(
        senderTokenAccount,
        recipientTokenAccount,
        sender,
        sweepAmount * 10 ** 6
      )
    );

    console.log("Fetching latest blockhash...");
    const { blockhash } = await connection.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: feePayer,
      instructions,
      recentBlockhash: blockhash,
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);

    const serializedTx = Buffer.from(tx.serialize()).toString("base64");

    // Sign with the funding account.
    const signedTxResponse = await cdp.solana.signTransaction({
        address: wallet_address,
        transaction: serializedTx,
    });

    const signedBase64Tx = signedTxResponse.signature;

    // Sign with the feePayer account.
    const finalSignedTxResponse = await cdp.solana.signTransaction({
        address: feePayer.toBase58(),
        transaction: signedBase64Tx,
    });

    // Send the signed transaction to the network.
    const signature = await connection.sendRawTransaction(Buffer.from(finalSignedTxResponse.signature, 'base64'));
    await connection.confirmTransaction(signature, "confirmed");

    console.log(
      `Successfully swept ${sweepAmount} USDC from ${wallet_address}. Signature: ${signature}`
    );

    if (signature && sweepAmount > 0) {
      const { error: claimError } = await supabase
        .from("processed_transactions")
        .insert({ signature });
      if (claimError) {
        if ((claimError as any).code === "23505") {
          console.log(
            `Sweep transaction ${signature} already claimed. Skipping.`
          );
          return NextResponse.json(
            { signature, sweepAmount, message: "Sweep already processed" },
            { headers: corsHeaders }
          );
        }
        console.error(
          `Failed to claim sweep transaction ${signature}:`,
          claimError
        );
        return NextResponse.json(
          {
            error: "Internal server error",
            details: "Failed to claim sweep transaction",
          },
          { status: 500, headers: corsHeaders }
        );
      }

      const { data: wallet, error: fetchError } = await supabase
        .from("wallets")
        .select("id")
        .eq("address", wallet_address)
        .single();

      if (fetchError || !wallet) {
        console.error(
          `Wallet not found for address ${wallet_address}, cannot update balance.`
        );
        await supabase
          .from("processed_transactions")
          .delete()
          .eq("signature", signature);
      } else {
        const { error: rpcError } = await supabase.rpc("increment_balance", {
          wallet_address: wallet_address,
          amount_to_add: sweepAmount,
        });

        if (rpcError) {
          console.error(
            `Failed to update balance for wallet ${wallet_address}:`,
            rpcError
          );
          await supabase
            .from("processed_transactions")
            .delete()
            .eq("signature", signature);
          return NextResponse.json(
            { error: "Failed to update balance" },
            { status: 500, headers: corsHeaders }
          );
        } else {
          console.log(
            `Successfully swept and updated balance for wallet ${wallet_address}`
          );
          try {
            await logTransaction({
              wallet_id: wallet.id,
              type: "credit",
              amount: sweepAmount,
              currency: "USDC",
              description: `Wallet balance updated`,
            });
          } catch (e) {
            console.error(
              `Failed to log transaction for ${wallet_address}:`,
              e
            );
          }
        }
      }
    }

    return NextResponse.json(
      { signature, sweepAmount },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    console.error("Error sweeping wallet:", err);
    return NextResponse.json(
      { error: "Internal server error", details: err.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
