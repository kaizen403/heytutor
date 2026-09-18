"use client";

import { useEffect, useRef, useState } from "react";
import {
  emptyRunCostSession,
  type RunCostApiPayload,
  type RunCostSessionRow,
} from "@/lib/obs/runCost";

export interface LectureCostSession {
  sessionId: string;
  hot: boolean;
}

const BATCH_SIZE = 20;
const POLL_MS = 8_000;
const SETTLE_MS = 45_000;

function chunkIds(ids: string[], size: number): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    batches.push(ids.slice(i, i + size));
  }
  return batches;
}

async function fetchSessionCosts(
  ids: string[],
  signal: AbortSignal,
): Promise<RunCostSessionRow[] | null> {
  if (ids.length === 0) return [];
  const response = await fetch("/api/admin/run-cost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionIds: ids }),
    signal,
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as RunCostApiPayload;
  if (payload.error && payload.report.bySession.length === 0 && payload.configured) {
    return null;
  }
  const byId = new Map(payload.report.bySession.map((row) => [row.sessionId, row]));
  return ids.map((id) => byId.get(id) ?? emptyRunCostSession(id));
}

/**
 * Langfuse costs for recorded / running lecture boards in the syllabus list.
 * Completed sessions are fetched once and cached; only hot (running or just
 * finished) ids are polled.
 */
export function useLectureCosts(
  sessions: readonly LectureCostSession[],
): Record<string, RunCostSessionRow> {
  const [bySession, setBySession] = useState<Record<string, RunCostSessionRow>>({});
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const fetchedRef = useRef(new Set<string>());
  const prevHotRef = useRef(new Set<string>());
  const settleUntilRef = useRef(new Map<string, number>());
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);

  const idKey = sessions
    .map((session) => session.sessionId)
    .filter(Boolean)
    .slice()
    .sort()
    .join(",");

  useEffect(() => {
    if (!idKey) return;
    const controller = new AbortController();

    const rememberHotTransitions = () => {
      const nextHot = new Set(
        sessionsRef.current.filter((session) => session.hot).map((session) => session.sessionId),
      );
      const now = Date.now();
      for (const id of prevHotRef.current) {
        if (!nextHot.has(id)) {
          settleUntilRef.current.set(id, now + SETTLE_MS);
        }
      }
      prevHotRef.current = nextHot;
    };

    const idsToFetch = (): string[] => {
      rememberHotTransitions();
      const now = Date.now();
      const wanted: string[] = [];
      const seen = new Set<string>();
      for (const session of sessionsRef.current) {
        const id = session.sessionId.trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const settling = (settleUntilRef.current.get(id) ?? 0) > now;
        const hot = session.hot || settling;
        const missing = !fetchedRef.current.has(id);
        // Completed boards stay cached; only missing, running, or settling ids refetch.
        if (hot || missing) {
          wanted.push(id);
        }
      }
      return wanted;
    };

    const mergeRows = (rows: RunCostSessionRow[]) => {
      if (rows.length === 0) return;
      setBySession((current) => {
        const next = { ...current };
        for (const row of rows) {
          next[row.sessionId] = row;
          fetchedRef.current.add(row.sessionId);
        }
        return next;
      });
    };

    const tick = async () => {
      if (controller.signal.aborted) return;
      if (inFlightRef.current) {
        queuedRef.current = true;
        return;
      }
      inFlightRef.current = true;
      try {
        do {
          queuedRef.current = false;
          const ids = idsToFetch();
          if (ids.length === 0) continue;
          for (const batch of chunkIds(ids, BATCH_SIZE)) {
            if (controller.signal.aborted) return;
            const rows = await fetchSessionCosts(batch, controller.signal);
            if (rows) mergeRows(rows);
          }
        } while (queuedRef.current && !controller.signal.aborted);
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
      } finally {
        inFlightRef.current = false;
      }
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, POLL_MS);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [idKey]);

  return bySession;
}
