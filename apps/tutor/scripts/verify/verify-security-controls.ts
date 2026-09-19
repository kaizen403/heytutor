import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isAuthDisabled } from "../../lib/authDisabled";
import { consumeIpRateLimit, rateLimitBucketForPath, resetIpRateLimitsForTests } from "../../lib/http/ipRateLimit";
import { contentSecurityPolicy, securityHeaderEntries } from "../../lib/http/securityHeaders";
import {
  resetTtsWsConnectionsForTests,
  tryAcquireTtsWsConnection,
  TTS_WS_MAX_CONNECTIONS_PER_USER,
  ttsWsCharsWithinCeiling,
} from "../../lib/tts/wsRelayLimits";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

assert(!isAuthDisabled(env({}), "development"), "unset AUTH_DISABLED keeps the login gate on");
assert(!isAuthDisabled(env({ AUTH_DISABLED: "1" }), "production"), "production refuses AUTH_DISABLED");

const auth = read("lib/auth.ts");
assert(
  !auth.includes("?? (await getAnonymousCookieId())"),
  "getUserId must not fall back to htutor_uid when the login gate is on",
);
assert(
  auth.includes("if (!isAuthDisabled()) return null"),
  "the anonymous cookie helper must refuse to mint or return an id while auth is on",
);

const flags = read("lib/billing/flags.ts");
assert(flags.includes("LECTURE_LAB_TOKEN"), "lecture-lab bypass is token-gated");
assert(!flags.includes("isAutumnEnabled(env)) return false"), "lecture-lab must not open because Autumn is off");

const headers = securityHeaderEntries();
const names = new Set(headers.map((header) => header.key));
assert(names.has("Content-Security-Policy"), "CSP is set");
assert(names.has("X-Content-Type-Options"), "nosniff is set");
assert(names.has("Referrer-Policy"), "Referrer-Policy is set");
assert(names.has("Permissions-Policy"), "Permissions-Policy is set");
assert(contentSecurityPolicy().includes("frame-ancestors"), "CSP limits who may frame the tutor");
assert(contentSecurityPolicy().includes("https://accelute.co"), "the landing origin may frame the embed");

assert(read("next.config.ts").includes("securityHeaderEntries"), "next.config applies security headers");
assert(read("middleware.ts").includes("applySecurityHeaders"), "middleware applies security headers");
assert(read("middleware.ts").includes("consumeIpRateLimit"), "middleware rate-limits login/account/board/trace");

assert(rateLimitBucketForPath("/api/auth/callback/google") === "auth", "auth callbacks are rate-limited");
assert(rateLimitBucketForPath("/api/account/me") === "account", "account routes are rate-limited");
assert(rateLimitBucketForPath("/api/boards/abc") === "boards", "board routes are rate-limited");
assert(rateLimitBucketForPath("/api/trace/event") === "trace", "trace routes are rate-limited");
assert(rateLimitBucketForPath("/api/health") === null, "health is not credit-shaped-limited");

resetIpRateLimitsForTests();
for (let i = 0; i < 40; i += 1) {
  assert(consumeIpRateLimit({ ip: "1.1.1.1", bucket: "auth" }).ok, "auth budget allows the first 40");
}
assert(!consumeIpRateLimit({ ip: "1.1.1.1", bucket: "auth" }).ok, "the 41st auth attempt is 429");
assert(consumeIpRateLimit({ ip: "2.2.2.2", bucket: "auth" }).ok, "a second IP has its own budget");

assert(ttsWsCharsWithinCeiling(0, 48_000), "a full connection budget is allowed");
assert(!ttsWsCharsWithinCeiling(47_000, 2_000), "the connection ceiling is hard");
resetTtsWsConnectionsForTests();
for (let i = 0; i < TTS_WS_MAX_CONNECTIONS_PER_USER; i += 1) {
  assert(tryAcquireTtsWsConnection("user-a"), "a user may open up to the socket cap");
}
assert(!tryAcquireTtsWsConnection("user-a"), "a fourth TTS socket for one user is refused");

const media = read("lib/object-store/serveMedia.ts");
assert(!media.includes("object.contentType"), "media responses must not echo the stored Content-Type");
assert(media.includes("contentTypeForStoredKey"), "media Content-Type comes from the key allowlist");
assert(media.includes("content-disposition"), "media sets Content-Disposition");

const unit = read("../../deploy/aws/setup-vm.sh");
assert(unit.includes("User=heytutor"), "the systemd unit must not run as root");
assert(!unit.includes("User=root"), "setup-vm must not install a root unit");
assert(unit.includes("Strict-Transport-Security"), "Caddy sets HSTS");
assert(read("../../deploy/aws/deploy.sh").includes("User=heytutor"), "deploys keep the service off root");

console.log("✓ security controls fail closed: auth, lecture-lab, headers, rate limit, WS caps, media types");
