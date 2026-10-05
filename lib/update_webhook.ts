import supabase from "@/utils/supabase";
import { logger } from "./logger";


export async function updateWebhookWithNewAddress(newAddress: string): Promise<void> {
  try {
    const { error } = await supabase
      .from("wallets")
      .update({ has_webhook: true })
      .eq("address", newAddress);

    if (error) {
      logger.error("Failed to update has_webhook status in database", {
        module: "webhook/cdp",
        newAddress,
      }, error);
    } else {
      logger.debug("Successfully marked wallet as webhook-enabled for CDP", {
        module: "webhook/cdp",
        newAddress,
      });
    }
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    logger.error("Error setting webhook status for wallet", {
      module: "webhook/cdp",
      newAddress,
    }, errorObj);
  }
}
