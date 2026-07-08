import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { HTUTOR_UID_COOKIE } from "@/lib/cookies";
import { prisma } from "@/lib/db/prisma";

export async function getUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(HTUTOR_UID_COOKIE)?.value ?? null;
}

export async function ensureUser(userId: string): Promise<void> {
  await prisma.user.upsert({
    where: { id: userId },
    create: { id: userId },
    update: {},
  });
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
