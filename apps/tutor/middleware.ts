import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { HTUTOR_UID_COOKIE } from "@/lib/cookies";
import { isAuthDisabled } from "@/lib/authDisabled";
import { isAuthPublicPath, isEmbedDemoRequest, loginRedirectPath } from "@/lib/auth/publicPaths";
import { hasAuthSessionCookie } from "@/lib/auth/sessionCookie";

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

  if (BACKEND_ORIGIN && pathname.startsWith("/api/") && !pathname.startsWith("/api/auth")) {
    return proxyApiToBackend(request);
  }

  if (isAuthDisabled()) {
    return withIdentityCookie(request, NextResponse.next());
  }

  if (isAuthPublicPath(pathname) || pathname.startsWith("/api/")) {
    return withOptionalDemoCookie(request, NextResponse.next());
  }

  if (isEmbedDemoRequest(pathname, search)) {
    return withOptionalDemoCookie(request, NextResponse.next());
  }

  if (!hasAuthSessionCookie(request)) {
    const url = new URL(loginRedirectPath(pathname, search), request.url);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
