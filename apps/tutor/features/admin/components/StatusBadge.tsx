import { cn } from "@/lib/utils";
import type { ItemStatus } from "../lib/progressStorage";

const STATUS_CONFIG: Record<
  Exclude<ItemStatus, "pending">,
  { label: string; bg: string; text: string; border: string }
> = {
  accepted: {
    label: "Accepted",
    bg: "rgba(89, 175, 212, 0.14)",
    text: "#A5D6EC",
    border: "rgba(89, 175, 212, 0.32)",
  },
  rejected: {
    label: "Rejected",
    bg: "rgba(224, 104, 88, 0.15)",
    text: "#E06858",
    border: "rgba(224, 104, 88, 0.32)",
  },
  "needs-improvement": {
    label: "Needs work",
    bg: "rgba(202, 229, 241, 0.06)",
    text: "rgba(240, 245, 247, 0.68)",
    border: "rgba(202, 229, 241, 0.20)",
  },
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
        "type-accent-xs inline-flex shrink-0 items-center rounded-full border px-2 py-1",
        className,
      )}
      style={{ backgroundColor: config.bg, color: config.text, borderColor: config.border }}
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
