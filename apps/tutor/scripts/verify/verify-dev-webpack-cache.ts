import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { securityHeaderEntries } from "../../lib/http/securityHeaders";
import { SENTRY_TUNNEL_PATH } from "../../lib/obs/sentryTunnel";

// Evaluate the real configuration, not a copied callback. No environment file,
// server, Sentry initialization, provider, filesystem cache or build is started.
const appRoot = path.resolve(import.meta.dirname, "../..");
const syntheticAppRoot = "/synthetic-workspace/apps/tutor";
const requireApp = createRequire(path.join(appRoot, "package.json"));
const configFile = path.join(appRoot, "next.config.ts");
const configCode = ts.transpileModule(readFileSync(configFile, "utf8"), {
  fileName: configFile,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;

type WebpackFixture = {
  cache?: unknown;
  output: { path: string; filename: string; chunkFilename: string };
  plugins: Array<{ sentinel: string }>;
  externalSentinel: { keep: boolean };
};
type LoadedConfig = {
  outputFileTracingRoot: string;
  headers(): Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>>;
  eslint: { ignoreDuringBuilds: boolean };
  serverExternalPackages: string[];
  transpilePackages: string[];
  webpack(config: WebpackFixture, options: { dev: boolean; isServer: boolean }): WebpackFixture;
};
type SentryOptions = {
  org?: string;
  project?: string;
  authToken?: string;
  tunnelRoute: string;
  silent: boolean;
  telemetry: boolean;
  sourcemaps: { disable: boolean };
  errorHandler(error: Error): void;
  webpack: {
    excludeServerRoutes: string[];
    automaticVercelMonitors: boolean;
    treeshake: Record<string, boolean>;
  };
};

function loadConfig(env: Partial<NodeJS.ProcessEnv> = {}) {
  const frozenEnv: NodeJS.ProcessEnv = { NODE_ENV: "development", ...env };
  const vmModule = { exports: { default: undefined as LoadedConfig | undefined } };
  let sentryOptions: SentryOptions | undefined;
  const warnings: string[] = [];
  vm.runInNewContext(configCode, {
    module: vmModule,
    exports: vmModule.exports,
    process: { cwd: () => syntheticAppRoot, env: Object.freeze(frozenEnv) },
    console: { warn: (message: string) => warnings.push(message) },
    require(id: string) {
      if (id === "path") return path;
      if (id === "./lib/http/securityHeaders") {
        return { securityHeaderEntries: () => securityHeaderEntries(frozenEnv) };
      }
      if (id === "./lib/obs/sentryTunnel") return { SENTRY_TUNNEL_PATH };
      if (id === "@sentry/nextjs/config") {
        return {
          withSentryConfig(config: LoadedConfig, options: SentryOptions) {
            sentryOptions = options;
            return config;
          },
        };
      }
      throw new Error(`Unexpected next.config import in free cache gate: ${id}`);
    },
  }, { filename: configFile, timeout: 1_000 });
  const config = vmModule.exports.default;
  assert.ok(config, "actual next.config default export is present");
  assert.ok(sentryOptions, "actual configuration retains its Sentry wrapper");
  return { config, sentryOptions, warnings };
}

function fixture(cache?: unknown): WebpackFixture {
  return {
    cache,
    output: {
      path: `${syntheticAppRoot}/.next/server`,
      filename: "[name].js",
      chunkFilename: "[name].js",
    },
    plugins: [{ sentinel: "existing-plugin" }],
    externalSentinel: { keep: true },
  };
}

function plain(value: unknown): unknown {
  // VM objects have different prototypes; compare serialized data, not realms.
  return JSON.parse(JSON.stringify(value));
}

test("installed Next's actual dev cache policy disables the extra in-memory generations", () => {
  const installedConfig = requireApp.resolve("next/dist/build/webpack-config.js");
  const source = ts.createSourceFile(
    installedConfig,
    readFileSync(installedConfig, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const expressions: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "maxMemoryGenerations") {
      expressions.push(node.initializer.getText(source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(expressions.length, 1, "recheck Next's cache policy if its implementation changes");
  assert.equal(vm.runInNewContext(expressions[0], { dev: true }), 0);
  assert.equal(vm.runInNewContext(expressions[0], { dev: false }), Infinity);
});

const environments = [
  { name: "ordinary dev without a measurement flag", env: {} },
  { name: "dev with measurement flag off", env: { HEYTUTOR_LOCAL_SPEND_CAP_REQUIRED: "0" } },
  { name: "dev with measurement flag on", env: { HEYTUTOR_LOCAL_SPEND_CAP_REQUIRED: "1" } },
];
const incomingCaches = [
  { name: "Next filesystem cache", cache: { type: "filesystem", maxMemoryGenerations: 0 } },
  { name: "memory cache", cache: { type: "memory" } },
  { name: "unset cache", cache: undefined },
];

for (const { name, env } of environments) {
  for (const incoming of incomingCaches) {
    test(`${name}: server keeps filesystem outputs without retaining memory generations (${incoming.name})`, () => {
      const { config } = loadConfig(env);
      const input = fixture(incoming.cache);
      const { output, plugins, externalSentinel } = input;
      assert.equal(config.webpack(input, { dev: true, isServer: true }), input);
      assert.deepEqual(plain(input.cache), {
        type: "filesystem",
        maxMemoryGenerations: 0,
        cacheDirectory: `${syntheticAppRoot}/.next/cache/webpack`,
        buildDependencies: { config: [`${syntheticAppRoot}/next.config.ts`] },
      });
      assert.equal(input.output, output, "route output configuration remains intact");
      assert.equal(input.plugins, plugins);
      assert.equal(input.externalSentinel, externalSentinel);
      assert.equal(input.output.path, `${syntheticAppRoot}/.next/server`);
    });
  }
}

for (const options of [
  { name: "dev client", dev: true, isServer: false },
  { name: "production server", dev: false, isServer: true },
  { name: "production client", dev: false, isServer: false },
]) {
  test(`${options.name}: the actual callback leaves all incoming configuration unchanged`, () => {
    for (const { env } of environments) {
      const { config } = loadConfig(env);
      const input = fixture({ type: "filesystem", maxMemoryGenerations: 42, sentinel: true });
      const before = JSON.stringify(input);
      const cache = input.cache;
      assert.equal(config.webpack(input, options), input);
      assert.equal(input.cache, cache);
      assert.equal(JSON.stringify(input), before);
    }
  });
}

test("filesystem-cache repair leaves tracing, package handling and security headers unchanged", async () => {
  const { config } = loadConfig({ NODE_ENV: "production" });
  assert.equal(config.outputFileTracingRoot, "/synthetic-workspace");
  assert.deepEqual(plain(config.eslint), { ignoreDuringBuilds: true });
  assert.deepEqual(plain(config.serverExternalPackages), ["@aws-sdk/client-s3"]);
  assert.deepEqual(plain(config.transpilePackages), [
    "@heytutor/design-tokens", "@heytutor/drawing", "@heytutor/tutor-core", "@heytutor/whiteboard", "tegaki",
  ]);
  assert.deepEqual(plain(await config.headers()), [{
    source: "/:path*",
    headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self), payment=(), usb=()" },
    ],
  }]);
});

test("Sentry settings and missing-token safety remain unchanged without initializing Sentry", () => {
  for (const authToken of [undefined, "synthetic-not-a-secret"]) {
    const { sentryOptions, warnings } = loadConfig({
      SENTRY_ORG: "synthetic-org",
      SENTRY_PROJECT: "synthetic-project",
      ...(authToken ? { SENTRY_AUTH_TOKEN: authToken } : {}),
    });
    assert.equal(sentryOptions.org, "synthetic-org");
    assert.equal(sentryOptions.project, "synthetic-project");
    assert.equal(sentryOptions.authToken, authToken);
    assert.equal(sentryOptions.tunnelRoute, "/monitoring");
    assert.equal(sentryOptions.silent, !authToken);
    assert.equal(sentryOptions.telemetry, false);
    assert.deepEqual(plain(sentryOptions.sourcemaps), { disable: !authToken });
    assert.deepEqual(plain(sentryOptions.webpack), {
      excludeServerRoutes: ["/api/health"],
      automaticVercelMonitors: false,
      treeshake: {
        removeDebugLogging: true,
        excludeReplayIframe: true,
        excludeReplayShadowDOM: true,
        excludeReplayCompressionWorker: true,
      },
    });
    sentryOptions.errorHandler(new Error("synthetic-build-failure"));
    assert.deepEqual(warnings, ["[sentry] build plugin: synthetic-build-failure"]);
  }
});
