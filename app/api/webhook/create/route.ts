import { NextResponse } from "next/server";
import supabase from "@/utils/supabase";
import { Helius, WebhookType, TransactionType } from "helius-sdk";

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // Replace with your actual webhook receiving endpoint

export async function POST() {
  try {
    if (!HELIUS_API_KEY || !WEBHOOK_URL) {
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

    // 2. Create a new webhook with Helius
    const helius = new Helius(HELIUS_API_KEY!);
    const newWebhook = await helius.createWebhook({
  webhookType: WebhookType.ENHANCED,
  webhookURL: WEBHOOK_URL,
  accountAddresses: addresses,
  transactionTypes: [TransactionType.TRANSFER],
});

    if (!newWebhook || !newWebhook.webhookID) {
      return NextResponse.json({ error: "Failed to create webhook with Helius" }, { status: 500 });
    }

    // IMPORTANT: Store the newWebhook.webhookID securely, for example, in your environment variables
    // as HELIUS_WEBHOOK_ID for future updates.
    console.log(`Webhook created successfully! ID: ${newWebhook.webhookID}`);
    console.log("Please store this ID in your .env file as HELIUS_WEBHOOK_ID");

    // 3. Mark the wallets as having a webhook in the database
    const walletIds = wallets.map(w => w.id);
    const { error: updateError } = await supabase
      .from("wallets")
      .update({ has_webhook: true })
      .in("id", walletIds);

    if (updateError) {
      // If this fails, you might have wallets in the webhook that are not marked in your DB.
      // You'll need a way to reconcile this.
      console.error("Failed to update webhook status for wallets:", updateError);
    }

    return NextResponse.json({ success: true, webhook: newWebhook }, { status: 201 });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "An unknown error occurred";
    console.error("Error creating webhook:", err);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
