export const PLAN_COLUMNS =
  "id, user_id, name, plan_type, status, received_amount, recurrent_payout, frequency, payout_time, next_payout_date, last_payout_date, target_type, target_amount, target_date, payout_method, payout_wallet_address, payout_account_number, bank_name, account_name, bank_code, chain, token, created_at, updated_at";

export const WALLET_COLUMNS =
  "id, plan_id, address, chain_type, balance, has_webhook, last_synced_at, created_at, updated_at";

export const TRANSACTION_COLUMNS =
  "id, wallet_id, type, amount, currency, description, solana_signature, fiat_transaction_id, transaction_hash, created_at";

export const USER_COLUMNS =
  "id, auth_user_id, email, name, username, picture, google_id, has_created_plan, created_at, updated_at";
