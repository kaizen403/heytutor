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

/**
 * One more try after the browser reports the connection failed.
 * An abort is not a network error: retrying it just races the stop button.
 * Firefox rejects an aborted fetch as `TypeError: NetworkError...` with the
 * signal already aborted; callers must classify that as an abort first.
 */
export function shouldRetryTtsTransport(error: unknown, attempt: number): boolean {
  if (attempt >= 1) return false;
  if (error instanceof DOMException && error.name === "AbortError") return false;
  return error instanceof TypeError;
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
    async acquire(signal?: AbortSignal): Promise<void> {
      if (signal?.aborted) {
        throw new DOMException("tts http gate aborted", "AbortError");
      }
      if (inFlight >= limit) {
        await new Promise<void>((resolve, reject) => {
          const wake = () => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          };
          const onAbort = () => {
            const index = waiters.indexOf(wake);
            if (index >= 0) waiters.splice(index, 1);
            reject(new DOMException("tts http gate aborted", "AbortError"));
          };
          waiters.push(wake);
          signal?.addEventListener("abort", onAbort, { once: true });
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
