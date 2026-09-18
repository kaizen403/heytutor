import type { Metadata } from "next";
import { UsersView } from "@/features/admin/users/UsersView";

export const metadata: Metadata = {
  title: "Manage Users · Admin",
};

export default function AdminUsersPage() {
  return <UsersView />;
}
