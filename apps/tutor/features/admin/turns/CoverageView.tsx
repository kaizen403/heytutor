"use client";

import { useState, type FormEvent } from "react";
import { ChartColumn, RefreshCw } from "lucide-react";
import { SiteButton } from "@/components/ui/site-button";
import type { CoverageReport, CoverageWindow } from "@/lib/admin/coverage";
import { AdminPageHeader } from "../shared/components/AdminPageHeader";
import { EmptyState } from "../shared/components/EmptyState";
import { KpiCard } from "../shared/components/KpiCard";
import { useAdminQuery } from "../shared/hooks/useAdminQuery";
import { CoverageTables } from "./CoverageTables";

const DAY_MS = 86_400_000;
const DATE_INPUT = "h-9 rounded-lg border border-stroke bg-ink-900 px-2.5 text-xs text-frost focus-visible:outline focus-visible:outline-sky-400 disabled:opacity-60";

export function CoverageWindowForm({ from, to, loading, validationError, onFrom, onTo, onSubmit }: {
  from: string; to: string; loading: boolean; validationError: string | null;
  onFrom: (value: string) => void; onTo: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="glass flex flex-wrap items-end gap-3 rounded-xl p-3" aria-label="Coverage UTC date window" aria-busy={loading}>
      <label className="flex flex-col gap-1 text-xs text-soft" htmlFor="coverage-from">From (UTC, inclusive)
        <input id="coverage-from" name="from" type="date" required value={from} onChange={event => onFrom(event.target.value)} className={DATE_INPUT} aria-describedby="coverage-window-hint" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-soft" htmlFor="coverage-to">To (UTC, exclusive)
        <input id="coverage-to" name="to" type="date" required value={to} onChange={event => onTo(event.target.value)} className={DATE_INPUT} aria-describedby="coverage-window-hint" />
      </label>
      <SiteButton type="submit" variant="sky" size="sm" disabled={loading}>Apply window</SiteButton>
      <p id="coverage-window-hint" className="type-accent-xs w-full text-faint">Maximum 366 days. Dates begin at 00:00 UTC; the end date is excluded. A larger saved-lesson set reports the newest lessons and marks the scan as partial.</p>
      {validationError ? <p role="alert" className="text-xs text-danger">{validationError}</p> : null}
    </form>
  );
}

function defaultWindow(): CoverageWindow {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { from: new Date(today - 6 * DAY_MS).toISOString().slice(0, 10), to: new Date(today + DAY_MS).toISOString().slice(0, 10) };
}

interface CoverageContentProps {
  data: CoverageReport | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function coverageRequestPending(loading: boolean, hasReport: boolean, error: string | null) {
  return loading || (!hasReport && error == null);
}

function coverageErrorCopy(error: string) {
  if (error === "unauthorized") return { title: "Admins only", description: "Sign in with an admin account to view saved lesson coverage." };
  if (error === "busy") return { title: "Coverage report already running", description: "Wait for the current coverage query to finish, then try again." };
  return { title: "Could not load coverage", description: "The coverage request failed. Check the UTC date window and try again." };
}

export function CoverageContent({ data, loading, error, onRetry }: CoverageContentProps) {
  if (error) {
    const copy = coverageErrorCopy(error);
    return (
      <div role="alert"><EmptyState
        title={copy.title}
        description={copy.description}
        action={<SiteButton variant="ghost" size="sm" onClick={onRetry} disabled={loading}>Try again</SiteButton>}
      /></div>
    );
  }
  if (!data) return <div role="status" aria-busy={loading}><EmptyState title="Loading saved lesson coverage…" /></div>;
  return (
    <section className="space-y-4" aria-label="Saved lesson coverage" aria-busy={loading}>
      <p className="text-xs text-soft">
        UTC window: <time dateTime={data.window.from}>{data.window.from}</time> (inclusive) to {" "}
        <time dateTime={data.window.to}>{data.window.to}</time> (exclusive). Saved lesson turns only; complete and stopped lessons.
      </p>
      <p className="text-xs text-soft" role="status">
        {data.scan.truncated
          ? `Partial scan: the newest ${data.scan.scanned.toLocaleString("en-US")} saved lessons in this window. The scan budget is ${data.scan.budget.toLocaleString("en-US")}.`
          : `Full window: ${data.scan.scanned.toLocaleString("en-US")} saved lessons.`}
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Saved lessons" value={data.totals.savedLessons.toLocaleString("en-US")} />
        <KpiCard label="Needed figures" value={data.totals.needed.toLocaleString("en-US")} />
        <KpiCard label="Required drawn" value={data.totals.neededDrawn.toLocaleString("en-US")} tone="sky" />
        <KpiCard label="Required empty" value={data.totals.neededEmpty.toLocaleString("en-US")} tone="danger" />
        <KpiCard label="Required unknown" value={data.totals.neededUnknown.toLocaleString("en-US")} />
        <KpiCard label="Unrecorded need" value={data.totals.unrecordedNeed.toLocaleString("en-US")} />
        <KpiCard label="Unknown outcome" value={data.totals.unrecordedOutcome.toLocaleString("en-US")} />
      </div>
      {data.totals.savedLessons === 0 ? <EmptyState title="No saved lessons in this UTC window" description="Choose another date window to inspect saved lesson figures." /> : <CoverageTables report={data} />}
    </section>
  );
}

export function CoverageView() {
  const [window, setWindow] = useState(defaultWindow);
  const [from, setFrom] = useState(window.from);
  const [to, setTo] = useState(window.to);
  const [validationError, setValidationError] = useState<string | null>(null);
  const url = `/api/admin/coverage?${new URLSearchParams({ from: window.from, to: window.to }).toString()}`;
  const { data, loading, error, refresh } = useAdminQuery<CoverageReport>(url);
  const pending = coverageRequestPending(loading, data != null, error);
  const applyWindow = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const days = (Date.parse(to) - Date.parse(from)) / DAY_MS;
    if (pending) return;
    if (!Number.isInteger(days) || days < 1 || days > 366) {
      setValidationError("Choose an end date after the start date, with a maximum span of 366 days.");
      return;
    }
    setValidationError(null);
    if (from === window.from && to === window.to) refresh();
    else setWindow({ from, to });
  };

  return (
    <div className="space-y-4">
      <AdminPageHeader title="Coverage" description="Figure coverage and confirmed empty diagnostics from saved production lessons."
        icon={<ChartColumn className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
        actions={<><span role="status" className="type-accent-xs text-faint">{loading ? "Loading…" : data ? "Saved lesson counts" : ""}</span>
          <SiteButton variant="ghost" size="sm" onClick={refresh} disabled={pending || loading}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Refresh</SiteButton></>}
      />
      <CoverageWindowForm from={from} to={to} loading={pending} validationError={validationError}
        onFrom={setFrom} onTo={setTo} onSubmit={applyWindow} />
      <CoverageContent data={data} loading={loading} error={error} onRetry={refresh} />
    </div>
  );
}
