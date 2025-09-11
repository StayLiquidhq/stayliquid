import { CdpClient } from "@coinbase/cdp-sdk";

// Check required CDP environment variables
if (
  !process.env.CDP_API_KEY_ID ||
  !process.env.CDP_API_KEY_SECRET ||
  !process.env.CDP_WALLET_SECRET
) {
  throw new Error(
    "Missing required CDP environment variables. Please ensure CDP_API_KEY_ID, CDP_API_KEY_SECRET, and CDP_WALLET_SECRET are set."
  );
}

// Initialize the CDP client with verified environment variables
const cdp = new CdpClient();

export default cdp;
