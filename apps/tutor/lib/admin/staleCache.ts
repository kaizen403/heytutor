/**
 * One cached value per process for an expensive vendor read. Concurrent
 * callers share one in-flight load, a fresh value is reused for `freshMs`,
 * and a failed load returns the last good value for up to `staleMs` so a
 * rate-limited vendor does not blank the panel.
 */
export interface StaleCache<T> {
  read(nowMs?: number): Promise<T>;
  clear(): void;
}

export function createStaleCache<T>(options: {
  load: () => Promise<T>;
  isFailure: (value: T) => boolean;
  freshMs: number;
  staleMs: number;
}): StaleCache<T> {
  let good: { value: T; atMs: number } | null = null;
  let inflight: Promise<T> | null = null;

  return {
    async read(nowMs = Date.now()) {
      if (good && nowMs - good.atMs < options.freshMs) return good.value;
      if (!inflight) {
        inflight = options.load().finally(() => {
          inflight = null;
        });
      }
      const value = await inflight;
      if (!options.isFailure(value)) {
        good = { value, atMs: nowMs };
        return value;
      }
      if (good && nowMs - good.atMs < options.staleMs) return good.value;
      return value;
    },
    clear() {
      good = null;
      inflight = null;
    },
  };
}
