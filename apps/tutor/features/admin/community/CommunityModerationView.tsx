"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Globe } from "lucide-react";
import { SiteButton } from "@/components/ui/site-button";
import type { AdminCommunityFilter, AdminCommunityPage, AdminCommunityRow } from "@/lib/admin/communityQueries";
import { cn } from "@/lib/utils";
import { AdminPageHeader } from "../shared/components/AdminPageHeader";
import { EmptyState } from "../shared/components/EmptyState";
import { Pagination } from "../shared/components/Pagination";
import { useAdminQuery } from "../shared/hooks/useAdminQuery";
import { formatCount, formatRelativeTime } from "../shared/lib/format";

const PAGE_SIZE = 25;
const CELL = "px-3 py-2 align-middle";
const HEAD = "type-accent-xs px-3 py-2 text-left text-faint";

const FILTERS: Array<{ id: AdminCommunityFilter; label: string }> = [
  { id: "reported", label: "Reported" },
  { id: "live", label: "On Community" },
  { id: "featured", label: "Featured" },
  { id: "hidden", label: "Hidden" },
];

const REASON_LABELS: Record<string, string> = {
  wrong: "wrong",
  inappropriate: "inappropriate",
  personal_info: "personal info",
  spam: "spam",
  other: "other",
};

async function act(boardId: string, body: Record<string, boolean>): Promise<boolean> {
  try {
    const response = await fetch(`/api/admin/community/${encodeURIComponent(boardId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Reported boards first: read the reasons, watch the lesson, then hide, feature, or clear. */
export function CommunityModerationView() {
  const [filter, setFilter] = useState<AdminCommunityFilter>("reported");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const url = useMemo(() => {
    const params = new URLSearchParams({ filter, page: String(page), pageSize: String(PAGE_SIZE) });
    if (query) params.set("query", query);
    return `/api/admin/community?${params}`;
  }, [filter, page, query]);
  const { data, loading, error, refresh } = useAdminQuery<AdminCommunityPage>(url);

  const run = async (row: AdminCommunityRow, body: Record<string, boolean>) => {
    setBusy(row.id);
    setFailed(null);
    const ok = await act(row.id, body);
    setBusy(null);
    if (!ok) setFailed(row.id);
    refresh();
  };

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Community"
        icon={<Globe className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
        description={data ? `${data.total} board${data.total === 1 ? "" : "s"}` : "Public boards, reports, and Featured"}
      />
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((item) => (
          <SiteButton
            key={item.id}
            size="sm"
            variant={filter === item.id ? "ice" : "ghost"}
            onClick={() => {
              setFilter(item.id);
              setPage(1);
            }}
          >
            {item.label}
          </SiteButton>
        ))}
        <input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search title, email or @name"
          aria-label="Search Community boards"
          className="ml-auto min-w-[14rem] rounded-lg border border-stroke bg-[rgba(0,0,0,0.22)] px-3 py-1.5 text-sm text-frost outline-none focus:border-sky-500"
        />
      </div>

      {error ? (
        <EmptyState title="Community did not load" description={error} action={<SiteButton size="sm" onClick={refresh}>Try again</SiteButton>} />
      ) : !loading && data && data.rows.length === 0 ? (
        <EmptyState title={filter === "reported" ? "No reported boards" : "No boards here"} />
      ) : (
        <div className="glass overflow-x-auto rounded-xl">
          <table className="w-full min-w-[60rem] border-collapse">
            <thead>
              <tr className="border-b border-stroke">
                <th className={HEAD}>Board</th>
                <th className={HEAD}>Owner</th>
                <th className={HEAD}>Status</th>
                <th className={HEAD}>Reports</th>
                <th className={cn(HEAD, "text-right")}>Views</th>
                <th className={cn(HEAD, "text-right")}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((row) => (
                <tr key={row.id} className="border-b border-stroke/60 last:border-b-0 hover:bg-white/[0.03]">
                  <td className={CELL}>
                    <Link href={`/community/${encodeURIComponent(row.id)}`} target="_blank" className="text-sm text-frost hover:text-sky-300">
                      {row.title}
                    </Link>
                    <p className="text-xs text-faint">{formatRelativeTime(row.createdAt)}</p>
                  </td>
                  <td className={CELL}>
                    <p className="text-sm text-frost">{row.ownerHandle ? `@${row.ownerHandle}` : row.ownerName ?? "No name"}</p>
                    <p className="text-xs text-faint">{row.ownerEmail ?? "No email"}</p>
                  </td>
                  <td className={cn(CELL, "text-xs")}>
                    <span className={row.onCommunity ? "text-sky-300" : "text-faint"}>
                      {row.onCommunity ? "On Community" : row.hiddenAt ? "Hidden" : row.visibility === "private" ? "Private" : "Not listed"}
                    </span>
                    {row.featuredAt ? <span className="ml-2 text-amber-200">Featured</span> : null}
                  </td>
                  <td className={cn(CELL, "text-xs")}>
                    {row.reportCount === 0 ? (
                      <span className="text-faint">None</span>
                    ) : (
                      <>
                        <p className="text-frost">{row.reportCount}</p>
                        <p className="text-faint">
                          {Object.entries(row.reasons).map(([reason, count]) => `${REASON_LABELS[reason] ?? reason} ${count}`).join(", ")}
                        </p>
                      </>
                    )}
                  </td>
                  <td className={cn(CELL, "text-right text-xs tabular-nums text-frost")}>
                    {formatCount(row.viewCount)}
                    {row.remixCount > 0 ? <span className="text-faint"> · {formatCount(row.remixCount)} remixes</span> : null}
                  </td>
                  <td className={cn(CELL, "text-right")}>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <SiteButton size="xs" variant={row.hiddenAt ? "ghost" : "danger"} disabled={busy === row.id} onClick={() => void run(row, { hidden: !row.hiddenAt })}>
                        {row.hiddenAt ? "Unhide" : "Hide"}
                      </SiteButton>
                      {!row.hiddenAt ? (
                        <SiteButton size="xs" disabled={busy === row.id || (!row.onCommunity && !row.featuredAt)} onClick={() => void run(row, { featured: !row.featuredAt })}>
                          {row.featuredAt ? "Unfeature" : "Feature"}
                        </SiteButton>
                      ) : null}
                      {row.reportCount > 0 ? (
                        <SiteButton size="xs" variant="ghost" disabled={busy === row.id} onClick={() => void run(row, { clearReports: true })}>
                          Clear reports
                        </SiteButton>
                      ) : null}
                    </div>
                    {failed === row.id ? <p className="mt-1 text-xs text-red-300">That did not save.</p> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > PAGE_SIZE ? <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} /> : null}
    </div>
  );
}
