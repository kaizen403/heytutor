import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const HTUTOR_UID_COOKIE = "htutor_uid";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const existing = request.cookies.get(HTUTOR_UID_COOKIE)?.value;

  if (!existing) {
    response.cookies.set(HTUTOR_UID_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365 * 10,
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
