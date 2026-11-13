"use client";

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TurnsOutcomeFilter, TurnsPagePayload } from "@/lib/admin/types";
import { AdminPageHeader } from "../shared/components/AdminPageHeader";
import { AdminTableSkeleton } from "../shared/components/AdminTableSkeleton";
import { EmptyState } from "../shared/components/EmptyState";
import { Pagination } from "../shared/components/Pagination";
import { useAdminQuery } from "../shared/hooks/useAdminQuery";
import { downloadCsv } from "../shared/lib/csv";
import { TurnFilters } from "./TurnFilters";
import { TurnsTable } from "./TurnsTable";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

export function TurnsLogView() {
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<TurnsOutcomeFilter>("all");
  const [days, setDays] = useState("30");
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
      outcome,
    });
    if (query) params.set("query", query);
    if (days !== "all") params.set("days", days);
    return `/api/admin/turns?${params.toString()}`;
  }, [query, outcome, days, page]);

  const { data, loading, error, refresh } =
    useAdminQuery<TurnsPagePayload>(url);

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `heytutor-turns-page${data.page}.csv`,
      [
        "turn id",
        "question",
        "outcome",
        "tier",
        "user",
        "board",
        "engine",
        "created",
        "ai usd",
        "voice usd",
        "total usd",
        "trace",
        "during stars",
        "during note",
        "after stars",
        "after note",
      ],
      data.turns.map((turn) => {
        const during = turn.ratings.find(
          (rating) => rating.moment === "during",
        );
        const after = turn.ratings.find((rating) => rating.moment === "after");
        return [
          turn.turnId,
          turn.question,
          turn.outcome,
          turn.tier ?? "",
          turn.userLabel,
          turn.boardTitle,
          turn.sceneEngineVersion ?? "",
          turn.createdAt,
          turn.llmUsd ?? "",
          turn.ttsUsd ?? "",
          turn.totalUsd ?? "",
          turn.traceUrl ?? "",
          during?.stars ?? "",
          during?.feedback ?? "",
          after?.stars ?? "",
          after?.feedback ?? "",
        ];
      }),
    );
  };

  const filtersActive = query !== "" || outcome !== "all" || days !== "30";

  const clearFilters = () => {
    setSearchInput("");
    setQuery("");
    setOutcome("all");
    setDays("30");
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Logs"
        description={
          data
            ? `${data.total} turn${data.total === 1 ? "" : "s"} in view · newest first`
            : "Every turn the app has taught, newest first."
        }
        actions={
          <>
            {loading ? (
              <span className="type-accent-xs text-faint">Loading…</span>
            ) : null}
            {error ? (
              <span className="type-accent-xs text-danger">Could not load</span>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={!data}
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export page
            </Button>
          </>
        }
      />

      <TurnFilters
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        outcome={outcome}
        onOutcomeChange={(value) => {
          setOutcome(value);
          setPage(1);
        }}
        days={days}
        onDaysChange={(value) => {
          setDays(value);
          setPage(1);
        }}
        onClear={clearFilters}
        active={filtersActive}
      />

      {data && data.turns.length > 0 ? (
        <>
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
          title="No turns match"
          description="Nothing was taught with these filters."
          action={
            filtersActive ? (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : error ? (
        <EmptyState
          title={
            error === "unauthorized"
              ? "Admins only"
              : "Could not load the turn log"
          }
          description="The turns API did not answer. Try refreshing."
          action={
            <Button variant="outline" size="sm" onClick={refresh}>
              Try again
            </Button>
          }
        />
      ) : (
        <AdminTableSkeleton label="Loading turns…" />
      )}
    </div>
  );
}
