import { attachFreePlan } from "@/lib/billing/attachFree";
import { prisma } from "@/lib/db/prisma";
import { mergeAnonymousUser } from "./mergeAnonymousUser";

export type SignedInProfile = {
  email?: string | null;
  name?: string | null;
  image?: string | null;
  emailVerified?: Date | null;
};

export async function findOrCreateSignedInUser(
  profile: SignedInProfile,
  anonymousUserId?: string | null,
): Promise<{ id: string; email: string | null; name: string | null; image: string | null }> {
  const email = profile.email?.trim().toLowerCase() || null;
  if (email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          name: profile.name ?? existing.name,
          image: profile.image ?? existing.image,
          emailVerified: profile.emailVerified ?? existing.emailVerified,
        },
      });
      await mergeAnonymousUser(prisma, {
        anonymousUserId,
        signedInUserId: existing.id,
      });
      void attachFreePlan({
        userId: existing.id,
        email: existing.email ?? email,
        name: profile.name ?? existing.name,
      }).catch((error) => {
        console.error("[billing] free attach on login failed", error);
      });
      return existing;
    }
  }

  const created = await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      email,
      name: profile.name ?? null,
      image: profile.image ?? null,
      emailVerified: profile.emailVerified ?? (email ? new Date() : null),
    },
  });
  await prisma.userSettings.upsert({
    where: { userId: created.id },
    create: { userId: created.id },
    update: {},
  });
  await mergeAnonymousUser(prisma, {
    anonymousUserId,
    signedInUserId: created.id,
  });
  void attachFreePlan({
    userId: created.id,
    email: created.email,
    name: created.name,
  }).catch((error) => {
    console.error("[billing] free attach on signup failed", error);
  });
  return created;
}
