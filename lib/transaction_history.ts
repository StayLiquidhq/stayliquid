import supabase from '../utils/supabase';

interface LogTransactionParams {
  wallet_id: string;
  type: 'credit' | 'debit';
  amount: number;
  currency: string;
  description: string;
  solana_signature?: string;
}

/**
 * Logs a new transaction to the database.
 * @param params - The details of the transaction to log.
 */
export async function logTransaction(params: LogTransactionParams): Promise<{ error?: Error }> {
  const { error } = await supabase
    .from('transactions')
    .insert({
      wallet_id: params.wallet_id,
      type: params.type,
      amount: params.amount,
      currency: params.currency,
      description: params.description,
      solana_signature: params.solana_signature,
    });

  if (error) {
    console.error(`Failed to log transaction for wallet ${params.wallet_id}. Error: ${error.message}`);
    return { error: new Error(error.message) };
  }

  return {};
}
