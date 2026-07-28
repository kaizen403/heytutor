import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { HTUTOR_UID_COOKIE } from "@/lib/cookies";
import { prisma } from "@/lib/db/prisma";

const pendingUserEnsures = new Map<string, Promise<void>>();

export async function getUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(HTUTOR_UID_COOKIE)?.value ?? null;
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
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      throw error;
    }
    // Concurrent first requests can both observe a missing anonymous user.
    // The winning insert is sufficient; verify it before treating the unique
    // conflict as the successful idempotent outcome.
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
