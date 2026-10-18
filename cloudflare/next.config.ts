import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    // Fail the build on type errors — this is a production migration,
    // type safety is part of "features must be complete".
    ignoreBuildErrors: false,
  },
  images: {
    // R2-served media and remote brand logos; unoptimized keeps Workers simple.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
    unoptimized: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
