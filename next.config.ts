import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@maxmind/geoip2-node", "@coinbase/cdp-sdk"],
};

export default nextConfig;
