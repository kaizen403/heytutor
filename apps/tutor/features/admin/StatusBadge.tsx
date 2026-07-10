import { cn } from "@/lib/utils";
import type { ItemStatus } from "./progressStorage";

const STATUS_CONFIG: Record<
  Exclude<ItemStatus, "pending">,
  { label: string; bg: string; text: string }
> = {
  accepted: { label: "Accepted", bg: "#DCFCE7", text: "#16A34A" },
  rejected: { label: "Rejected", bg: "#FEE2E2", text: "#DC2626" },
  "needs-improvement": { label: "Needs improvement", bg: "#FEF3C7", text: "#D97706" },
};

interface StatusBadgeProps {
  status: ItemStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  if (status === "pending") {
    return null;
  }

  const config = STATUS_CONFIG[status];

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        className,
      )}
      style={{ backgroundColor: config.bg, color: config.text }}
    >
      {config.label}
    </span>
  );
}

export function statusLabel(status: ItemStatus): string {
  if (status === "pending") {
    return "Pending";
  }
  return STATUS_CONFIG[status].label;
}
