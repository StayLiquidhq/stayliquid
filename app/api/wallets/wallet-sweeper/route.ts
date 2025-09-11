import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import supabase from "../../../../utils/supabase";
import { logTransaction } from "../../../../lib/transaction_history";
import {
  Connection,
  PublicKey,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";

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

const SOLANA_DEVNET = "https://api.devnet.solana.com";
const USDC_DEVNET_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

async function checkUsdcBalance(userWalletAddress: string) {
  const connection = new Connection(SOLANA_DEVNET);
  const userPublicKey = new PublicKey(userWalletAddress);

  try {
    const userTokenAccount = await getAssociatedTokenAddress(
      USDC_DEVNET_MINT,
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

    const devPrivateKey = process.env.DEV_WALLET_PRIVATE_KEY;
    const privyAppId = process.env.PRIVY_APP_ID;
    const privyAppSecret = process.env.PRIVY_APP_SECRET;
    const devWalletPublicKey = process.env.DEV_WALLET_PUBLIC_KEY;

    if (
      !devPrivateKey ||
      !privyAppId ||
      !privyAppSecret ||
      !devWalletPublicKey
    ) {
      throw new Error("Missing server configuration for sweeping funds.");
    }

    const sweepAmount = await checkUsdcBalance(wallet_address);
    if (sweepAmount === 0) {
      console.log("No USDC balance to sweep.");
      return NextResponse.json(
        { signature: null, sweepAmount: 0 },
        { headers: corsHeaders }
      );
    }

    const connection = new Connection(SOLANA_DEVNET);
    const devKeypair = Keypair.fromSecretKey(bs58.decode(devPrivateKey));
    const userPublicKey = new PublicKey(wallet_address);
    const devPublicKey = new PublicKey(devWalletPublicKey);

    const instructions = [];

    const userTokenAccount = await getAssociatedTokenAddress(
      USDC_DEVNET_MINT,
      userPublicKey
    );
    const devTokenAccount = await getAssociatedTokenAddress(
      USDC_DEVNET_MINT,
      devPublicKey
    );

    const devTokenAccountInfo = await connection.getAccountInfo(
      devTokenAccount
    );
    if (!devTokenAccountInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          devPublicKey,
          devTokenAccount,
          devPublicKey,
          USDC_DEVNET_MINT
        )
      );
    }

    instructions.push(
      createTransferInstruction(
        userTokenAccount,
        devTokenAccount,
        userPublicKey,
        sweepAmount * 10 ** 6
      )
    );

    const { blockhash } = await connection.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: devPublicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(message);
    const serializedTransaction = Buffer.from(transaction.serialize()).toString(
      "base64"
    );

    const privyResponse = await fetch(
      `https://api.privy.io/v1/wallets/${privy_id}/rpc`,
      {
        method: "POST",
        headers: {
          "privy-app-id": privyAppId,
          Authorization: `Basic ${Buffer.from(
            `${privyAppId}:${privyAppSecret}`
          ).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          method: "signTransaction",
          params: {
            transaction: serializedTransaction,
            encoding: "base64",
          },
        }),
      }
    );

    const privyData = await privyResponse.json();
    if (!privyData.data?.signed_transaction) {
      console.error("Privy signing failed:", privyData);
      throw new Error("User failed to sign sweep transaction via Privy");
    }

    const signedTx = VersionedTransaction.deserialize(
      Buffer.from(privyData.data.signed_transaction, "base64")
    );
    signedTx.sign([devKeypair]);

    const signature = await connection.sendTransaction(signedTx);
    await connection.confirmTransaction(signature, "confirmed");

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
