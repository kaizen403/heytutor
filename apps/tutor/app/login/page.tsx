import { redirect } from "next/navigation";
import { auth, isDevLoginEnabled, isEmailAuthConfigured, isGoogleAuthConfigured } from "@/auth";
import { LoginScreen } from "@/features/account/LoginScreen";
import { isAuthDisabled } from "@/lib/authDisabled";
import { safeNextPath } from "@/lib/auth/publicPaths";

type LoginPageProps = {
  searchParams: Promise<{ next?: string; refused?: string; error?: string; google?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  if (isAuthDisabled()) {
    redirect(next);
  }
  const session = await auth();
  if (session?.user?.id && params.refused !== "1") {
    redirect(next);
  }

  return (
    <LoginScreen
      nextPath={next}
      googleEnabled={isGoogleAuthConfigured()}
      emailEnabled={isEmailAuthConfigured()}
      devLoginEnabled={isDevLoginEnabled()}
      refused={params.refused === "1"}
      error={params.error ?? null}
      autoGoogle={params.google === "1" && params.error !== "AccessDenied"}
    />
  );
}
