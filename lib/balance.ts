import supabase from "../utils/supabase";

export interface AdjustBalanceParams {
  walletId?: string;
  walletAddress?: string;
  amount: number;
  idempotencyKey?: string;
}

function validateParams(params: AdjustBalanceParams) {
  if (typeof params.amount !== "number" || !isFinite(params.amount)) {
    throw new Error("Amount must be a finite number");
  }
  if (params.amount <= 0) {
    throw new Error("Amount must be greater than zero");
  }
  if (!params.walletId && !params.walletAddress) {
    throw new Error("walletId or walletAddress is required");
  }
}

export async function incrementBalance(params: AdjustBalanceParams) {
  validateParams(params);
  const rpcArgs: Record<string, unknown> = {
    amount_to_add: params.amount,
  };

  if (params.walletId) rpcArgs.wallet_id = params.walletId;
  if (params.walletAddress) rpcArgs.wallet_address = params.walletAddress;
  if (params.idempotencyKey) rpcArgs.idempotency_key = params.idempotencyKey;

  const { data, error } = await supabase.rpc("increment_balance", rpcArgs);

  if (error) {
    return { error: new Error(error.message) };
  }
  return { data };
}

export async function decrementBalance(params: AdjustBalanceParams) {
  validateParams(params);

  const rpcArgs: Record<string, unknown> = {
    amount_to_subtract: params.amount,
  };

  if (params.walletId) rpcArgs.wallet_id = params.walletId;
  if (params.walletAddress) rpcArgs.wallet_address = params.walletAddress;
  if (params.idempotencyKey) rpcArgs.idempotency_key = params.idempotencyKey;

  const { data, error } = await supabase.rpc("decrement_balance", rpcArgs);

  if (error) {
    return { error: new Error(error.message) };
  }
  return { data };
}
