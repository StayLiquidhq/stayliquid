import { requireEnv } from "./env";
import type { SupportedChain } from "./tokens";

export function getFeesPayerWallet(): string {
  return requireEnv("FEES_PAYER_WALLET");
}

export function getPlatformFeesWallet(chain: SupportedChain): string {
  if (chain === "base") {
    return requireEnv("BASE_PLATFORM_FEES_WALLET");
  }

  return requireEnv("SOLANA_PLATFORM_FEES_WALLET");
}
