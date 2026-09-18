import type { Metadata } from "next";
import { UserDetailView } from "@/features/admin/users/UserDetailView";

export const metadata: Metadata = {
  title: "User · Admin",
};

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  return <UserDetailView userId={userId} />;
}
