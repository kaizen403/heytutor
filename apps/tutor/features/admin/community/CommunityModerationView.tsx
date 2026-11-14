"use client";

import { Input } from "@/components/ui/input";

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type {
  AdminCommunityFilter,
  AdminCommunityPage,
  AdminCommunityRow,
} from "@/lib/admin/communityQueries";
import { cn } from "@/lib/utils";
import { AdminPageHeader } from "../shared/components/AdminPageHeader";
import { EmptyState } from "../shared/components/EmptyState";
import { Pagination } from "../shared/components/Pagination";
import { useAdminQuery } from "../shared/hooks/useAdminQuery";
import { formatCount, formatRelativeTime } from "../shared/lib/format";

const PAGE_SIZE = 25;
const CELL = "px-4 py-3 align-middle";
const HEAD = "px-4 text-left text-xs font-medium text-muted-foreground";

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

async function act(
  boardId: string,
  body: Record<string, boolean>,
): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/admin/community/${encodeURIComponent(boardId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
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
    const params = new URLSearchParams({
      filter,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (query) params.set("query", query);
    return `/api/admin/community?${params}`;
  }, [filter, page, query]);
  const { data, loading, error, refresh } =
    useAdminQuery<AdminCommunityPage>(url);

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
        description={
          data
            ? `${data.total} board${data.total === 1 ? "" : "s"}`
            : "Public boards, reports, and Featured"
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={filter === item.id ? "secondary" : "ghost"}
            onClick={() => {
              setFilter(item.id);
              setPage(1);
            }}
          >
            {item.label}
          </Button>
        ))}
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search title, email or @name"
          aria-label="Search Community boards"
          className="ml-auto w-full sm:w-64"
        />
      </div>

      {error ? (
        <EmptyState
          title="Community did not load"
          description={error}
          action={
            <Button size="sm" onClick={refresh}>
              Try again
            </Button>
          }
        />
      ) : !loading && data && data.rows.length === 0 ? (
        <EmptyState
          title={
            filter === "reported" ? "No reported boards" : "No boards here"
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table className="w-full min-w-[60rem] border-collapse">
            <TableHeader>
              <TableRow className="border-b border-stroke">
                <TableHead className={HEAD}>Board</TableHead>
                <TableHead className={HEAD}>Owner</TableHead>
                <TableHead className={HEAD}>Status</TableHead>
                <TableHead className={HEAD}>Reports</TableHead>
                <TableHead className={cn(HEAD, "text-right")}>Views</TableHead>
                <TableHead className={cn(HEAD, "text-right")}>
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.rows ?? []).map((row) => (
                <TableRow
                  key={row.id}
                  className="border-b border-stroke/60 last:border-b-0 hover:bg-white/[0.03]"
                >
                  <TableCell className={CELL}>
                    <Link
                      href={`/community/${encodeURIComponent(row.id)}`}
                      target="_blank"
                      className="text-sm text-frost hover:text-foreground"
                    >
                      {row.title}
                    </Link>
                    <p className="text-xs text-faint">
                      {formatRelativeTime(row.createdAt)}
                    </p>
                  </TableCell>
                  <TableCell className={CELL}>
                    <p className="text-sm text-frost">
                      {row.ownerHandle
                        ? `@${row.ownerHandle}`
                        : (row.ownerName ?? "No name")}
                    </p>
                    <p className="text-xs text-faint">
                      {row.ownerEmail ?? "No email"}
                    </p>
                  </TableCell>
                  <TableCell className={cn(CELL, "text-xs")}>
                    <span
                      className={
                        row.onCommunity ? "text-foreground" : "text-faint"
                      }
                    >
                      {row.onCommunity
                        ? "On Community"
                        : row.hiddenAt
                          ? "Hidden"
                          : row.visibility === "private"
                            ? "Private"
                            : "Not listed"}
                    </span>
                    {row.featuredAt ? (
                      <span className="ml-2 text-foreground">Featured</span>
                    ) : null}
                  </TableCell>
                  <TableCell className={cn(CELL, "text-xs")}>
                    {row.reportCount === 0 ? (
                      <span className="text-faint">None</span>
                    ) : (
                      <>
                        <p className="text-frost">{row.reportCount}</p>
                        <p className="text-faint">
                          {Object.entries(row.reasons)
                            .map(
                              ([reason, count]) =>
                                `${REASON_LABELS[reason] ?? reason} ${count}`,
                            )
                            .join(", ")}
                        </p>
                      </>
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      CELL,
                      "text-right text-xs tabular-nums text-frost",
                    )}
                  >
                    {formatCount(row.viewCount)}
                    {row.remixCount > 0 ? (
                      <span className="text-faint">
                        {" "}
                        · {formatCount(row.remixCount)} remixes
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className={cn(CELL, "text-right")}>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button
                        size="xs"
                        variant={row.hiddenAt ? "outline" : "destructive"}
                        disabled={busy === row.id}
                        onClick={() => void run(row, { hidden: !row.hiddenAt })}
                      >
                        {row.hiddenAt ? "Unhide" : "Hide"}
                      </Button>
                      {!row.hiddenAt ? (
                        <Button
                          size="xs"
                          disabled={
                            busy === row.id ||
                            (!row.onCommunity && !row.featuredAt)
                          }
                          onClick={() =>
                            void run(row, { featured: !row.featuredAt })
                          }
                        >
                          {row.featuredAt ? "Unfeature" : "Feature"}
                        </Button>
                      ) : null}
                      {row.reportCount > 0 ? (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={busy === row.id}
                          onClick={() => void run(row, { clearReports: true })}
                        >
                          Clear reports
                        </Button>
                      ) : null}
                    </div>
                    {failed === row.id ? (
                      <p className="mt-1 text-xs text-red-300">
                        That did not save.
                      </p>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {data && data.total > PAGE_SIZE ? (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={data.total}
          onPageChange={setPage}
        />
      ) : null}
    </div>
  );
}
