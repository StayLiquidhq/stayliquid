import { NextRequest, NextResponse } from "next/server";

import { optionalEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/rate-limit";
import { TelegramUpdateSchema, handleTelegramUpdate } from "@/lib/telegram-bot";

export const dynamic = "force-dynamic";

const WEBHOOK_LIMIT = 30;

const WEBHOOK_WINDOW_SECONDS = 60;

export async function POST(request: NextRequest): Promise<Response> {
  const secret = optionalEnv("TELEGRAM_WEBHOOK_SECRET");

  if (secret) {
    const header = request.headers.get("x-telegram-bot-api-secret-token");

    if (header !== secret) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  const body = await request.json().catch(() => null);
  const parsed = TelegramUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ ok: true });
  }

  const actorId = parsed.data.message?.from?.id ?? parsed.data.callback_query?.from?.id;

  if (actorId !== undefined) {
    const limited = await enforceRateLimit(request, {
      scope: "telegram-webhook",
      identity: String(actorId),
      limit: WEBHOOK_LIMIT,
      windowSeconds: WEBHOOK_WINDOW_SECONDS,
      failClosed: false,
    });

    if (limited) {
      logger.warn("Telegram webhook rate limited", { module: "telegram/webhook", actorId });

      return NextResponse.json({ ok: true });
    }
  }

  try {
    await handleTelegramUpdate(parsed.data);
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    logger.error("Telegram update handling failed", { module: "telegram/webhook" }, errorObj);
  }

  return NextResponse.json({ ok: true });
}
