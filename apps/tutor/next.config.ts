import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import path from "path";
import { securityHeaderEntries } from "./lib/http/securityHeaders";
import { SENTRY_TUNNEL_PATH } from "./lib/obs/sentryTunnel";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaderEntries().filter(header => header.key !== "Content-Security-Policy"),
      },
    ];
  },
  // Deploy CI already built this commit. Do not let Next's extra lint pass
  // fail the EC2 restart the way `react-hooks/set-state-in-effect` did.
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ["@aws-sdk/client-s3"],
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
      // Next disables filesystem cache's extra in-memory generations in dev.
      // Replacing its options restores Webpack's default of five generations
      // alongside Next's own memory cache, retaining repeated route builds.
      const inheritedCache = config.cache && typeof config.cache === "object" && config.cache.type === "filesystem"
        ? config.cache
        : undefined;
      config.cache = {
        ...inheritedCache,
        type: "filesystem",
        cacheDirectory: path.join(process.cwd(), ".next/cache/webpack"),
        buildDependencies: {
          ...inheritedCache?.buildDependencies,
          config: [...new Set([
            ...(inheritedCache?.buildDependencies?.config ?? []),
            path.join(process.cwd(), "next.config.ts"),
          ])],
        },
      };
    }

    return config;
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  tunnelRoute: SENTRY_TUNNEL_PATH,
  silent: !process.env.SENTRY_AUTH_TOKEN,
  telemetry: false,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  // A missing org or a Sentry outage must not fail the EC2 build.
  errorHandler(error) {
    console.warn(`[sentry] build plugin: ${error.message}`);
  },
  webpack: {
    excludeServerRoutes: ["/api/health"],
    automaticVercelMonitors: false,
    treeshake: {
      removeDebugLogging: true,
      excludeReplayIframe: true,
      excludeReplayShadowDOM: true,
      excludeReplayCompressionWorker: true,
    },
  },
});
