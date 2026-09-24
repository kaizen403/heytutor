const WINDOW_MS = 60_000;
const AUTH_WINDOW_MS = 10 * 60_000;

export const IP_RATE_LIMITS = {
  auth: { limit: 40, windowMs: AUTH_WINDOW_MS },
  account: { limit: 60, windowMs: WINDOW_MS },
  boards: { limit: 180, windowMs: WINDOW_MS },
  trace: { limit: 90, windowMs: WINDOW_MS },
  suggestions: { limit: 30, windowMs: WINDOW_MS },
} as const;

export type IpRateBucket = keyof typeof IP_RATE_LIMITS;

interface WindowHits {
  hits: number[];
}

const buckets = new Map<string, WindowHits>();
let nowFn: () => number = Date.now;

export function setRateLimitNowForTests(now: () => number): void {
  nowFn = now;
}

export function resetIpRateLimitsForTests(): void {
  buckets.clear();
  nowFn = Date.now;
}

export function clientIpFromForwarded(
  forwarded: string | undefined,
  remoteAddress: string | undefined,
): string {
  if (forwarded?.trim()) {
    const hops = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return last.replace(/^::ffff:/, "");
  }
  return (remoteAddress ?? "unknown").replace(/^::ffff:/, "");
}

export function rateLimitBucketForPath(pathname: string): IpRateBucket | null {
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return "auth";
  if (pathname === "/api/account" || pathname.startsWith("/api/account/")) return "account";
  if (pathname === "/api/boards" || pathname.startsWith("/api/boards/")) return "boards";
  if (pathname === "/api/trace" || pathname.startsWith("/api/trace/")) return "trace";
  if (pathname === "/api/home-suggestions") return "suggestions";
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
