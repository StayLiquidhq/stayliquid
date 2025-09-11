import { Connection, Commitment } from "@solana/web3.js";

export async function getTransactionStatus(signature: string) {
  const connection = new Connection(
    `${process.env.HELIUS_URL}/?api-key=${process.env.HELIUS_API_KEY}`,
    "confirmed" as Commitment
  );
  const result = await connection.getSignatureStatuses([signature], {
    searchTransactionHistory: true,
  });
  console.log(`Fetched status for transaction ${signature}:`, result);

  if (result.value && result.value[0]) {
    const status = result.value[0].confirmationStatus;
    console.log(`Transaction ${signature} status: ${status}`);
    return status;
  } else {
    console.log(`Transaction ${signature} not found or no status available.`);
    return null;
  }
}
