import { Connection, PublicKey, Transaction, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";

const SOLANA_RPC = `${process.env.HELIUS_URL}/?api-key=${process.env.HELIUS_API_KEY}`;
const USDC_MINT = new PublicKey(process.env.USDC_MINT!);

export async function sweepFunds(
  userPrivyId: string,
  userWalletAddress: string,
  amount: number
) {
  const devPrivateKey = process.env.DEV_WALLET_PRIVATE_KEY;
  const privyAppId = process.env.PRIVY_APP_ID;
  const privyAppSecret = process.env.PRIVY_APP_SECRET;
  const devWalletPublicKey = process.env.DEV_WALLET_PUBLIC_KEY;

  if (!devPrivateKey || !privyAppId || !privyAppSecret || !devWalletPublicKey) {
    throw new Error("Missing server configuration for sweeping funds.");
  }
  console.log(
    "privyAppId:",
    privyAppId,
    "privyAppSecret:",
    privyAppSecret ? "****" : "not set"
  );

  const connection = new Connection(SOLANA_RPC);
  const devKeypair = Keypair.fromSecretKey(bs58.decode(devPrivateKey));
  const sender = new PublicKey(userWalletAddress);
  const recipient = new PublicKey(devWalletPublicKey);

  const senderTokenAccount = await getAssociatedTokenAddress(USDC_MINT, sender);
  const recipientTokenAccount = await getAssociatedTokenAddress(
    USDC_MINT,
    recipient
  );

  const sweepAmount = amount;

  const tx = new Transaction();

  const recipientInfo = await connection.getAccountInfo(recipientTokenAccount);
  if (!recipientInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        devKeypair.publicKey,
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
      sweepAmount * 10 ** 6
    )
  );

  tx.feePayer = devKeypair.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const encoded = Buffer.from(`${privyAppId}:${privyAppSecret}`).toString(
    "base64"
  );
  console.log(`encoding transaction for signing ${userPrivyId}`);
  console.log(`transaction encoded: ${encoded}`);
  const privyResponse = await fetch(
    `https://api.privy.io/v1/wallets/${userPrivyId}/rpc`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${encoded}`,
        "privy-app-id": privyAppId,
      },
      body: JSON.stringify({
        method: "signTransaction",
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
  if (!privyData.data?.signed_transaction) {
    console.error("Privy signing failed during sweep:", privyData);
    throw new Error("User failed to sign sweep transaction via Privy");
  }

  const signedTx = Transaction.from(
    Buffer.from(privyData.data.signed_transaction, "base64")
  );
  signedTx.partialSign(devKeypair);

  const signature = await connection.sendRawTransaction(signedTx.serialize());
  await connection.confirmTransaction(signature, "confirmed");

  console.log(
    `Successfully swept ${sweepAmount} USDC from ${userWalletAddress}. Signature: ${signature}`
  );
  return { signature, sweepAmount };
}
