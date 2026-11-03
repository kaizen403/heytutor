import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import path from "path";
import { securityHeaderEntries } from "./lib/http/securityHeaders";
import { SENTRY_TUNNEL_PATH } from "./lib/obs/sentryTunnel";
import { renderFingerprint } from "./lib/lecture-export/buildRenderFingerprint.mjs";
import { resolveBuildIdentity } from "./lib/client/buildIdentity.mjs";

// Production deploys build into a release directory beside the live one
// (deploy/aws/tutor-release.sh), then point .next at it. Anything else builds
// into .next as before.
const distDir = process.env.NEXT_DIST_DIR?.trim();
if (distDir && distDir !== ".next-a" && distDir !== ".next-b") {
  throw new Error(`NEXT_DIST_DIR must be .next-a or .next-b, not ${distDir}`);
}

const nextConfig: NextConfig = {
  ...(distDir ? { distDir } : {}),
  env: {
    NEXT_PUBLIC_LECTURE_RENDER_HASH: renderFingerprint(path.resolve(process.cwd(), "../..")),
    // The deployed commit, inlined into the browser bundle and the server alike,
    // so a tab left open across a deploy can tell (lib/client/staleBuild.ts).
    NEXT_PUBLIC_HEYTUTOR_BUILD_ID: resolveBuildIdentity(path.resolve(process.cwd(), "../..")),
  },
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
    // Source gates use the Node fallback; browser bundles must never contain
    // its filesystem traversal, even when an env transform is absent.
    if (!isServer) {
      config.resolve ??= {};
      config.resolve.alias = {
        ...config.resolve.alias,
        "./sourceRenderFingerprint$": path.join(process.cwd(), "lib/lecture-export/sourceRenderFingerprint.browser.ts"),
      };
    }
    // Custom server (server.ts) reads compiled route modules from .next/server in dev.
    // In-memory webpack cache can leave those files missing → ENOENT / PageNotFoundError.
    if (dev && isServer) {
      // Next disables filesystem cache's extra in-memory generations in dev.
      // Preserve that limit and Next's inherited cache identity while adding
      // our filesystem location and config dependency.
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
