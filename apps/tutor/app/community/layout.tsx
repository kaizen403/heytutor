import Link from "next/link";
import { AccountAppShell } from "@/features/app-shell/AccountAppShell";
import { Brand } from "@/components/brand/Brand";
import { getUserId } from "@/lib/auth";
import { assertOnboardedStudent } from "@/lib/auth/requireOnboarded";

/**
 * Community is public. A signed in student browses it inside their own app
 * frame; a visitor gets a slim bar with a way in, and can watch everything.
 */
export default async function CommunityLayout({ children }: { children: React.ReactNode }) {
  if (await getUserId()) {
    await assertOnboardedStudent();
    return <AccountAppShell>{children}</AccountAppShell>;
  }
  return (
    <div className="fx-aurora-soft relative flex h-dvh max-h-dvh min-w-0 flex-col overflow-hidden">
      <header className="relative z-40 flex shrink-0 items-center gap-3 px-4 pb-1 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6">
        <Brand href="/community" size="sm" />
        <div className="ml-auto flex items-center gap-2">
          <Link href="/login?next=%2Fcommunity" className="btn btn-ghost btn-sm">
            Sign in
          </Link>
          <Link href="/login" className="btn btn-ice btn-sm">
            Ask your own question
          </Link>
        </div>
      </header>
      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
