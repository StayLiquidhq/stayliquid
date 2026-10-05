import { NextRequest, NextResponse } from "next/server";

import supabase from "@/utils/supabase";
import { getCorsHeaders, handleCorsPreflight } from "@/lib/cors";
import { optionalEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function sseFrame(event: string, data: string): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${data}\n\n`);
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

export async function GET(request: NextRequest): Promise<Response> {
  const origin = request.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const token = authHeader.slice("Bearer ".length).trim();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);

  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const userId = authData.user.id;
  const pollMs = Number(optionalEnv("WALLET_EVENTS_POLL_MS") ?? 4000);
  const heartbeatMs = Number(optionalEnv("WALLET_EVENTS_HEARTBEAT_MS") ?? 15000);

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let cursor = new Date().toISOString();

      const cleanup = () => {
        closed = true;

        if (pollTimer) clearInterval(pollTimer);

        if (heartbeatTimer) clearInterval(heartbeatTimer);
      };

      const emit = (chunk: Uint8Array) => {
        if (closed) return;

        try {
          controller.enqueue(chunk);
        } catch {
          cleanup();
        }
      };

      emit(encoder.encode("retry: 5000\n\n"));

      pollTimer = setInterval(async () => {
        if (closed) return;

        try {
          const { data, error } = await supabase
            .from("wallet_events")
            .select("id, wallet_id, plan_id, transaction_id, event_type, payload, created_at")
            .eq("user_id", userId)
            .gt("created_at", cursor)
            .order("created_at", { ascending: true })
            .limit(50);

          if (error) {
            logger.warn("Wallet events stream query failed", { module: "wallets/events", userId }, error);

            return;
          }

          for (const event of data ?? []) {
            emit(sseFrame("wallet_event", JSON.stringify(event)));
            cursor = event.created_at;
          }
        } catch (error) {
          const errorObj = error instanceof Error ? error : new Error(String(error));
          logger.warn("Wallet events stream error", { module: "wallets/events", userId }, errorObj);
        }
      }, pollMs);

      heartbeatTimer = setInterval(() => {
        emit(encoder.encode(": heartbeat\n\n"));
      }, heartbeatMs);

      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;

      if (pollTimer) clearInterval(pollTimer);

      if (heartbeatTimer) clearInterval(heartbeatTimer);
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
