import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { getTransactionStatus } from "./transaction_status";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";
import cdp from "@/utils/cdp";

const SOLANA_RPC = `${process.env.HELIUS_URL}/?api-key=${process.env.HELIUS_API_KEY}`;
const USDC_MINT = new PublicKey(process.env.USDC_MINT!);
const DEV_WALLET_PUBLIC_KEY = process.env.DEV_WALLET_PUBLIC_KEY!;
const FEES_PAYER_WALLET = process.env.FEES_PAYER_WALLET!;

export async function sweepFunds(
  userWalletAddress: string,
  amount: number
) {
  const connection = new Connection(SOLANA_RPC);
  const sender = new PublicKey(userWalletAddress);
  const recipient = new PublicKey(DEV_WALLET_PUBLIC_KEY);
  const feePayer = new PublicKey(FEES_PAYER_WALLET);

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
        feePayer,
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

  tx.feePayer = feePayer;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const serializedTx = Buffer.from(
    tx.serialize({ requireAllSignatures: false })
  ).toString("base64");

  // Sign with the funding account.
  const signedTxResponse = await cdp.solana.signTransaction({
    address: userWalletAddress,
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

  let status = await getTransactionStatus(signature);
  let attempts = 0;
  const maxAttempts = 3;
  const delay = 20000; // 20 seconds

  while (status !== "finalized" && attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    status = await getTransactionStatus(signature);
    console.log(
      `Rechecked status for sweep transaction ${signature}: ${status}`
    );
    attempts++;
  }

  if (status !== "finalized") {
    throw new Error(
      `Sweep transaction ${signature} for wallet ${userWalletAddress} did not finalize. Status: ${status}`
    );
  }

  console.log(
    `Successfully swept ${sweepAmount} USDC from ${userWalletAddress}. Signature: ${signature}`
  );
  return { signature, sweepAmount };
}
