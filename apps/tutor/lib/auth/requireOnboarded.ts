import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { accountIsRefused } from "./ageGate";
import { isAuthDisabled } from "@/lib/authDisabled";
import { isAgeBand } from "@/lib/account/types";
import { safeNextPath } from "./publicPaths";

async function loadSignedInUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return prisma.user.findUnique({ where: { id: session.user.id } });
}

export async function assertOnboardedStudent(): Promise<void> {
  if (isAuthDisabled()) return;
  const user = await loadSignedInUser();
  if (!user) return;
  if (accountIsRefused(isAgeBand(user.ageBand) ? user.ageBand : null)) {
    redirect("/login?refused=1");
  }
  if (!user.ageBand || !user.onboardingCompletedAt) {
    const next = safeNextPath((await headers()).get("x-request-path"));
    redirect(next === "/" ? "/onboarding" : `/onboarding?next=${encodeURIComponent(next)}`);
  }
}
