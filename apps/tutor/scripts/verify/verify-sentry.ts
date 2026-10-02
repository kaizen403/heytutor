import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isAuthPublicPath } from "../../lib/auth/publicPaths";
import { rateLimitBucketForPath } from "../../lib/http/ipRateLimit";
import {
  isSentryDisabled,
  redactUrl,
  scrubSecrets,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  sentryBeforeSendLog,
  sentryClientDsn,
  sentryDataCollection,
  sentryServerDsn,
  sentryTracesSampler,
  type SentryScrubEvent,
} from "../../lib/obs/sentryPrivacy";
import { SENTRY_TUNNEL_PATH } from "../../lib/obs/sentryTunnel";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

assert(SENTRY_TUNNEL_PATH === "/monitoring", "the tunnel path is the fixed /monitoring route");
assert(isAuthPublicPath("/monitoring"), "the tunnel is public so logged-out errors can be reported");
assert(isAuthPublicPath("/monitoring/extra"), "a tunnel subpath stays public");
assert(!isAuthPublicPath("/settings"), "settings is still not public");
assert(rateLimitBucketForPath("/monitoring") === "sentry", "the tunnel has its own rate limit");

assert(sentryServerDsn(env({})) === undefined, "an empty DSN leaves the server SDK off");
assert(
  sentryServerDsn(env({ NEXT_PUBLIC_SENTRY_DSN: "https://public@example.ingest.sentry.io/1" })) ===
    "https://public@example.ingest.sentry.io/1",
  "the server can use the public DSN",
);
assert(
  sentryServerDsn(env({
    SENTRY_DSN: "https://server@example.ingest.sentry.io/1",
    NEXT_PUBLIC_SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
  })) === "https://server@example.ingest.sentry.io/1",
  "SENTRY_DSN wins on the server",
);
assert(
  sentryServerDsn(env({ SENTRY_DSN: "https://server@example.ingest.sentry.io/1", SENTRY_ENABLED: "0" })) ===
    undefined,
  "SENTRY_ENABLED=0 stops the server SDK",
);
assert(isSentryDisabled(env({ SENTRY_ENABLED: "false" })), "SENTRY_ENABLED=false is the same switch");
assert(
  sentryClientDsn(env({ SENTRY_DSN: "https://server@example.ingest.sentry.io/1" })) === undefined,
  "the browser SDK does not see the server-only DSN",
);
assert(
  sentryClientDsn(env({ NEXT_PUBLIC_SENTRY_DSN: " https://public@example.ingest.sentry.io/1 " })) ===
    "https://public@example.ingest.sentry.io/1",
  "the browser DSN is trimmed",
);

const collection = sentryDataCollection();
assert(collection.userInfo === false, "Sentry must not collect user identity");
assert(collection.cookies === false, "Sentry must not collect cookies");
assert(collection.httpBodies.length === 0, "Sentry must not collect request or response bodies");
assert(collection.urlQueryParams === false, "Sentry must not collect query strings");
assert(collection.databaseQueryData === false, "Sentry must not collect database parameters");
assert(collection.genAI.inputs === false && collection.genAI.outputs === false, "Sentry must not collect model text");
assert(collection.stackFrameVariables === false, "Sentry must not collect local variables");

assert(sentryTracesSampler({ name: "GET /api/health" }, env({ NODE_ENV: "production" })) === 0, "health is not traced");
assert(
  sentryTracesSampler({ name: "POST /monitoring" }, env({ NODE_ENV: "production" })) === 0,
  "the tunnel is not traced",
);
assert(sentryTracesSampler({ name: "GET /api/chat" }, env({ NODE_ENV: "development" })) === 0, "dev traces stay off");
assert(sentryTracesSampler({ name: "GET /api/chat" }, env({ NODE_ENV: "production" })) === 0.1, "production traces are sampled");

assert(scrubSecrets("Bearer sk_live_abc token=secret") === "Bearer [redacted] token=[redacted]", "secrets are scrubbed");
assert(
  redactUrl("https://app.accelute.co/api/tts/ws?ticket=abc&speed=1") ===
    "https://app.accelute.co/api/tts/ws?speed=1",
  "ticket query values are removed and other params stay",
);

const event: SentryScrubEvent = {
  message: "failed token=raw",
  request: {
    url: "https://app.accelute.co/api/chat?ticket=abc&board=1",
    data: "What is the derivative of x^2?",
    cookies: { session: "secret" },
    headers: { authorization: "Bearer sk_live_abc", "content-type": "application/json" },
    query_string: "ticket=abc&board=1",
  },
  user: { id: "user-1", email: "student@school.edu", ip_address: "203.0.113.8", username: "ada" },
  exception: { values: [{ value: "provider rejected sk_live_abc" }] },
  breadcrumbs: [
    { category: "console", message: "student asked about integrals" },
    { category: "fetch", data: { url: "https://api.example/v1?api_key=secret", request_body: "lesson text" } },
  ],
};

const scrubbed = scrubSentryEvent(event);
assert(scrubbed.message === "failed token=[redacted]", "event messages lose secrets");
assert(scrubbed.request?.data == null, "request bodies are dropped");
assert(scrubbed.request?.cookies == null, "request cookies are dropped");
assert(scrubbed.request?.headers?.authorization == null, "authorization headers are dropped");
assert(scrubbed.request?.headers?.["content-type"] === "application/json", "ordinary headers stay");
assert(scrubbed.request?.query_string === "board=1", "ticket is removed from the query string");
assert(scrubbed.request?.url === "https://app.accelute.co/api/chat?board=1", "ticket is removed from the URL");
assert(scrubbed.user?.id === "user-1", "an id can stay");
assert(scrubbed.user?.email == null, "email is dropped");
assert(scrubbed.user?.ip_address == null, "ip address is dropped");
assert(scrubbed.user?.username == null, "username is dropped");
assert(scrubbed.exception?.values?.[0]?.value === "provider rejected [redacted]", "exception text loses secrets");
assert(scrubbed.breadcrumbs?.length === 1, "console breadcrumbs are dropped");
assert(scrubbed.breadcrumbs?.[0]?.data?.request_body == null, "breadcrumb bodies are dropped");
assert(
  scrubbed.breadcrumbs?.[0]?.data?.url === "https://api.example/v1",
  "api keys are removed from breadcrumb URLs",
);
assert(scrubSentryBreadcrumb({ category: "console", message: "question text" }) == null, "console crumbs are refused");
assert(sentryBeforeSendLog({ message: "[tutor:planner] 3 villagers" }) == null, "tutor debug logs stay on the machine");
assert(
  sentryBeforeSendLog({ message: "[http] GET /api/chat 200 12ms token=raw" })?.message ===
    "[http] GET /api/chat 200 12ms token=[redacted]",
  "http access logs are kept and secrets are scrubbed",
);

const root = resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");
const nextConfig = read("next.config.ts");
assert(nextConfig.includes("tunnelRoute: SENTRY_TUNNEL_PATH"), "the browser SDK tunnels through this origin");
assert(nextConfig.includes("disable: !process.env.SENTRY_AUTH_TOKEN"), "source map upload waits for an auth token");
assert(nextConfig.includes("errorHandler"), "a Sentry outage during build must not fail the deploy");
assert(read("instrumentation.ts").includes("onRequestError"), "server request errors are captured");
assert(read("server.ts").includes("captureTtsRelayFailure"), "the speech relay reports upstream failures");
assert(read("sentry.server.config.ts").includes("consoleLoggingIntegration"), "server console lines are Sentry logs");
assert(read("sentry.server.config.ts").includes("sentryBeforeSendLog"), "server logs are scrubbed");
assert(read("lib/obs/sentryNode.ts").includes("consoleLoggingIntegration"), "the custom server sends console logs");
assert(
  read("instrumentation-client.ts").includes('levels: ["warn", "error"]'),
  "the browser sends warn and error, not every console line",
);
assert(read("app/global-error.tsx").includes("captureException"), "render crashes are captured");

console.log("✓ sentry stays off without a DSN and strips lesson text, cookies, and secrets");
