import { NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { Helius } from "helius-sdk";

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_WEBHOOK_ID = process.env.HELIUS_WEBHOOK_ID;

export async function POST() {
  try {
    if (!HELIUS_API_KEY || !HELIUS_WEBHOOK_ID) {
      return NextResponse.json({ error: "Server configuration missing" }, { status: 500 });
    }

    // 1. Fetch all wallet addresses that don't have a webhook yet
    const { data: wallets, error: walletsError } = await supabase
      .from("wallets")
      .select("id, address")
      .eq("has_webhook", false);

    if (walletsError) {
      return NextResponse.json({ error: "Failed to fetch wallets" }, { status: 500 });
    }

    if (wallets.length === 0) {
      return NextResponse.json({ message: "No new wallets to add to webhook" }, { status: 200 });
    }

    const addresses = wallets.map(w => w.address);

    // 2. Append the new addresses to the existing webhook
    const helius = new Helius(HELIUS_API_KEY!);
    const updatedWebhook = await helius.appendAddressesToWebhook(HELIUS_WEBHOOK_ID, addresses);

    if (!updatedWebhook) {
      return NextResponse.json({ error: "Failed to update webhook with Helius" }, { status: 500 });
    }

    console.log(`Webhook updated successfully!`);

    // 3. Mark the wallets as having a webhook in the database
    const walletIds = wallets.map(w => w.id);
    const { error: updateError } = await supabase
      .from("wallets")
      .update({ has_webhook: true })
      .in("id", walletIds);

    if (updateError) {
      console.error("Failed to update webhook status for wallets:", updateError);
    }

    return NextResponse.json({ success: true, webhook: updatedWebhook }, { status: 200 });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "An unknown error occurred";
    console.error("Error updating webhook:", err);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
