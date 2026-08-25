import { cn } from "@/lib/utils";
import type { ItemStatus } from "../lib/progressStorage";

const STATUS_CONFIG: Record<
  Exclude<ItemStatus, "pending">,
  { label: string; bg: string; text: string }
> = {
  accepted: { label: "Accepted", bg: "rgba(201, 201, 210, 0.12)", text: "#C9C9D2" },
  rejected: { label: "Rejected", bg: "rgba(224, 104, 88, 0.15)", text: "#E06858" },
  "needs-improvement": { label: "Needs improvement", bg: "#1E1E21", text: "#A6A6AE" },
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
