import { cookies } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { HTUTOR_UID_COOKIE } from "@/middleware";

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
