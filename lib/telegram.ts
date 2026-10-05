import { z } from "zod";

import { optionalEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { Json } from "@/lib/supabase/types";

const TELEGRAM_API_BASE = "https://api.telegram.org";

export interface InlineKeyboardButton {
  [key: string]: Json | undefined;
  text: string;
  callback_data?: string;
  url?: string;
}

export interface SendMessageOptions {
  parseMode?: "HTML" | "Markdown";
  inlineKeyboard?: InlineKeyboardButton[][];
  disableWebPagePreview?: boolean;
}

type TelegramPayload = Record<string, Json | undefined>;

const TelegramResponseSchema = z.object({
  ok: z.boolean(),
  result: z.object({ message_id: z.number() }).optional(),
});

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function botMethodUrl(method: string): string | null {
  const token = optionalEnv("TELEGRAM_ACCESS_TOKEN");

  if (!token) return null;

  return `${TELEGRAM_API_BASE}/bot${token}/${method}`;
}

async function callTelegram(method: string, payload: TelegramPayload): Promise<Json | null> {
  const url = botMethodUrl(method);

  if (!url) {
    logger.warn("Telegram call skipped; bot not configured", { module: "telegram", method });

    return null;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logger.error("Telegram API call failed", { module: "telegram", method, status: response.status });

      return null;
    }

    // SAFETY: the Telegram Bot API always responds with a JSON object.
    return (await response.json()) as Json;
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    logger.error("Telegram API call error", { module: "telegram", method }, errorObj);

    return null;
  }
}

export function isTelegramConfigured(): boolean {
  return Boolean(optionalEnv("TELEGRAM_ACCESS_TOKEN"));
}

export function getTelegramAdminChatId(): string | null {
  return optionalEnv("TELEGRAM_ADMIN_CHAT_ID");
}

export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  options: SendMessageOptions = {}
): Promise<number | null> {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: options.parseMode,
    disable_web_page_preview: options.disableWebPagePreview,
    reply_markup: options.inlineKeyboard ? { inline_keyboard: options.inlineKeyboard } : undefined,
  } satisfies TelegramPayload;

  const body = await callTelegram("sendMessage", payload);
  const parsed = TelegramResponseSchema.safeParse(body);

  if (parsed.success && parsed.data.result) return parsed.data.result.message_id;

  return null;
}

export async function editTelegramMessage(
  chatId: number | string,
  messageId: number,
  text: string,
  options: SendMessageOptions = {}
): Promise<boolean> {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: options.parseMode,
    reply_markup: options.inlineKeyboard
      ? { inline_keyboard: options.inlineKeyboard }
      : { inline_keyboard: [] },
  } satisfies TelegramPayload;

  const body = await callTelegram("editMessageText", payload);
  const parsed = TelegramResponseSchema.safeParse(body);

  return parsed.success && parsed.data.ok;
}

export async function answerTelegramCallback(
  callbackQueryId: string,
  text?: string,
  showAlert = false
): Promise<void> {
  const payload = {
    callback_query_id: callbackQueryId,
    show_alert: showAlert,
    text,
  } satisfies TelegramPayload;

  await callTelegram("answerCallbackQuery", payload);
}

export async function setTelegramWebhook(url: string, secretToken?: string): Promise<boolean> {
  const payload = {
    url,
    secret_token: secretToken,
  } satisfies TelegramPayload;

  const body = await callTelegram("setWebhook", payload);
  const parsed = TelegramResponseSchema.safeParse(body);

  return parsed.success && parsed.data.ok;
}
