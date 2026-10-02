/** Browser cookies authorize an account, never a different site's actions. */
export function hasAllowedMutationOrigin(request: Request): boolean {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith("/api/") || !["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return true;
  // Auth.js checks its own CSRF tokens; webhook handlers verify signed bytes.
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/") ||
      pathname === "/api/billing/webhook" || pathname === "/api/billing/razorpay/webhook") return true;

  const expected = new URL(process.env.AUTH_URL || process.env.NEXT_PUBLIC_SITE_URL || request.url).origin;
  const origin = request.headers.get("origin");
  if (origin !== null) return origin === expected;
  const referer = request.headers.get("referer");
  if (referer !== null) {
    try { return new URL(referer).origin === expected; }
    catch { return false; }
  }
  const site = request.headers.get("sec-fetch-site");
  // Native clients can omit browser headers, but still need route authentication.
  // A browser claiming only same-site is insufficient: sibling origins differ.
  return site === null || site === "same-origin" || site === "none";
}
