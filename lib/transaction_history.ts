import supabase from "@/utils/supabase";
import { logger } from "./logger";

export interface LogTransactionParams {
  wallet_id: string;
  type: "credit" | "debit";
  amount: number;
  currency: string;
  description: string;
  solana_signature?: string;
  transaction_hash?: string;
  fiat_transaction_id?: string;
}

export async function logTransaction(params: LogTransactionParams): Promise<{ error?: Error }> {
  const { error } = await supabase
    .from("transactions")
    .insert({
      wallet_id: params.wallet_id,
      type: params.type,
      amount: params.amount,
      currency: params.currency,
      description: params.description,
      solana_signature: params.solana_signature,
      transaction_hash: params.transaction_hash,
      fiat_transaction_id: params.fiat_transaction_id,
    });

  if (error) {
    logger.error("Failed to log transaction to database ledger", {
      module: "transactions/log",
      walletId: params.wallet_id,
      signature: params.solana_signature,
    }, error);

    return { error: new Error(error.message) };
  }

  logger.debug("Logged transaction to database ledger", {
    module: "transactions/log",
    walletId: params.wallet_id,
    type: params.type,
    amount: params.amount,
    signature: params.solana_signature,
  });

  return {};
}
