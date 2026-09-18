"use client";

import { LayoutDashboard, RefreshCw } from "lucide-react";
import { SiteButton } from "@/components/ui/site-button";
import type { OverviewPayload } from "@/lib/admin/types";
import { AdminPageHeader } from "../shared/components/AdminPageHeader";
import { EmptyState } from "../shared/components/EmptyState";
import { useAdminQuery } from "../shared/hooks/useAdminQuery";
import { formatRelativeTime } from "../shared/lib/format";
import { OverviewBreakdown } from "./OverviewBreakdown";
import { OverviewKpis } from "./OverviewKpis";
import { OverviewLatest } from "./OverviewLatest";

const POLL_MS = 60_000;

function statusCopy(
  loading: boolean,
  error: string | null,
  data: OverviewPayload | null,
): string {
  if (error === "unauthorized") return "Admin only";
  if (error === "not_found") return "Not found";
  if (error) return "Could not load";
  if (!data) return loading ? "Loading…" : "—";
  return loading ? "Refreshing…" : `Updated ${formatRelativeTime(data.generatedAt)}`;
}

export function OverviewView() {
  const { data, loading, error, refresh } = useAdminQuery<OverviewPayload>(
    "/api/admin/overview",
    POLL_MS,
  );

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Overview"
        description="Usage, verified-scene outcomes, and activity across the app."
        icon={<LayoutDashboard className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
        actions={
          <>
            <span className="type-accent-xs text-faint">{statusCopy(loading, error, data)}</span>
            <SiteButton variant="ghost" size="sm" onClick={refresh}>
              <RefreshCw
                className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
                aria-hidden
              />
              Refresh
            </SiteButton>
          </>
        }
      />

      {data ? (
        <>
          <OverviewKpis kpis={data.kpis} validatedTurns7d={data.outcomes7d.validated} />
          <OverviewBreakdown payload={data} />
          <OverviewLatest payload={data} />
        </>
      ) : error ? (
        <EmptyState
          title={error === "unauthorized" ? "Admins only" : "Could not load the overview"}
          description={
            error === "unauthorized"
              ? "Sign in with a staff account to see app analytics."
              : "The overview API did not answer. Try refreshing."
          }
          action={
            <SiteButton variant="ghost" size="sm" onClick={refresh}>
              Try again
            </SiteButton>
          }
        />
      ) : null}
    </div>
  );
}
