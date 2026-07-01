import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  eslint: {
    ignoreDuringBuilds: true,
  },
  transpilePackages: [
    "@heytutor/design-tokens",
    "@heytutor/drawing",
    "@heytutor/tutor-core",
    "@heytutor/whiteboard",
    "tegaki",
  ],
  webpack: (config, { dev, isServer }) => {
    // Custom server (server.ts) reads compiled route modules from .next/server in dev.
    // In-memory webpack cache can leave those files missing → ENOENT / PageNotFoundError.
    if (dev && isServer) {
      config.cache = {
        type: "filesystem",
        cacheDirectory: path.join(process.cwd(), ".next/cache/webpack"),
        buildDependencies: {
          config: [path.join(process.cwd(), "next.config.ts")],
        },
      };
    }

    return config;
  },
};

export default nextConfig;
