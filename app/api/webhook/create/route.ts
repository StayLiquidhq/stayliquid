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
      return NextResponse.json({ message: "All wallets are active under CDP monitoring" }, { status: 200 });
    }

    const walletIds = wallets.map((w) => w.id);

    const { error: updateError } = await supabase
      .from("wallets")
      .update({ has_webhook: true })
      .in("id", walletIds);

    if (updateError) {
      logger.error("Failed to update webhook status for wallets", { module: "webhook/create" }, updateError);
    }

    logger.info("Marked wallets as active for CDP webhook monitoring", {
      module: "webhook/create",
      count: walletIds.length,
    });

    return NextResponse.json(
      {
        success: true,
        message: "Wallets registered under CDP project-level webhook monitoring.",
        count: walletIds.length,
      },
      { status: 200 }
    );
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    logger.error("Error synchronizing CDP webhook status", { module: "webhook/create" }, errorObj);

    return NextResponse.json({ error: errorObj.message }, { status: 500 });
  }
}
