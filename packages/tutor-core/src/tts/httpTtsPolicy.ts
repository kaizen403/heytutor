/**
 * HTTP TTS is the fallback when the WebSocket is down. ElevenLabs counts
 * every in-flight /stream request against the plan concurrency cap. Prefetching
 * six upcoming sentences on top of the one being spoken is what 429s a DSA
 * lesson about a minute in and freezes the pen.
 */
export const MAX_HTTP_PREFETCH = 1;
export const MAX_CONCURRENT_HTTP_TTS = 2;

export function parseRetryAfterSec(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number.parseFloat(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/** Delay before one retry, or null when the status should not be retried. */
export function ttsHttpRetryDelayMs(
  status: number,
  attempt: number,
  retryAfterSec?: number,
): number | null {
  if (status !== 429 && status !== 503) return null;
  if (attempt >= 1) return null;
  if (retryAfterSec !== undefined) {
    return Math.min(Math.round(retryAfterSec * 1000), 2_000);
  }
  return 400;
}

export function createHttpTtsGate(limit = MAX_CONCURRENT_HTTP_TTS) {
  let inFlight = 0;
  const waiters: Array<() => void> = [];

  return {
    get inFlight() {
      return inFlight;
    },
    async acquire(): Promise<void> {
      if (inFlight >= limit) {
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
        });
      }
      inFlight += 1;
    },
    release(): void {
      inFlight = Math.max(0, inFlight - 1);
      waiters.shift()?.();
    },
  };
}
