import { z } from "zod";

import supabase from "@/utils/supabase";
import { optionalEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  answerTelegramCallback,
  editTelegramMessage,
  escapeHtml,
  getTelegramAdminChatId,
  sendTelegramMessage,
} from "@/lib/telegram";

const HELP_TEXT = [
  "Liquid fiat payout bot",
  "",
  "/start - show this help",
  "/subscribe <code> - subscribe to fiat payout alerts",
  "/unsubscribe - stop receiving alerts",
  "/total - total saved on the platform",
].join("\n");

const TelegramUserSchema = z.object({
  id: z.number(),
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});

const TelegramChatSchema = z.object({
  id: z.number(),
  type: z.string(),
});

const TelegramMessageSchema = z.object({
  message_id: z.number(),
  chat: TelegramChatSchema,
  from: TelegramUserSchema.optional(),
  text: z.string().optional(),
});

const TelegramCallbackSchema = z.object({
  id: z.string(),
  from: TelegramUserSchema,
  data: z.string().optional(),
  message: TelegramMessageSchema.optional(),
});

export const TelegramUpdateSchema = z.object({
  message: TelegramMessageSchema.optional(),
  callback_query: TelegramCallbackSchema.optional(),
});

export type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>;

type TelegramUser = z.infer<typeof TelegramUserSchema>;

const PayoutDetailsSchema = z.object({
  id: z.string(),
  amount: z.number().nullable().optional(),
  token: z.string().nullable().optional(),
  bank_name: z.string().nullable().optional(),
  account_number: z.string().nullable().optional(),
  account_name: z.string().nullable().optional(),
});

const MessageDetailsSchema = z.array(
  z.object({
    chat_id: z.number(),
    message_id: z.number(),
  })
);

const AcceptResultSchema = z.object({
  payout_details: PayoutDetailsSchema,
  message_details: MessageDetailsSchema,
});

const TotalSavedSchema = z.record(z.string(), z.number());

const VendorChatListSchema = z.array(
  z.object({
    chat_id: z.number(),
  })
);

interface PayoutSummary {
  amount?: number | null;
  token?: string | null;
  bank_name?: string | null;
  account_number?: string | null;
  account_name?: string | null;
}

function displayHandle(from: TelegramUser): string {
  if (from.username) return `@${escapeHtml(from.username)}`;

  return escapeHtml(from.first_name || String(from.id));
}

function formatPayoutSummary(details: PayoutSummary, paid = false): string {
  const header = paid ? "Payout marked as paid" : "New fiat payout request";

  return [
    `<b>${header}</b>`,
    "",
    `<b>Amount:</b> ${escapeHtml(String(details.amount ?? 0))} ${escapeHtml(details.token ?? "USDC")}`,
    `<b>Bank:</b> ${escapeHtml(details.bank_name ?? "-")}`,
    `<b>Account Number:</b> ${escapeHtml(details.account_number ?? "-")}`,
    `<b>Account Name:</b> ${escapeHtml(details.account_name ?? "-")}`,
  ].join("\n");
}

async function handleSubscribe(
  chatId: number,
  chatType: string,
  from: TelegramUser,
  code: string | undefined
): Promise<void> {
  if (chatType !== "private") {
    await sendTelegramMessage(chatId, "Please use /subscribe in a private chat.");

    return;
  }

  const expected = optionalEnv("VENDOR_SUBSCRIPTION_CODE");

  if (!expected) {
    await sendTelegramMessage(chatId, "Subscriptions are not configured.");

    return;
  }

  if (!code) {
    await sendTelegramMessage(chatId, "Usage: /subscribe <code>");

    return;
  }

  if (code !== expected) {
    await sendTelegramMessage(chatId, "Incorrect subscription code.");

    return;
  }

  const { data: existing, error: lookupError } = await supabase
    .from("vendors")
    .select("id")
    .eq("user_id", from.id)
    .maybeSingle();

  if (lookupError) {
    logger.error("Failed to check vendor subscription", { module: "telegram-bot" }, lookupError);
    await sendTelegramMessage(chatId, "An error occurred. Please try again later.");

    return;
  }

  if (existing) {
    await sendTelegramMessage(chatId, "You are already subscribed.");

    return;
  }

  const { error: insertError } = await supabase.from("vendors").insert({
    user_id: from.id,
    chat_id: chatId,
    username: from.username ?? null,
    first_name: from.first_name ?? null,
    last_name: from.last_name ?? null,
  });

  if (insertError) {
    logger.error("Failed to save vendor subscription", { module: "telegram-bot" }, insertError);
    await sendTelegramMessage(chatId, "Could not save your subscription.");

    return;
  }

  await sendTelegramMessage(chatId, "✅ You are subscribed to fiat payout alerts.");
}

async function handleUnsubscribe(chatId: number, userId: number): Promise<void> {
  const { error } = await supabase.from("vendors").delete().eq("user_id", userId);

  if (error) {
    logger.error("Failed to remove vendor subscription", { module: "telegram-bot" }, error);
    await sendTelegramMessage(chatId, "Could not unsubscribe. Please try again later.");

    return;
  }

  await sendTelegramMessage(chatId, "You have unsubscribed from fiat payout alerts.");
}

async function handleTotal(chatId: number): Promise<void> {
  const { data, error } = await supabase.rpc("platform_total_saved");

  if (error) {
    logger.error("Failed to compute platform total", { module: "telegram-bot" }, error);
    await sendTelegramMessage(chatId, "Could not fetch totals right now.");

    return;
  }

  const parsed = TotalSavedSchema.safeParse(data);

  if (!parsed.success) {
    await sendTelegramMessage(chatId, "Could not fetch totals right now.");

    return;
  }

  const entries = Object.entries(parsed.data);

  if (entries.length === 0) {
    await sendTelegramMessage(chatId, "No savings recorded yet.");

    return;
  }

  const lines = entries.map(([currency, total]) => `${escapeHtml(currency)}: ${total.toFixed(2)}`);
  const message = `<b>Total saved on the platform</b>\n\n${lines.join("\n")}`;

  await sendTelegramMessage(chatId, message, { parseMode: "HTML" });
}

async function handleCommand(
  chatId: number,
  chatType: string,
  from: TelegramUser,
  text: string
): Promise<void> {
  const parts = text.trim().split(/\s+/);
  const command = parts[0].toLowerCase();

  switch (command) {
    case "/start":
      await sendTelegramMessage(chatId, HELP_TEXT);

      return;
    case "/subscribe":
      await handleSubscribe(chatId, chatType, from, parts[1]);

      return;
    case "/unsubscribe":
      await handleUnsubscribe(chatId, from.id);

      return;
    case "/total":
      await handleTotal(chatId);

      return;
    default:
      await sendTelegramMessage(chatId, `Unknown command.\n\n${HELP_TEXT}`);
  }
}

async function handleAcceptPayout(callbackId: string, from: TelegramUser, payoutId: string): Promise<void> {
  const { data, error } = await supabase.rpc("accept_fiat_payout", {
    p_payout_id: payoutId,
    p_vendor_id: from.id,
  });

  if (error || !data) {
    await answerTelegramCallback(callbackId, "Payout already accepted", true);

    return;
  }

  const parsed = AcceptResultSchema.safeParse(data);

  if (!parsed.success) {
    await answerTelegramCallback(callbackId, "Could not load payout details", true);

    return;
  }

  const details = parsed.data.payout_details;
  const acceptedText = `${formatPayoutSummary(details)}\n\nAccepted by ${displayHandle(from)}`;

  for (const message of parsed.data.message_details) {
    await editTelegramMessage(message.chat_id, message.message_id, acceptedText, { parseMode: "HTML" });
  }

  await sendTelegramMessage(
    from.id,
    `${formatPayoutSummary(details)}\n\nSend the fiat amount to the account above, then tap Mark as Paid.`,
    {
      parseMode: "HTML",
      inlineKeyboard: [[{ text: "Mark as Paid", callback_data: `mark_paid:${payoutId}:${details.amount ?? 0}` }]],
    }
  );

  await answerTelegramCallback(callbackId, "Payout accepted. Check your messages.");
}

async function handleMarkPaid(
  callbackId: string,
  from: TelegramUser,
  payoutId: string,
  amountRaw: string | undefined
): Promise<void> {
  const amount = Number(amountRaw);

  const { error } = await supabase.rpc("mark_payout_as_paid", {
    p_payout_id: payoutId,
    p_vendor_id: from.id,
    p_payout_amount: Number.isFinite(amount) ? amount : undefined,
  });

  if (error) {
    logger.error("Failed to mark payout as paid", { module: "telegram-bot" }, error);
    await answerTelegramCallback(callbackId, "Could not mark as paid", true);

    return;
  }

  await sendTelegramMessage(from.id, "✅ Payout marked as paid.");
  await answerTelegramCallback(callbackId, "Marked as paid.");
}

async function handleCallback(callback: z.infer<typeof TelegramCallbackSchema>): Promise<void> {
  const data = callback.data ?? "";
  const [action, payoutId, amountRaw] = data.split(":");

  if (action === "accept_payout" && payoutId) {
    await handleAcceptPayout(callback.id, callback.from, payoutId);

    return;
  }

  if (action === "mark_paid" && payoutId) {
    await handleMarkPaid(callback.id, callback.from, payoutId, amountRaw);

    return;
  }

  await answerTelegramCallback(callback.id);
}

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  if (update.message?.text && update.message.from) {
    await handleCommand(
      update.message.chat.id,
      update.message.chat.type,
      update.message.from,
      update.message.text
    );

    return;
  }

  if (update.callback_query) {
    await handleCallback(update.callback_query);
  }
}

export interface NewFiatPayoutDetails {
  planId: string;
  walletId: string;
  amount: number;
  token: string;
  chain: string;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  fiatTransactionId: string;
  onchainTx: string;
}

export async function notifyNewFiatPayout(details: NewFiatPayoutDetails): Promise<void> {
  const { data: inserted, error: insertError } = await supabase
    .from("fiat_payouts")
    .insert({
      plan_id: details.planId,
      wallet_id: details.walletId,
      status: "pending",
      amount: details.amount,
      token: details.token,
      chain: details.chain,
      bank_name: details.bankName,
      account_number: details.accountNumber,
      account_name: details.accountName,
      fiat_transaction_id: details.fiatTransactionId,
      onchain_tx: details.onchainTx,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    logger.error("Failed to record fiat payout for alert", { module: "telegram-bot" }, insertError);

    return;
  }

  const { data: vendors, error: vendorError } = await supabase.from("vendors").select("chat_id");

  if (vendorError) {
    logger.error("Failed to load vendors for alert", { module: "telegram-bot" }, vendorError);
  }

  const parsedVendors = VendorChatListSchema.safeParse(vendors ?? []);

  const chatIds: number[] = parsedVendors.success
    ? parsedVendors.data.map((vendor) => vendor.chat_id)
    : [];

  const adminChat = getTelegramAdminChatId();
  const adminNumeric = adminChat ? Number(adminChat) : Number.NaN;

  if (chatIds.length === 0 && Number.isFinite(adminNumeric)) {
    chatIds.push(adminNumeric);
  }

  if (chatIds.length === 0) {
    logger.warn("No Telegram recipients for fiat payout alert", { module: "telegram-bot" });

    return;
  }

  const summary: PayoutSummary = {
    amount: details.amount,
    token: details.token,
    bank_name: details.bankName,
    account_number: details.accountNumber,
    account_name: details.accountName,
  };

  const text = formatPayoutSummary(summary);
  const keyboard = [[{ text: "Accept Payout", callback_data: `accept_payout:${inserted.id}` }]];
  const messageDetails: Array<{ chat_id: number; message_id: number }> = [];

  for (const chatId of chatIds) {
    const messageId = await sendTelegramMessage(chatId, text, {
      parseMode: "HTML",
      inlineKeyboard: keyboard,
    });

    if (messageId !== null) {
      messageDetails.push({ chat_id: chatId, message_id: messageId });
    }
  }

  if (messageDetails.length > 0) {
    await supabase.from("fiat_payouts").update({ message_details: messageDetails }).eq("id", inserted.id);
  }
}
