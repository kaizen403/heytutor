import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { HTUTOR_UID_COOKIE } from "@/lib/cookies";
import { isAuthDisabled } from "@/lib/authDisabled";
import { isAuthPublicPath, isEmbedDemoRequest, loginRedirectPath } from "@/lib/auth/publicPaths";
import { hasAuthSessionCookie } from "@/lib/auth/sessionCookie";
import { applySecurityHeaders } from "@/lib/http/securityHeaders";
import { clientIpFromForwarded, consumeIpRateLimit, rateLimitBucketForPath } from "@/lib/http/ipRateLimit";

const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN?.replace(/\/$/, "");

async function proxyApiToBackend(request: NextRequest): Promise<NextResponse> {
  if (!BACKEND_ORIGIN) {
    return NextResponse.next();
  }

  const target = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, BACKEND_ORIGIN);
  const headers = new Headers(request.headers);
  headers.delete("host");

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  const upstream = await fetch(target, init);
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-encoding");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

function withSecurityHeaders(response: NextResponse): NextResponse {
  applySecurityHeaders(response.headers);
  return response;
}

function rateLimitResponse(request: NextRequest): NextResponse | null {
  const bucket = rateLimitBucketForPath(request.nextUrl.pathname);
  if (!bucket) return null;
  const ip = clientIpFromForwarded(
    request.headers.get("x-forwarded-for") ?? undefined,
    request.headers.get("x-real-ip") ?? undefined,
  );
  const consumed = consumeIpRateLimit({ ip, bucket });
  if (consumed.ok) return null;
  const response = NextResponse.json({ error: "rate_limited" }, { status: 429 });
  response.headers.set("retry-after", String(consumed.retryAfterSec));
  return withSecurityHeaders(response);
}

function withIdentityCookie(request: NextRequest, response: NextResponse): NextResponse {
  const existing = request.cookies.get(HTUTOR_UID_COOKIE)?.value;
  if (!existing) {
    response.cookies.set(HTUTOR_UID_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365 * 10,
    });
  }
  return response;
}

function withOptionalDemoCookie(request: NextRequest, response: NextResponse): NextResponse {
  const pathname = request.nextUrl.pathname;
  const search = request.nextUrl.search;
  if (!isEmbedDemoRequest(pathname, search)) {
    return response;
  }
  return withIdentityCookie(request, response);
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const limited = rateLimitResponse(request);
  if (limited) return limited;

  if (BACKEND_ORIGIN && pathname.startsWith("/api/") && !pathname.startsWith("/api/auth")) {
    return withSecurityHeaders(await proxyApiToBackend(request));
  }

  if (isAuthDisabled()) {
    return withIdentityCookie(request, withSecurityHeaders(NextResponse.next()));
  }

  if (isAuthPublicPath(pathname) || pathname.startsWith("/api/")) {
    return withOptionalDemoCookie(request, withSecurityHeaders(NextResponse.next()));
  }

  if (isEmbedDemoRequest(pathname, search)) {
    return withOptionalDemoCookie(request, withSecurityHeaders(NextResponse.next()));
  }

  if (!hasAuthSessionCookie(request)) {
    const url = new URL(loginRedirectPath(pathname, search), request.url);
    return withSecurityHeaders(NextResponse.redirect(url));
  }

  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
