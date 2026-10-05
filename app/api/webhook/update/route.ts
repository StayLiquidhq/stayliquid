import { NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { logger } from "@/lib/logger";

export async function POST() {
  try {
    const { data: wallets, error: walletsError } = await supabase
      .from("wallets")
      .select("id, address")
      .eq("has_webhook", false);

    if (walletsError) {
      return NextResponse.json({ error: "Failed to fetch wallets" }, { status: 500 });
    }

    if (!wallets || wallets.length === 0) {
      return NextResponse.json({ message: "No new wallets pending webhook activation" }, { status: 200 });
    }

    const walletIds = wallets.map((w) => w.id);

    const { error: updateError } = await supabase
      .from("wallets")
      .update({ has_webhook: true })
      .in("id", walletIds);

    if (updateError) {
      logger.error("Failed to update webhook status for wallets", { module: "webhook/update" }, updateError);
    }

    return NextResponse.json({ success: true, count: walletIds.length }, { status: 200 });
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    logger.error("Error in webhook/update", { module: "webhook/update" }, errorObj);

    return NextResponse.json({ error: errorObj.message }, { status: 500 });
  }
}
