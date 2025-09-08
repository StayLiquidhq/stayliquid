import { Helius } from "helius-sdk";

/**
 * Check the status of a Solana transaction by signature using Helius SDK.
 *
 * @param {string} signature - The transaction signature to check.
 * @param {Helius} helius - A Helius SDK instance.
 * @returns {Promise<"success" | "pending" | "failed">}
 */
export async function getTransactionStatus(signature: string, helius: Helius): Promise<"success" | "pending" | "failed"> {
    try {
        const status = await helius.connection.getSignatureStatus(signature, {
            searchTransactionHistory: true
        });

        // No info at all means pending
        if (!status || !status.value) {
            return "pending";
        }

        const confirmationStatus = status.value.confirmationStatus;
        const err = status.value.err;

        if (err) {
            return "failed"; // Transaction explicitly failed
        }

        if (confirmationStatus === "finalized" || confirmationStatus === "confirmed") {
            return "success"; // Confirmed or finalized → success
        }

        return "pending"; // Still processing
    } catch (error: any) {
        console.error(`Error checking transaction status: ${error.message}`);
        return "pending"; // Fallback to pending on RPC errors
    }
}
