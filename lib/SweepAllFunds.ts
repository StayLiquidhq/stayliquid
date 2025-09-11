import {
  Connection,
  PublicKey,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";
const SOLANA_RPC = `${process.env.HELIUS_URL}/?api-key=${process.env.HELIUS_API_KEY}`;
const USDC_MINT = new PublicKey(process.env.USDC_MINT!);

export async function sweepAllFunds(
  userPrivyId: string,
  userWalletAddress: string,
  amount: number
) {
  const devPrivateKey = process.env.DEV_WALLET_PRIVATE_KEY;
  const privyAppId = process.env.PRIVY_APP_ID;
  const privyAppSecret = process.env.PRIVY_APP_SECRET;
  const devWalletPublicKey = process.env.DEV_WALLET_PUBLIC_KEY;

  if (!devPrivateKey || !devWalletPublicKey || !privyAppId || !privyAppSecret) {
    throw new Error("Missing server configuration for sweeping funds.");
  }

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

  const instructions = [];

  const recipientInfo = await connection.getAccountInfo(recipientTokenAccount);
  if (!recipientInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        devKeypair.publicKey,
        recipientTokenAccount,
        recipient,
        USDC_MINT
      )
    );
  }

  instructions.push(
    createTransferInstruction(
      senderTokenAccount,
      recipientTokenAccount,
      sender,
      sweepAmount * 10 ** 6
    )
  );

  const { blockhash } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: devKeypair.publicKey,
    instructions,
    recentBlockhash: blockhash,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);

  const privyResponse = await fetch(
    `https://api.privy.io/v1/wallets/${userPrivyId}/rpc`,
    {
      method: "POST",
      headers: {
        "privy-app-id": privyAppId,
        Authorization:
          "Basic " + Buffer.from(`${privyAppId}:${privyAppSecret}`).toString("base64"),
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

  const signedTx = VersionedTransaction.deserialize(
    Buffer.from(privyData.data.signed_transaction, "base64")
  );
  signedTx.sign([devKeypair]);

  const signature = await connection.sendRawTransaction(signedTx.serialize());
  await connection.confirmTransaction(signature, "confirmed");

  console.log(
    `Successfully swept ${sweepAmount} USDC from ${userWalletAddress}. Signature: ${signature}`
  );
  return { signature, sweepAmount };
}
