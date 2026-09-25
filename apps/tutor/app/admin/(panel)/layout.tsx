import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAuthDisabled } from "@/lib/authDisabled";
import { isAdminEmail } from "@/lib/auth/admins";
import { AdminNav } from "@/features/admin/nav/AdminNav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin panel",
};

/**
 * The panel shares one gate with the playground page: open only for AUTH_DISABLED
 * local testing, staff/admins only once the login gate is on. The playground lives outside
 * this route group on purpose — it uses its own wide workspace and navigation,
 * so it must not inherit this nav.
 */
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  if (!isAuthDisabled()) {
    const session = await auth();
    if (!(await isAdminEmail(session?.user?.email))) {
      redirect("/login?next=/admin");
    }
  }

  return (
    <div className="site-theme fx-aurora-soft min-h-screen">
      <AdminNav />
      <main className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-12 pt-5">{children}</main>
    </div>
  );
}
