import supabase from "@/utils/supabase";
import type { Json } from "@/lib/supabase/types";
import { logger } from "@/lib/logger";

export type TransferRecoveryOperation =
  | "recurring_payout"
  | "target_payout"
  | "plan_break"
  | "fiat_payout";

export interface TransferRecoveryJob {
  status: string;
  response: Json | null;
  last_error: string | null;
}

export interface PrepareTransferRecoveryJobParams {
  scope: string;
  key: string;
  operationType: TransferRecoveryOperation;
  userId?: string | null;
  planId: string;
  walletId: string;
  chain: string;
  token: string;
  request: Json;
}

export async function getTransferRecoveryJob(scope: string, key: string): Promise<TransferRecoveryJob | null> {
  const { data, error } = await supabase
    .from("transfer_recovery_jobs")
    .select("status, response, last_error")
    .eq("scope", scope)
    .eq("key", key)
    .maybeSingle();

  if (error) {
    logger.error("Failed to fetch transfer recovery job", { module: "recovery", scope }, error);

    return null;
  }

  return data;
}

export async function prepareTransferRecoveryJob(params: PrepareTransferRecoveryJobParams): Promise<void> {
  const { error } = await supabase.rpc("upsert_transfer_recovery_job", {
    p_scope: params.scope,
    p_key: params.key,
    p_operation_type: params.operationType,
    p_user_id: params.userId ?? null,
    p_plan_id: params.planId,
    p_wallet_id: params.walletId,
    p_chain: params.chain,
    p_token: params.token,
    p_request: params.request,
  });

  if (error) {
    logger.error("Failed to prepare transfer recovery job", { module: "recovery", scope: params.scope }, error);
    throw new Error("Failed to prepare transfer recovery job");
  }
}

export async function markTransferRecoveryExternalSucceeded(
  scope: string,
  key: string,
  result: Json,
): Promise<void> {
  const { error } = await supabase.rpc("mark_transfer_recovery_external_succeeded", {
    p_scope: scope,
    p_key: key,
    p_result: result,
  });

  if (error) {
    logger.error("Failed to mark transfer recovery external success", { module: "recovery", scope }, error);
    throw new Error("Failed to mark transfer recovery external success");
  }
}

export async function completeTransferRecoveryJob(scope: string, key: string, response: Json): Promise<void> {
  const { error } = await supabase.rpc("complete_transfer_recovery_job", {
    p_scope: scope,
    p_key: key,
    p_response: response,
  });

  if (error) {
    logger.error("Failed to complete transfer recovery job", { module: "recovery", scope }, error);
  }
}

export async function failTransferRecoveryJob(scope: string, key: string, errorMessage: string): Promise<void> {
  const { error } = await supabase.rpc("fail_transfer_recovery_job", {
    p_scope: scope,
    p_key: key,
    p_error: errorMessage,
  });

  if (error) {
    logger.error("Failed to mark transfer recovery job failed", { module: "recovery", scope }, error);
  }
}

export async function processTransferRecoveryJobs(limit = 25): Promise<number> {
  const { data, error } = await supabase.rpc("process_transfer_recovery_jobs", { p_limit: limit });

  if (error) {
    logger.error("Failed to process transfer recovery jobs", { module: "recovery" }, error);
    throw new Error("Failed to process transfer recovery jobs");
  }

  return data ?? 0;
}
