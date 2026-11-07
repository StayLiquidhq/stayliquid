import { z } from "zod";

export interface TimeOfDay {
  hours: number;
  minutes: number;
}

export const WalletBalanceSchema = z.object({
  balance: z.number().nullable().optional(),
});

export const PlanRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string(),
  name: z.string().nullable().optional(),
  plan_type: z.string(),
  received_amount: z.number().nullable().optional(),
  recurrent_payout: z.number().nullable().optional(),
  frequency: z.string().nullable().optional(),
  payout_time: z.string().nullable().optional(),
  target_type: z.string().nullable().optional(),
  target_amount: z.number().nullable().optional(),
  target_date: z.string().nullable().optional(),
  payout_method: z.string().default("fiat"),
  payout_account_number: z.string().nullable().optional(),
  bank_name: z.string().nullable().optional(),
  account_name: z.string().nullable().optional(),
  bank_code: z.string().nullable().optional(),
  payout_wallet_address: z.string().nullable().optional(),
  chain: z.string().nullable().optional(),
  token: z.string().nullable().optional(),
  status: z.string(),
  created_at: z.string().nullable().optional(),
  last_payout_date: z.string().nullable().optional(),
  next_payout_date: z.string().nullable().optional(),
});

export const PlanWithWalletsSchema = PlanRowSchema.extend({
  wallets: z
    .union([
      WalletBalanceSchema,
      z.array(WalletBalanceSchema),
    ])
    .nullable()
    .optional(),
});

export type PlanRow = z.infer<typeof PlanRowSchema>;

export type PlanWithWallets = z.infer<typeof PlanWithWalletsSchema>;

export interface ProcessPlanResult {
  planId: string;
  type: string;
  status: "success" | "failed";
  error?: string;
}

export interface ProcessSummary {
  successful: number;
  failed: number;
  details: ProcessPlanResult[];
}

