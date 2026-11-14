import { Skeleton } from "@/components/ui/skeleton";

export function AdminTableSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <span className="sr-only">{label}</span>
      <div className="border-b border-border bg-muted/40 px-4 py-4">
        <Skeleton className="h-4 w-1/3" />
      </div>
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-6 border-b border-border px-4 py-5 last:border-0"
        >
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-4 w-1/5" />
          <Skeleton className="ml-auto h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
