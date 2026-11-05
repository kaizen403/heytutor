"use client";

import { useState } from "react";
import { Images, RefreshCw } from "lucide-react";
import { SiteButton } from "@/components/ui/site-button";
import type { PicturesReport } from "@/lib/admin/pictures";
import { AdminPageHeader } from "../shared/components/AdminPageHeader";
import { EmptyState } from "../shared/components/EmptyState";
import { FilterSelect } from "../shared/components/FilterSelect";
import { useAdminQuery } from "../shared/hooks/useAdminQuery";
import { formatRelativeTime } from "../shared/lib/format";
import { PicturesBreakdown } from "./PicturesBreakdown";
import { PicturesCache } from "./PicturesCache";
import { PicturesKpis } from "./PicturesKpis";
import { PicturesLibrary } from "./PicturesLibrary";
import { PicturesTurnsTable } from "./PicturesTurnsTable";

export const PICTURE_PERIOD_OPTIONS = [
  { value: "1", label: "Today (UTC)" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

function picturesErrorCopy(error: string) {
  if (error === "unauthorized") return { title: "Admins only", description: "Sign in with an admin account to view reference picture outcomes." };
  if (error === "busy") return { title: "Picture report already running", description: "Wait for the current report to finish, then try again." };
  return { title: "Could not load reference pictures", description: "The pictures request failed. Try again." };
}

interface PicturesContentProps {
  data: PicturesReport | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function PicturesContent({ data, loading, error, onRetry }: PicturesContentProps) {
  if (error) {
    const copy = picturesErrorCopy(error);
    return (
      <div role="alert"><EmptyState title={copy.title} description={copy.description}
        action={<SiteButton variant="ghost" size="sm" onClick={onRetry} disabled={loading}>Try again</SiteButton>} /></div>
    );
  }
  if (!data) return <div role="status" aria-busy={loading}><EmptyState title="Loading reference picture outcomes…" /></div>;
  return (
    <section className="space-y-4" aria-label="Reference picture analytics" aria-busy={loading}>
      <p className="text-xs leading-relaxed text-soft">
        UTC days <time dateTime={data.window.from}>{data.window.from}</time> (inclusive) to <time dateTime={data.window.to}>{data.window.to}</time> (exclusive).
        Saved lesson turns only, complete and stopped; doubts and resumes are not counted, since a resume copies its lesson&rsquo;s outcome.
        {data.scan.truncated
          ? ` Partial scan: the newest ${data.scan.scanned.toLocaleString("en-US")} lessons.`
          : ` Full period: ${data.scan.scanned.toLocaleString("en-US")} lessons.`}
      </p>
      <p className="text-xs leading-relaxed text-soft">
        Engine drew means a validated figure. Needed means the saved plan asked for a figure (required or optional) and the engine did not draw one.
        A picture is its own tier: the engine metrics on every other page still count these lessons as text only.
        Shown counts the browser&rsquo;s outcome; shown but not saved means the server held no record for it.
      </p>
      <PicturesKpis report={data} />
      {data.totals.lessons === 0
        ? <EmptyState title="No saved lessons in this period" description="Choose a longer period to see picture outcomes." />
        : <PicturesBreakdown report={data} />}
      {data.recent.length > 0
        ? <PicturesTurnsTable turns={data.recent} />
        : <EmptyState title="No picture outcomes in this period" description="Outcomes are recorded only while DIAGRAM_REFERENCE_PICTURE is on." />}
      <PicturesLibrary library={data.library} />
      <PicturesCache cache={data.cache} />
    </section>
  );
}

export function PicturesView() {
  const [days, setDays] = useState("7");
  const { data, loading, error, refresh } = useAdminQuery<PicturesReport>(`/api/admin/pictures?${new URLSearchParams({ days }).toString()}`);

  return (
    <div className="space-y-4">
      <AdminPageHeader title="Pictures"
        description="Reference pictures for lessons whose verified figure was not drawn: attempts, outcomes, time and library."
        icon={<Images className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
        actions={<>
          <span role="status" className="type-accent-xs text-faint">
            {loading ? "Loading…" : data ? `Updated ${formatRelativeTime(data.generatedAt)}` : ""}
          </span>
          <FilterSelect value={days} options={PICTURE_PERIOD_OPTIONS} onChange={setDays} ariaLabel="Period" />
          <SiteButton variant="ghost" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} aria-hidden />Refresh
          </SiteButton>
        </>}
      />
      <PicturesContent data={data} loading={loading} error={error} onRetry={refresh} />
    </div>
  );
}
