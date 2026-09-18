import { Users } from "lucide-react";
import { AdminPageHeader } from "@/features/admin/shared/components/AdminPageHeader";
import { EmptyState } from "@/features/admin/shared/components/EmptyState";

export default function AdminUsersPage() {
  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Manage Users"
        description="Everyone using the app, what they are asking, and how much they run."
        icon={<Users className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
      />
      <EmptyState
        title="The users table is on its way"
        description="Search, sort, and drill into any user: their boards, every question they have run, outcomes, spend, and recent chat."
      />
    </div>
  );
}
