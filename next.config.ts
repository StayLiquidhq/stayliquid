import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    COINGECKO_API_URL: process.env.COINGECKO_API_URL,
    COINGECKO_API_KEY: process.env.COINGECKO_API_KEY,
    HELIUS_API_KEY: process.env.HELIUS_API_KEY,
    WEBHOOK_URL: process.env.WEBHOOK_URL,
    HELIUS_WEBHOOK_ID: process.env.HELIUS_WEBHOOK_ID,
    DEV_WALLET_PRIVATE_KEY: process.env.DEV_WALLET_PRIVATE_KEY,
    PAYOUT_PRIVATE_KEY: process.env.PAYOUT_PRIVATE_KEY,
    USDC_MINT: process.env.USDC_MINT,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
