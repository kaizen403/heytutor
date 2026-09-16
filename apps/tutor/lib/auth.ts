import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { isAuthDisabled } from "@/lib/authDisabled";
import { HTUTOR_UID_COOKIE } from "@/lib/cookies";
import { prisma } from "@/lib/db/prisma";

const pendingUserEnsures = new Map<string, Promise<void>>();

export async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function getAnonymousCookieId(): Promise<string | null> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(HTUTOR_UID_COOKIE)?.value;
  if (existing) return existing;
  if (!isAuthDisabled()) return null;
  const minted = crypto.randomUUID();
  try {
    cookieStore.set(HTUTOR_UID_COOKIE, minted, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365 * 10,
    });
  } catch {
    // Server Components cannot set cookies; middleware already minted on the response.
  }
  return minted;
}

/**
 * Signed-in student id, or the embed/demo cookie identity when there is no
 * Auth.js session. While auth is off for testing, skip Auth.js entirely so a
 * leftover session cookie cannot crash the request.
 */
export async function getUserId(): Promise<string | null> {
  if (isAuthDisabled()) {
    return getAnonymousCookieId();
  }
  return (await getSessionUserId()) ?? (await getAnonymousCookieId());
}

export async function requireSessionUserId(): Promise<string | NextResponse> {
  if (isAuthDisabled()) {
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    await ensureUser(userId);
    return userId;
  }
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return userId;
}

export async function ensureUser(userId: string): Promise<void> {
  const pending = pendingUserEnsures.get(userId);
  if (pending) return pending;
  const ensure = ensureUserOnce(userId).finally(() => {
    if (pendingUserEnsures.get(userId) === ensure) pendingUserEnsures.delete(userId);
  });
  pendingUserEnsures.set(userId, ensure);
  return ensure;
}

async function ensureUserOnce(userId: string): Promise<void> {
  try {
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId },
      update: {},
    });
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      throw error;
    }
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!existing) throw error;
  }
}

/**
 * Returns the authenticated user id, or a 401 NextResponse if the user cookie
 * is missing. Use this to gate proxy routes that call paid upstream APIs.
 */
export async function requireUserId(): Promise<string | NextResponse> {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return userId;
}

/** Type guard that unwraps a `requireUserId` result into a plain userId. */
export function isAuthFailure(result: string | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}
