import { NextRequest, NextResponse } from "next/server";

import { optionalEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { TelegramUpdateSchema, handleTelegramUpdate } from "@/lib/telegram-bot";

export const dynamic = "force-dynamic";

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

  try {
    await handleTelegramUpdate(parsed.data);
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    logger.error("Telegram update handling failed", { module: "telegram/webhook" }, errorObj);
  }

  return NextResponse.json({ ok: true });
}
