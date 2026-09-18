"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface AdminQueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

interface FetchState<T> {
  url: string;
  data: T | null;
  error: string | null;
}

function errorForStatus(status: number): string {
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  return "request_failed";
}

/**
 * Fetch an admin API on mount (and on every `url` change), with an optional
 * poll interval. Same shape as `useRunCost`: plain fetch and error strings the
 * panel renders directly. Results are keyed by url and compared at read time,
 * so a url change never shows the previous url's payload; an in-flight abort
 * means a slow earlier request cannot overwrite a newer one either.
 */
export function useAdminQuery<T>(url: string | null, pollMs?: number): AdminQueryState<T> {
  const [state, setState] = useState<FetchState<T> | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    setNonce((current) => current + 1);
  }, []);

  const current = state != null && state.url === (url ?? "") ? state : null;
  const data = url != null ? (current?.data ?? null) : null;
  const error = url != null ? (current?.error ?? null) : null;

  useEffect(() => {
    if (!url) {
      abortRef.current?.abort();
      return;
    }
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    const run = async () => {
      setLoading(true);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          if (!controller.signal.aborted) {
            setState({ url, data: null, error: errorForStatus(response.status) });
          }
          return;
        }
        const payload = (await response.json()) as T;
        if (controller.signal.aborted) return;
        setState({ url, data: payload, error: null });
      } catch {
        if (!controller.signal.aborted) {
          setState({ url, data: null, error: "request_failed" });
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void run();

    return () => controller.abort();
  }, [url, nonce]);

  useEffect(() => {
    if (!pollMs || !url) return;
    const timer = window.setInterval(() => {
      setNonce((current) => current + 1);
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [pollMs, url]);

  return { data, loading, error, refresh };
}
