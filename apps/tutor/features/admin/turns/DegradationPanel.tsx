"use client";

import { useMemo } from "react";
import type { AdminTurnRow } from "@/lib/admin/types";
import { BarList, type BarListEntry } from "../shared/components/BarList";

const TOP_ISSUE_CODES = 8;

function reasonLabel(reason: string): string {
  if (reason === "unrecorded") return "Unrecorded";
  return reason.replaceAll("_", " ");
}

/**
 * Aggregates the currently loaded page of failed turns — deliberately not the
 * whole window, so the numbers always reconcile with the table under them.
 */
export function DegradationPanel({ turns }: { turns: AdminTurnRow[] }) {
  const reasonEntries = useMemo<BarListEntry[]>(() => {
    const counts = new Map<string, number>();
    for (const turn of turns) {
      const reason = turn.degradationReason ?? "unrecorded";
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([reason, count]) => ({
        label: reasonLabel(reason),
        count,
        tone: reason === "unrecorded" ? "muted" : "danger",
      }));
  }, [turns]);

  const issueEntries = useMemo<BarListEntry[]>(() => {
    const counts = new Map<string, number>();
    for (const turn of turns) {
      for (const code of turn.issueCodes) {
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOP_ISSUE_CODES)
      .map(([code, count]) => ({ label: code, count, tone: "danger" }));
  }, [turns]);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <BarList
        title="Why the diagram was skipped"
        entries={reasonEntries}
        emptyLabel="No failed turns on this page"
        note={`this page's ${turns.length} failed turns`}
      />
      <BarList
        title="Top issue codes"
        entries={issueEntries}
        emptyLabel="No issue codes recorded on this page"
        note={`this page's ${turns.length} failed turns`}
      />
    </div>
  );
}
