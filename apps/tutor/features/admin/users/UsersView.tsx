"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Users, X } from "lucide-react";
import { SiteButton } from "@/components/ui/site-button";
import type { UserSort, UsersPagePayload } from "@/lib/admin/types";
import { AdminPageHeader } from "../shared/components/AdminPageHeader";
import { EmptyState } from "../shared/components/EmptyState";
import { FilterSelect } from "../shared/components/FilterSelect";
import { Pagination } from "../shared/components/Pagination";
import { useAdminQuery } from "../shared/hooks/useAdminQuery";
import { downloadCsv } from "../shared/lib/csv";
import { formatMillicentsUsd } from "../shared/lib/format";
import { UsersTable } from "./UsersTable";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

const SORT_OPTIONS: Array<{ value: UserSort; label: string }> = [
  { value: "recentActivity", label: "Recent activity" },
  { value: "turns", label: "Most turns" },
  { value: "boards", label: "Most boards" },
  { value: "messages", label: "Most messages" },
  { value: "spend", label: "Highest spend" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];

export function UsersView() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<UserSort>("recentActivity");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  const url = useMemo(() => {
    const params = new URLSearchParams({
      sort,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (query) params.set("query", query);
    return `/api/admin/users?${params.toString()}`;
  }, [query, sort, page]);

  const { data, loading, error, refresh } = useAdminQuery<UsersPagePayload>(url);

  const onSortChange = (next: string) => {
    setSort(next as UserSort);
    setPage(1);
  };

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `heytutor-users-page${data.page}.csv`,
      ["user id", "name", "email", "turns", "boards", "messages", "last turn", "spend usd"],
      data.users.map((user) => [
        user.userId,
        user.name ?? "",
        user.email ?? "",
        user.turns,
        user.boards,
        user.chatMessages,
        user.lastTurnAt ?? "",
        user.spendMillicents == null ? "" : formatMillicentsUsd(user.spendMillicents),
      ]),
    );
  };

  const hasFilters = query !== "";

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Manage Users"
        description={
          data
            ? `${data.total} user${data.total === 1 ? "" : "s"} · spend period ${data.period}`
            : "Everyone using the app, what they are asking, and how much they run."
        }
        icon={<Users className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
        actions={
          <>
            {loading ? <span className="type-accent-xs text-faint">Loading…</span> : null}
            {error ? <span className="type-accent-xs text-danger">Could not load</span> : null}
            <SiteButton variant="ghost" size="sm" onClick={exportCsv} disabled={!data}>
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export page
            </SiteButton>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email, or user id…"
            aria-label="Search users"
            className="h-9 w-full rounded-lg border border-stroke bg-ink-900 px-3 text-xs text-frost outline-none transition-colors placeholder:text-faint hover:border-sky-500/50 focus-visible:ring-2 focus-visible:ring-sky-500"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-frost"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <FilterSelect
          value={sort}
          options={SORT_OPTIONS}
          onChange={onSortChange}
          ariaLabel="Sort users"
        />
        {hasFilters ? (
          <SiteButton
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setQuery("");
              setPage(1);
            }}
          >
            Clear
          </SiteButton>
        ) : null}
      </div>

      {data && data.users.length > 0 ? (
        <>
          <UsersTable users={data.users} />
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={setPage}
          />
        </>
      ) : data && data.users.length === 0 ? (
        <EmptyState
          title="No users match"
          description="Nothing in the table matches this search."
          action={
            hasFilters ? (
              <SiteButton
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setQuery("");
                }}
              >
                Clear search
              </SiteButton>
            ) : undefined
          }
        />
      ) : error ? (
        <EmptyState
          title={error === "unauthorized" ? "Admins only" : "Could not load users"}
          description={
            error === "unauthorized"
              ? "Sign in with a staff account to manage users."
              : "The users API did not answer. Try refreshing."
          }
          action={
            <SiteButton variant="ghost" size="sm" onClick={refresh}>
              Try again
            </SiteButton>
          }
        />
      ) : (
        <EmptyState title="Loading users…" />
      )}
    </div>
  );
}
