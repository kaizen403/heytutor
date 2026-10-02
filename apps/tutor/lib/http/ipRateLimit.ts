import { SENTRY_TUNNEL_PATH } from "../obs/sentryTunnel";

const WINDOW_MS = 60_000;
const AUTH_WINDOW_MS = 10 * 60_000;

const IP_RATE_LIMITS = {
  paid: { limit: 120, windowMs: WINDOW_MS },
  auth: { limit: 40, windowMs: AUTH_WINDOW_MS },
  account: { limit: 60, windowMs: WINDOW_MS },
  billing: { limit: 60, windowMs: WINDOW_MS },
  boards: { limit: 180, windowMs: WINDOW_MS },
  trace: { limit: 90, windowMs: WINDOW_MS },
  suggestions: { limit: 30, windowMs: WINDOW_MS },
  // Shared school NATs can burst. Still bounds an open tunnel.
  sentry: { limit: 120, windowMs: WINDOW_MS },
} as const;

export type IpRateBucket = keyof typeof IP_RATE_LIMITS;

interface WindowHits {
  hits: number[];
}

const buckets = new Map<string, WindowHits>();
let nowFn: () => number = Date.now;

export function resetIpRateLimitsForTests(): void {
  buckets.clear();
  nowFn = Date.now;
}

function normalizeIp(ip: string): string {
  return ip.replace(/^::ffff:/, "").trim();
}

/** The local reverse proxy reaches this process on loopback, so a loopback hop is never the client. */
function isLoopback(ip: string): boolean {
  const normalized = normalizeIp(ip);
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

export function clientIpFromForwarded(
  forwarded: string | undefined,
  remoteAddress: string | undefined,
): string {
  const hops = (forwarded ?? "")
    .split(",")
    .map((part) => normalizeIp(part))
    .filter(Boolean);
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const hop = hops[index];
    if (hop && !isLoopback(hop)) return hop;
  }
  const remote = normalizeIp(remoteAddress ?? "");
  if (remote && !isLoopback(remote)) return remote;
  return hops[hops.length - 1] || remote || "unknown";
}

export function rateLimitBucketForPath(pathname: string): IpRateBucket | null {
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return "auth";
  if (pathname === "/api/account" || pathname.startsWith("/api/account/")) return "account";
  // Provider delivery IPs are shared; signed webhooks retain their retry path.
  if (pathname.startsWith("/api/billing/") && !pathname.endsWith("/webhook")) return "billing";
  if (pathname === "/api/boards" || pathname.startsWith("/api/boards/")) return "boards";
  if (pathname === "/api/trace" || pathname.startsWith("/api/trace/")) return "trace";
  if (pathname === "/api/home-suggestions") return "suggestions";
  if (["/api/chat", "/api/stt", "/api/tts/stream", "/api/tts/ws-ticket", "/api/extract-question", "/api/visual-need", "/api/dsa-teaching-policy", "/api/board-name"].includes(pathname)) return "paid";
  if (pathname === SENTRY_TUNNEL_PATH || pathname.startsWith(`${SENTRY_TUNNEL_PATH}/`)) return "sentry";
  return null;
}

export function consumeIpRateLimit(input: {
  ip: string;
  bucket: IpRateBucket;
  limit?: number;
  windowMs?: number;
}): { ok: true } | { ok: false; retryAfterSec: number } {
  const policy = IP_RATE_LIMITS[input.bucket];
  const limit = input.limit ?? policy.limit;
  const windowMs = input.windowMs ?? policy.windowMs;
  const now = nowFn();
  if (buckets.size >= 10_000) {
    for (const [entry, state] of buckets) if ((state.hits.at(-1) ?? 0) <= now - AUTH_WINDOW_MS) buckets.delete(entry);
    if (buckets.size >= 10_000 && !buckets.has(`${input.bucket}:${input.ip}`)) return { ok: false, retryAfterSec: 60 };
  }
  const key = `${input.bucket}:${input.ip}`;
  const state = buckets.get(key) ?? { hits: [] };
  const cutoff = now - windowMs;
  state.hits = state.hits.filter((at) => at > cutoff);
  if (state.hits.length >= limit) {
    buckets.set(key, state);
    const oldest = state.hits[0] ?? now;
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
  }
  state.hits.push(now);
  buckets.set(key, state);
  return { ok: true };
}
