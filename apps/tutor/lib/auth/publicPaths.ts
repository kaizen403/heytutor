export const AUTH_PUBLIC_PATHS = [
  "/login",
  "/api/auth",
  "/favicon.ico",
  "/favicon.svg",
  "/site.webmanifest",
] as const;

export function isAuthPublicPath(pathname: string): boolean {
  if (AUTH_PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return true;
  }
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/fonts/")) return true;
  if (/\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml|woff|woff2)$/i.test(pathname)) return true;
  return false;
}

/** Marketing embed / landing showcase: read-only demo, no login. */
export function isEmbedDemoRequest(pathname: string, search: string): boolean {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (params.get("embed") !== "1") return false;
  return pathname === "/" || pathname.startsWith("/c/");
}

export function loginRedirectPath(pathname: string, search: string): string {
  const next = `${pathname}${search}`;
  if (!next || next === "/" || next.startsWith("/login")) return "/login";
  return `/login?next=${encodeURIComponent(next)}`;
}

export function safeNextPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.startsWith("/login") || value.startsWith("/api/")) return fallback;
  return value;
}
