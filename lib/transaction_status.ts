import { getSolanaConnection } from "./solana";
import { logger } from "./logger";
import { TransactionConfirmationStatus } from "@solana/web3.js";

export async function getTransactionStatus(
  signature: string
): Promise<TransactionConfirmationStatus | null> {
  const connection = getSolanaConnection("confirmed");

  const result = await connection.getSignatureStatuses([signature], {
    searchTransactionHistory: true,
  });

  if (result.value && result.value[0]) {
    const status = result.value[0].confirmationStatus ?? null;
    logger.debug("Fetched transaction status", {
      module: "solana/status",
      signature,
      status: status ?? undefined,
    });

    return status;
  }

  logger.debug("Transaction not found or no status available yet", {
    module: "solana/status",
    signature,
  });

  return null;
}
