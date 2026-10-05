export type SupportedToken = "USDC" | "USDT";

export type SupportedChain = "base" | "solana";

export interface TokenConfig {
  symbol: SupportedToken;
  name: string;
  decimals: number;
  contractOrMint: string;
  cdpNetwork: string;
}

export const BASE_TOKENS: Record<SupportedToken, TokenConfig> = {
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    contractOrMint: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    cdpNetwork: "base",
  },
  USDT: {
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    contractOrMint: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    cdpNetwork: "base",
  },
};

export const SOLANA_TOKENS: Record<SupportedToken, TokenConfig> = {
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    contractOrMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    cdpNetwork: "solana",
  },
  USDT: {
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    contractOrMint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    cdpNetwork: "solana",
  },
};

export function isSupportedToken(value: string): value is SupportedToken {
  return value === "USDC" || value === "USDT";
}

export function isSupportedChain(value: string): value is SupportedChain {
  return value === "base" || value === "solana";
}

export function getTokenConfig(chain: SupportedChain, token: SupportedToken): TokenConfig {
  if (chain === "base") {
    return BASE_TOKENS[token];
  }

  return SOLANA_TOKENS[token];
}

export function parseChainWithFallback(
  chain: string | null | undefined,
  fallback: SupportedChain = "solana"
): SupportedChain {
  if (chain && isSupportedChain(chain)) {
    return chain;
  }

  return fallback;
}

export function parseTokenWithFallback(
  token: string | null | undefined,
  fallback: SupportedToken = "USDC"
): SupportedToken {
  if (token && isSupportedToken(token)) {
    return token;
  }

  return fallback;
}

export function parseTokenAmountToBaseUnits(amount: number, decimals: number): bigint {
  const factor = 10 ** decimals;

  return BigInt(Math.round(amount * factor));
}

export function formatBaseUnitsToTokenAmount(amount: bigint | string | number, decimals: number): number {
  const numericAmount = Number(amount);
  const factor = 10 ** decimals;

  return numericAmount / factor;
}
