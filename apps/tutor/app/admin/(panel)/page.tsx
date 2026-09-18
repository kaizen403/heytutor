import { LayoutDashboard } from "lucide-react";
import { AdminPageHeader } from "@/features/admin/shared/components/AdminPageHeader";
import { EmptyState } from "@/features/admin/shared/components/EmptyState";

export default function AdminOverviewPage() {
  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Overview"
        description="Usage, verified-scene outcomes, and activity across the app."
        icon={<LayoutDashboard className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
      />
      <EmptyState
        title="The overview dashboard is on its way"
        description="KPIs, turn-volume series, verified-scene outcome rates, degradation reasons, and the most active users will land here."
      />
    </div>
  );
}
