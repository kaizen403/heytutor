import { AccountAppShell } from "@/features/app-shell/AccountAppShell";
import { assertOnboardedStudent } from "@/lib/auth/requireOnboarded";

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertOnboardedStudent();
  return <AccountAppShell>{children}</AccountAppShell>;
}
