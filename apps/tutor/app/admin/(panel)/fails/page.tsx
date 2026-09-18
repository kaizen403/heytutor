import { TriangleAlert } from "lucide-react";
import { AdminPageHeader } from "@/features/admin/shared/components/AdminPageHeader";
import { EmptyState } from "@/features/admin/shared/components/EmptyState";

export default function AdminFailsPage() {
  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Fails"
        description="Turns that taught without a verified diagram, and why."
        icon={<TriangleAlert className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
      />
      <EmptyState
        title="The failure report is on its way"
        description="Text-only and retry-required turns with their degradation reasons and issue codes, so the weakest links in the scene pipeline are one glance away."
      />
    </div>
  );
}
