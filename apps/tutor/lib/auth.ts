import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { isAuthDisabled } from "@/lib/authDisabled";
import { HTUTOR_UID_COOKIE } from "@/lib/cookies";
import { prisma } from "@/lib/db/prisma";

const pendingUserEnsures = new Map<string, Promise<void>>();

async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

async function getAnonymousCookieId(): Promise<string | null> {
  if (!isAuthDisabled()) return null;
  const cookieStore = await cookies();
  const existing = cookieStore.get(HTUTOR_UID_COOKIE)?.value;
  if (existing) return existing;
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
 * Signed-in student id, or the device cookie only while AUTH_DISABLED=1.
 * When the login gate is on, a raw htutor_uid must not become a user id.
 */
export async function getUserId(): Promise<string | null> {
  if (isAuthDisabled()) {
    return getAnonymousCookieId();
  }
  return getSessionUserId();
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

/** Type guard for a route helper that returns either a user id or a 401 response. */
export function isAuthFailure(result: string | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}
