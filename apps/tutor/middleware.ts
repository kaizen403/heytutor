import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { HTUTOR_UID_COOKIE } from "@/lib/cookies";

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

export async function middleware(request: NextRequest) {
  if (BACKEND_ORIGIN && request.nextUrl.pathname.startsWith("/api/")) {
    return proxyApiToBackend(request);
  }

  const response = NextResponse.next();
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

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
