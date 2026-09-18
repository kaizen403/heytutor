"use client";

import { useEffect, useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { TurnsPagePayload } from "@/lib/admin/types";
import { AdminPageHeader } from "../shared/components/AdminPageHeader";
import { EmptyState } from "../shared/components/EmptyState";
import { Pagination } from "../shared/components/Pagination";
import { useAdminQuery } from "../shared/hooks/useAdminQuery";
import { TurnFilters } from "./TurnFilters";
import { TurnsTable } from "./TurnsTable";
import { DegradationPanel } from "./DegradationPanel";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;
const DEFAULT_DAYS = "30";

export function FailsView() {
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const url = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      outcome: "failed",
    });
    if (query) params.set("query", query);
    if (days !== "all") params.set("days", days);
    return `/api/admin/turns?${params.toString()}`;
  }, [query, days, page]);

  const { data, loading, error, refresh } = useAdminQuery<TurnsPagePayload>(url);

  const filtersActive = query !== "" || days !== DEFAULT_DAYS;

  const clearFilters = () => {
    setSearchInput("");
    setQuery("");
    setDays(DEFAULT_DAYS);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Fails"
        description={
          data
            ? `${data.total} turn${data.total === 1 ? "" : "s"} taught without a verified diagram`
            : "Turns that taught without a verified diagram, and why."
        }
        icon={<TriangleAlert className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
        actions={
          loading ? <span className="type-accent-xs text-faint">Loading…</span> : null
        }
      />

      <TurnFilters
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        outcome="failed"
        onOutcomeChange={() => undefined}
        days={days}
        onDaysChange={(value) => {
          setDays(value);
          setPage(1);
        }}
        lockOutcome
        onClear={clearFilters}
        active={filtersActive}
      />

      {data && data.turns.length > 0 ? (
        <>
          <DegradationPanel turns={data.turns} />
          <TurnsTable turns={data.turns} />
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={setPage}
          />
        </>
      ) : data && data.turns.length === 0 ? (
        <EmptyState
          title="No failed turns"
          description="Nothing in this window taught without a verified diagram."
          action={
            filtersActive ? (
              <button type="button" onClick={clearFilters} className="text-xs text-sky-300">
                Clear filters
              </button>
            ) : undefined
          }
        />
      ) : error ? (
        <EmptyState
          title={error === "unauthorized" ? "Admins only" : "Could not load failed turns"}
          description="The turns API did not answer. Try refreshing."
          action={
            <button type="button" onClick={refresh} className="text-xs text-sky-300">
              Try again
            </button>
          }
        />
      ) : (
        <EmptyState title="Loading failed turns…" />
      )}
    </div>
  );
}
