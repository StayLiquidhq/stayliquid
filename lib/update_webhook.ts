import supabase from "@/utils/supabase";
import { Helius } from "helius-sdk";

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_WEBHOOK_ID = process.env.HELIUS_WEBHOOK_ID;

export async function updateWebhookWithNewAddress(newAddress: string) {
  if (!HELIUS_API_KEY || !HELIUS_WEBHOOK_ID) {
    console.error("Helius API key or Webhook ID is not configured.");
    return;
  }

  try {
    const helius = new Helius(HELIUS_API_KEY);
    await helius.appendAddressesToWebhook(HELIUS_WEBHOOK_ID, [newAddress]);
    console.log(`Successfully added ${newAddress} to the webhook.`);

    // Mark the wallet as having a webhook in the database
    const { error } = await supabase
      .from("wallets")
      .update({ has_webhook: true })
      .eq("address", newAddress);

    if (error) {
      console.error(`Failed to update webhook status for ${newAddress}:`, error);
    }
  } catch (error) {
    console.error(`Failed to append address to webhook:`, error);
  }
}
