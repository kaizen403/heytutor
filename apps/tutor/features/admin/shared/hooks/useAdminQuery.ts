"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface AdminQueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetch an admin API on mount (and on every `url` change), with an optional
 * poll interval. Same shape as `useRunCost`: plain fetch, error strings the
 * panel renders directly, and an in-flight abort so a slow earlier request
 * cannot overwrite a newer one.
 */
export function useAdminQuery<T>(url: string | null, pollMs?: number): AdminQueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    setNonce((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!url) {
      abortRef.current?.abort();
      setData(null);
      setError(null);
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
            setError(
              response.status === 401
                ? "unauthorized"
                : response.status === 404
                  ? "not_found"
                  : "request_failed",
            );
          }
          return;
        }
        const payload = (await response.json()) as T;
        if (controller.signal.aborted) return;
        setData(payload);
        setError(null);
      } catch {
        if (!controller.signal.aborted) setError("request_failed");
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
