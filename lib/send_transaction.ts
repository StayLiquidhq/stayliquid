import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";

const SOLANA_RPC = `${process.env.HELIUS_URL}/?api-key=${process.env.HELIUS_API_KEY}`;
const USDC_MINT = new PublicKey(process.env.USDC_MINT!);

export async function sendSplToken(
  userPrivyId: string,
  userWalletAddress: string,
  amount: number
) {
  const privyAppId = process.env.PRIVY_APP_ID;
  const privyAppSecret = process.env.PRIVY_APP_SECRET;
  const devWalletPublicKey = process.env.DEV_WALLET_PUBLIC_KEY;

  if (!privyAppId || !privyAppSecret || !devWalletPublicKey) {
    throw new Error("Missing server configuration for sending funds.");
  }

  const connection = new Connection(SOLANA_RPC);
  const sender = new PublicKey(userWalletAddress);
  const recipient = new PublicKey(devWalletPublicKey);

  const senderTokenAccount = await getAssociatedTokenAddress(USDC_MINT, sender);
  const recipientTokenAccount = await getAssociatedTokenAddress(
    USDC_MINT,
    recipient
  );

  const transferAmount = amount;

  const tx = new Transaction();

  const recipientInfo = await connection.getAccountInfo(recipientTokenAccount);
  if (!recipientInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        sender, // Fee payer is the user
        recipientTokenAccount,
        recipient,
        USDC_MINT
      )
    );
  }

  tx.add(
    createTransferInstruction(
      senderTokenAccount,
      recipientTokenAccount,
      sender,
      transferAmount * 10 ** 6
    )
  );

  tx.feePayer = sender;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const privyResponse = await fetch(
    `https://api.privy.io/v1/wallets/${userPrivyId}/rpc`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(
          `${privyAppId}:${privyAppSecret}`
        ).toString("base64")}`,
        "privy-app-id": privyAppId,
      },
      body: JSON.stringify({
        method: "signAndSendTransaction",
        params: {
          transaction: tx
            .serialize({ requireAllSignatures: false })
            .toString("base64"),
          encoding: "base64",
        },
      }),
    }
  );

  const privyData = await privyResponse.json();
  if (!privyData.data?.signature) {
    console.error(
      "Privy signAndSendTransaction failed during transfer:",
      privyData
    );
    throw new Error(
      "User failed to sign and send transfer transaction via Privy"
    );
  }

  const signature = privyData.data.signature;
  await connection.confirmTransaction(signature, "confirmed");

  console.log(
    `Successfully sent ${transferAmount} USDC from ${userWalletAddress}. Signature: ${signature}`
  );
  return { signature, sweepAmount: transferAmount };
}
