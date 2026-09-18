"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunCostApiPayload } from "@/lib/obs/runCost";

const POLL_MS = 8_000;
const SETTLE_MS = 45_000;

export function useRunCost(sessionIds: string[], busy: boolean) {
  const [data, setData] = useState<RunCostApiPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = sessionIds.slice().sort().join(",");
  const busyRef = useRef(busy);
  const settleUntilRef = useRef(0);
  const inFlightRef = useRef(false);
  const observationsRef = useRef(0);

  useEffect(() => {
    if (busyRef.current && !busy) {
      settleUntilRef.current = Date.now() + SETTLE_MS;
    }
    if (busy) {
      settleUntilRef.current = Date.now() + SETTLE_MS;
    }
    busyRef.current = busy;
  }, [busy]);

  const refresh = useCallback(async (ids: string[]) => {
    if (ids.length === 0 || inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    setLoading(true);
    try {
      const response = await fetch("/api/admin/run-cost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionIds: ids }),
      });
      if (!response.ok) {
        setError(response.status === 401 ? "unauthorized" : "request_failed");
        return;
      }
      const payload = (await response.json()) as RunCostApiPayload;
      setData(payload);
      setError(payload.error ?? null);
      observationsRef.current = payload.report.totals.observations;
    } catch {
      setError("request_failed");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!key) {
      setData(null);
      setError(null);
      observationsRef.current = 0;
      return;
    }
    const ids = key.split(",").filter(Boolean);
    void refresh(ids);
    const timer = window.setInterval(() => {
      const settling = Date.now() < settleUntilRef.current;
      if (busyRef.current || settling || observationsRef.current === 0) {
        void refresh(ids);
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [key, refresh]);

  return { data, loading, error };
}
