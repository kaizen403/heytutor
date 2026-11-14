"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OverviewPayload } from "@/lib/admin/types";
import { AdminPageHeader } from "../shared/components/AdminPageHeader";
import { EmptyState } from "../shared/components/EmptyState";
import { useAdminQuery } from "../shared/hooks/useAdminQuery";
import { formatRelativeTime } from "../shared/lib/format";
import { OverviewAiCredits } from "./OverviewAiCredits";
import { OverviewBreakdown } from "./OverviewBreakdown";
import { OverviewCost } from "./OverviewCost";
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
  return loading
    ? "Refreshing…"
    : `Updated ${formatRelativeTime(data.generatedAt)}`;
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
        description="Usage, inference cost, verified-scene outcomes, and activity across the app."
        actions={
          <>
            <span className="type-accent-xs text-faint">
              {statusCopy(loading, error, data)}
            </span>
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw
                className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
                aria-hidden
              />
              Refresh
            </Button>
          </>
        }
      />

      {data ? (
        <>
          <OverviewAiCredits credits={data.aiCredits} />
          <OverviewKpis
            kpis={data.kpis}
            validatedTurns7d={data.outcomes7d.validated}
          />
          <OverviewCost cost={data.cost} />
          <OverviewBreakdown payload={data} />
          <OverviewLatest payload={data} />
        </>
      ) : error ? (
        <EmptyState
          title={
            error === "unauthorized"
              ? "Admins only"
              : "Could not load the overview"
          }
          description={
            error === "unauthorized"
              ? "Sign in with a staff account to see app analytics."
              : "The overview API did not answer. Try refreshing."
          }
          action={
            <Button variant="outline" size="sm" onClick={refresh}>
              Try again
            </Button>
          }
        />
      ) : null}
    </div>
  );
}
