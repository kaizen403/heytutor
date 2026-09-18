import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

/** The panel's shared "nothing here yet" card, in the playground's dashed style. */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="glass flex flex-col items-center gap-2 rounded-xl border-dashed px-6 py-10 text-center">
      {icon}
      <p className="text-sm font-medium text-frost">{title}</p>
      {description ? (
        <p className="max-w-md text-xs leading-relaxed text-soft">{description}</p>
      ) : null}
      {action}
    </div>
  );
}
