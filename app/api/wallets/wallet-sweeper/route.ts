import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import supabase from "../../../../utils/supabase";
import { logTransaction } from "../../../../lib/transaction_history";
import {
  Connection,
  PublicKey,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";
import bs58 from "bs58";

const sweepSchema = z.object({
  privy_id: z.string(),
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
    const body = await request.json();
    const validation = sweepSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.format() },
        { status: 400, headers: corsHeaders }
      );
    }

    const { privy_id, wallet_address } = validation.data;

    const balance = await checkUsdcBalance(wallet_address);

    if (balance === 0) {
      return NextResponse.json(
        { signature: null, sweepAmount: 0, message: "No balance to sweep" },
        { headers: corsHeaders }
      );
    }

    console.log(`Starting sweep for wallet: ${wallet_address}`);
    const sweepAmount = balance;

    const devPrivateKey = process.env.DEV_WALLET_PRIVATE_KEY;
    const privyAppId = process.env.PRIVY_APP_ID;
    const privyAppSecret = process.env.PRIVY_APP_SECRET;
    const devWalletPublicKey = process.env.DEV_WALLET_PUBLIC_KEY;

    console.log("privyAppId:", privyAppId);
    console.log("privyAppSecret:", privyAppSecret ? "****" : "not set");

    if (!devPrivateKey || !devWalletPublicKey || !privyAppId || !privyAppSecret) {
      console.error("Missing server configuration for sweeping funds.");
      throw new Error("Missing server configuration for sweeping funds.");
    }

    const connection = new Connection(SOLANA_RPC);
    const devKeypair = Keypair.fromSecretKey(bs58.decode(devPrivateKey));
    const sender = new PublicKey(wallet_address);
    const recipient = new PublicKey(devWalletPublicKey);

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
          devKeypair.publicKey,
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
      payerKey: devKeypair.publicKey,
      instructions,
      recentBlockhash: blockhash,
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);

    console.log("Sending transaction to Privy for signing...");
    const privyResponse = await fetch(
      `https://api.privy.io/v1/wallets/${privy_id}/rpc`,
      {
        method: "POST",
        headers: {
          "privy-app-id": privyAppId,
          Authorization:
            "Basic " +
            Buffer.from(`${privyAppId}:${privyAppSecret}`).toString("base64"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          method: "signTransaction",
          params: {
            transaction: Buffer.from(tx.serialize()).toString("base64"),
            encoding: "base64",
          },
        }),
      }
    );

    const privyData = await privyResponse.json();

    if (!privyResponse.ok || !privyData.data?.signed_transaction) {
      console.error("Privy signing failed during sweep:", privyData);
      throw new Error("User failed to sign sweep transaction via Privy");
    }
    console.log("Privy signing successful.");

    const signedTx = VersionedTransaction.deserialize(
      Buffer.from(privyData.data.signed_transaction, "base64")
    );
    console.log("Signing transaction with dev key...");
    signedTx.sign([devKeypair]);

    console.log("Sending raw transaction to Solana...");
    const signature = await connection.sendRawTransaction(signedTx.serialize());
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
