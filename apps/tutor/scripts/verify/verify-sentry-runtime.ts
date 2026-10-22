import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as privacy from "../../lib/obs/sentryPrivacy";

type Env = Record<string, string | undefined>;
type Init = {
  environment?: string;
  beforeSend: (event: Record<string, unknown>) => unknown;
  beforeSendLog: (log: Record<string, unknown>) => unknown;
  beforeBreadcrumb: (breadcrumb: Record<string, unknown>) => unknown;
  tracesSampler?: (context: { name: string }) => number;
};
const app = resolve(import.meta.dirname, "../..");
const syntheticDsn = "https://synthetic@example.ingest.sentry.io/1";
let checks = 0;
function check(actual: unknown, expected: unknown, message: string) {
  assert.equal(actual, expected, message);
  checks++;
}

/** Evaluate the actual entrypoints with a transport-free SDK and isolated runtime. */
function loadEntry(relative: string, env: Env, hostname?: string) {
  const inits: Init[] = [];
  let captures = 0;
  const location = hostname === undefined ? undefined : { hostname };
  const sdk = {
    init: (options: Init) => inits.push(options),
    consoleLoggingIntegration: () => ({ name: "ConsoleLogs" }),
    captureException: () => { captures++; },
    captureRequestError: () => { captures++; },
    captureRouterTransitionStart: () => { captures++; },
    flush: async () => true,
  };
  const cache = new Map<string, unknown>();
  function load(file: string): Record<string, unknown> {
    const filename = file.endsWith(".ts") ? file : `${file}.ts`;
    const cached = cache.get(filename);
    if (cached) return cached as Record<string, unknown>;
    const compiledModule = { exports: {} };
    cache.set(filename, compiledModule.exports);
    const mutation = process.env.SENTRY_RUNTIME_MUTATION_SOURCE;
    const sourceFile = mutation && filename === resolve(app, "lib/obs/sentryRuntime.ts") ? mutation : filename;
    const code = ts.transpileModule(readFileSync(sourceFile, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, {
      exports: compiledModule.exports, module: compiledModule,
      require: (name: string) => {
        if (name === "@sentry/nextjs") return sdk;
        if (name.endsWith("sentryPrivacy")) return { ...privacy,
          isSentryDisabled: () => privacy.isSentryDisabled(env as NodeJS.ProcessEnv),
          sentryServerDsn: () => privacy.sentryServerDsn(env as NodeJS.ProcessEnv),
          sentryClientDsn: (values?: NodeJS.ProcessEnv) => privacy.sentryClientDsn(values ?? env as NodeJS.ProcessEnv),
          sentryTracesSampler: (context: { name: string }, values?: NodeJS.ProcessEnv) => privacy.sentryTracesSampler(context, values ?? env as NodeJS.ProcessEnv),
        };
        if (name.startsWith("@/")) return load(resolve(app, name.slice(2)));
        if (name.startsWith(".")) return load(resolve(dirname(filename), name));
        throw new Error(`Unexpected runtime fixture dependency: ${name}`);
      },
      process: { env, once: () => {} }, location, console,
    }, { filename });
    return compiledModule.exports;
  }
  return { exports: load(resolve(app, relative)), inits, location, captures: () => captures };
}

const serverEntries = ["lib/obs/sentryNode.ts", "sentry.server.config.ts", "sentry.edge.config.ts"];
const serverCases: Array<[string, Env, boolean]> = [
  ["local production build with a DSN", { NODE_ENV: "production" }, false],
  ["local dev with a production marker", { NODE_ENV: "development", SENTRY_ENVIRONMENT: "production" }, false],
  ["test with a production marker", { NODE_ENV: "test", SENTRY_ENVIRONMENT: "production" }, false],
  ["lab production build", { NODE_ENV: "production", SENTRY_ENVIRONMENT: "lab" }, false],
  ["development production build", { NODE_ENV: "production", SENTRY_ENVIRONMENT: "development" }, false],
  ["explicit production deployment", { NODE_ENV: "production", SENTRY_ENVIRONMENT: "production" }, true],
  ["false-disabled production deployment", { NODE_ENV: "production", SENTRY_ENVIRONMENT: "production", SENTRY_ENABLED: "false" }, false],
  ["disabled production deployment", { NODE_ENV: "production", SENTRY_ENVIRONMENT: "production", SENTRY_ENABLED: "0" }, false],
];
for (const entry of serverEntries) {
  for (const [name, runtime, enabled] of serverCases) {
    const env: Env = { SENTRY_DSN: syntheticDsn, NEXT_PUBLIC_SENTRY_DSN: syntheticDsn, ...runtime };
    const fixture = loadEntry(entry, env);
    check(fixture.inits.length, enabled ? 1 : 0, `${entry}: ${name} initializes only in production`);
    if (entry.includes("sentryNode")) {
      (fixture.exports.captureTtsRelayFailure as (error: Error) => void)(new Error("synthetic relay error"));
      check(fixture.captures(), enabled ? 1 : 0, `${name}: custom relay reporting respects the runtime`);
    }
    if (!enabled) continue;
    const options = fixture.inits[0]!;
    check(options.environment, "production", `${entry}: actual deployment environment is tagged`);
    const cleaned = options.beforeSend({ environment: "development", message: "synthetic token=secret", user: { email: "fixture@example.test" } }) as { user?: unknown; message?: string; environment?: string };
    check(cleaned.environment, "production", `${entry}: final event uses the actual runtime environment`);
    check(options.beforeSendLog({ message: "[sentry] failed-turn recovery unavailable; events remain queued" }) !== null, true, `${entry}: production generic logs remain enabled`);
    check(options.beforeBreadcrumb({ category: "navigation", message: "synthetic" }) !== null, true, `${entry}: production safe breadcrumbs remain enabled`);
    check(cleaned.user, undefined, `${entry}: final hook still scrubs identity`);
    check(cleaned.message?.includes("secret"), false, `${entry}: final hook still scrubs credentials`);
    if (options.tracesSampler) check(options.tracesSampler({ name: "GET /synthetic" }), entry.includes("sentryNode") ? 0 : 0.1, `${entry}: production tracing retains its prior sampling`);
    env.SENTRY_ENVIRONMENT = "lab";
    check(options.beforeSend({ message: "synthetic" }), null, `${entry}: final event hook fails closed outside production`);
    check(options.beforeSendLog({ level: "error", message: "synthetic" }), null, `${entry}: final log hook fails closed outside production`);
    check(options.beforeBreadcrumb({ category: "navigation", message: "synthetic" }), null, `${entry}: final breadcrumb hook fails closed outside production`);
    if (entry.includes("sentryNode")) {
      (fixture.exports.captureTtsRelayFailure as (error: Error) => void)(new Error("synthetic relay error"));
      check(fixture.captures(), 1, "custom relay capture rechecks the live runtime");
    }
    if (options.tracesSampler) check(options.tracesSampler({ name: "GET /synthetic" }), 0, `${entry}: final trace hook fails closed outside production`);
  }
  check(loadEntry(entry, { NODE_ENV: "production", SENTRY_ENVIRONMENT: "production" }).inits.length, 0, `${entry}: no DSN remains off`);
}

const browserCases: Array<[string, Env, string | undefined, boolean]> = [
  ["unmarked production build", { NODE_ENV: "production", SENTRY_ENVIRONMENT: "production" }, "app.accelute.co", false],
  ["local marked production build", { NODE_ENV: "production", NEXT_PUBLIC_SENTRY_ENVIRONMENT: "production" }, "localhost", false],
  ["loopback marked production build", { NODE_ENV: "production", NEXT_PUBLIC_SENTRY_ENVIRONMENT: "production" }, "127.0.0.1", false],
  ["development site marked production build", { NODE_ENV: "production", NEXT_PUBLIC_SENTRY_ENVIRONMENT: "production" }, "dev.accelute.co", false],
  ["lab marked production build", { NODE_ENV: "production", NEXT_PUBLIC_SENTRY_ENVIRONMENT: "production" }, "lab.accelute.co", false],
  ["production lookalike host", { NODE_ENV: "production", NEXT_PUBLIC_SENTRY_ENVIRONMENT: "production" }, "app.accelute.co.example.test", false],
  ["dev marked build", { NODE_ENV: "development", NEXT_PUBLIC_SENTRY_ENVIRONMENT: "production" }, "app.accelute.co", false],
  ["missing browser location", { NODE_ENV: "production", NEXT_PUBLIC_SENTRY_ENVIRONMENT: "production" }, undefined, false],
  ["production browser", { NODE_ENV: "production", NEXT_PUBLIC_SENTRY_ENVIRONMENT: "production" }, "app.accelute.co", true],
];
for (const [name, runtime, hostname, enabled] of browserCases) {
  const env: Env = { NEXT_PUBLIC_SENTRY_DSN: syntheticDsn, ...runtime };
  const fixture = loadEntry("instrumentation-client.ts", env, hostname);
  check(fixture.inits.length, enabled ? 1 : 0, `${name}: browser initializes only at the production deployment`);
  (fixture.exports.onRouterTransitionStart as () => void)();
  check(fixture.captures(), enabled ? 1 : 0, `${name}: router hook respects deployment`);
  if (!enabled) continue;
  const options = fixture.inits[0]!;
  check(options.environment, "production", "browser event environment comes from the deployment marker");
  check(options.tracesSampler!({ name: "GET /synthetic" }), 0.1, "production browser traces are sampled");
  fixture.location!.hostname = "localhost";
  (fixture.exports.onRouterTransitionStart as () => void)();
  check(fixture.captures(), 1, "router capture rechecks live hostname");
  check(options.beforeSend({ message: "synthetic" }), null, "browser final event hook rejects local hosts");
  check(options.beforeSendLog({ level: "error", message: "synthetic" }), null, "browser final log hook rejects local hosts");
  check(options.beforeBreadcrumb({ category: "navigation", message: "synthetic" }), null, "browser final breadcrumb hook rejects local hosts");
  check(options.tracesSampler!({ name: "GET /synthetic" }), 0, "browser final trace hook rejects local hosts");
}
for (const [name, runtime, enabled] of serverCases) {
  const fixture = loadEntry("instrumentation.ts", runtime);
  (fixture.exports.onRequestError as () => void)();
  check(fixture.captures(), enabled && runtime.SENTRY_ENABLED !== "0" ? 1 : 0, `${name}: request-error hook respects deployment`);
}
console.log(`Sentry runtime guard: ${checks} checks passed; SDK init and hooks mocked, no network`);
