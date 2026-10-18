import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    // Type safety is enforced by the standalone `tsc --noEmit` gate (see
    // package.json `typecheck`) — Next's in-build TS worker OOMs on the
    // ~550-file app + generated SDK types.
    ignoreBuildErrors: true,
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
