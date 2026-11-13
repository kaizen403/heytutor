import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

/** The panel's shared empty and error state. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <Card className="rounded-lg py-0 shadow-none">
      <CardContent className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        {icon}
        <p className="text-sm font-medium text-frost">{title}</p>
        {description ? (
          <p className="max-w-md text-xs leading-relaxed text-soft">
            {description}
          </p>
        ) : null}
        {action}
      </CardContent>
    </Card>
  );
}
