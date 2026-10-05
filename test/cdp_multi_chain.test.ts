import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  BASE_TOKENS,
  SOLANA_TOKENS,
  getTokenConfig,
  isSupportedChain,
  isSupportedToken,
  parseChainWithFallback,
  parseTokenWithFallback,
  parseTokenAmountToBaseUnits,
  formatBaseUnitsToTokenAmount,
} from "../lib/tokens";
import { extractClientMetadata } from "../lib/audit";
import { getOnChainSplBalance, USDC_MINT, USDT_MINT } from "../lib/solana";

test("Token Config: Base and Solana USDC/USDT have 6 decimals and correct addresses", () => {
  // Base
  assert.equal(BASE_TOKENS.USDC.decimals, 6);
  assert.equal(BASE_TOKENS.USDC.contractOrMint, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(BASE_TOKENS.USDT.decimals, 6);
  assert.equal(BASE_TOKENS.USDT.contractOrMint, "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2");

  // Solana
  assert.equal(SOLANA_TOKENS.USDC.decimals, 6);
  assert.equal(SOLANA_TOKENS.USDC.contractOrMint, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  assert.equal(SOLANA_TOKENS.USDT.decimals, 6);
  assert.equal(SOLANA_TOKENS.USDT.contractOrMint, "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");

  // getTokenConfig
  assert.equal(getTokenConfig("base", "USDC").contractOrMint, BASE_TOKENS.USDC.contractOrMint);
  assert.equal(getTokenConfig("solana", "USDT").contractOrMint, SOLANA_TOKENS.USDT.contractOrMint);
});

test("Token Parsing: type guards and fallback parsers handle valid and invalid inputs", () => {
  assert.equal(isSupportedChain("base"), true);
  assert.equal(isSupportedChain("solana"), true);
  assert.equal(isSupportedChain("ethereum"), false);

  assert.equal(isSupportedToken("USDC"), true);
  assert.equal(isSupportedToken("USDT"), true);
  assert.equal(isSupportedToken("ETH"), false);

  assert.equal(parseChainWithFallback("base"), "base");
  assert.equal(parseChainWithFallback("invalid"), "solana");
  assert.equal(parseChainWithFallback(null), "solana");

  assert.equal(parseTokenWithFallback("USDT"), "USDT");
  assert.equal(parseTokenWithFallback("invalid"), "USDC");
  assert.equal(parseTokenWithFallback(undefined), "USDC");
});

test("Unit Conversion: accurately converts between human-readable amounts and base units (6 decimals)", () => {
  // 100 USDC -> 100,000,000 atomic units
  const baseUnits = parseTokenAmountToBaseUnits(100.5, 6);
  assert.equal(baseUnits, 100500000n);

  const formatted = formatBaseUnitsToTokenAmount(baseUnits, 6);
  assert.equal(formatted, 100.5);

  // 0.000001 USDC -> 1 unit
  assert.equal(parseTokenAmountToBaseUnits(0.000001, 6), 1n);
  assert.equal(formatBaseUnitsToTokenAmount(1n, 6), 0.000001);
});

test("Audit Logger: extractClientMetadata computes deterministic device ID and extracts IP/UA", () => {
  const request = new NextRequest("https://app.stayliquid.io/api/test", {
    headers: {
      "x-forwarded-for": "198.51.100.42, 10.0.0.1",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    },
  });

  const metadata = extractClientMetadata(request);

  assert.equal(metadata.ipAddress, "198.51.100.42");
  assert.equal(metadata.userAgent, "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
  assert.equal(typeof metadata.deviceId, "string");
  assert.equal(metadata.deviceId.length, 64); // SHA-256 hex string

  // Same IP + UA produces identical deterministic deviceId
  const metadata2 = extractClientMetadata(request);
  assert.equal(metadata2.deviceId, metadata.deviceId);
});

test("Solana SPL On-Chain: queries live USDC and USDT balances correctly", async () => {
  const knownSolanaWallet = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

  const usdcBal = await getOnChainSplBalance(knownSolanaWallet, USDC_MINT);
  const usdtBal = await getOnChainSplBalance(knownSolanaWallet, USDT_MINT);

  console.log("✔ Live On-Chain Solana Balances:", {
    wallet: knownSolanaWallet,
    usdc: usdcBal,
    usdt: usdtBal,
  });

  assert.equal(typeof usdcBal, "number");
  assert.equal(typeof usdtBal, "number");
  assert.ok(usdcBal >= 0);
  assert.ok(usdtBal >= 0);
});
