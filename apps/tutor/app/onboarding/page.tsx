import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { OnboardingScreen } from "@/features/account/OnboardingScreen";
import { isAuthDisabled } from "@/lib/authDisabled";
import { safeNextPath } from "@/lib/auth/publicPaths";

type OnboardingPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  if (isAuthDisabled()) {
    redirect(next);
  }
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?next=/onboarding");
  }
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (user?.onboardingCompletedAt && user.ageBand) {
    redirect(next);
  }

  return (
    <OnboardingScreen
      initialName={user?.name ?? session.user.name ?? ""}
      nextPath={next}
    />
  );
}
