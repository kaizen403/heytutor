import { acceptParallelPrefix, type AcceptedParallelPrefix } from "./parallelTeachingPrefix";

/** Lab-only, detached narration; this controller cannot see/mutate scene inputs. */
export function createParallelPrefixController(input: {
  enabled: boolean;
  question: string;
  signal?: AbortSignal;
  request: (signal: AbortSignal) => Promise<string>;
  onAccepted?: (prefix: AcceptedParallelPrefix) => void;
}) {
  const controller = new AbortController();
  let started = false;
  let frozen = false;
  let accepted: AcceptedParallelPrefix | null = null;
  let operation: Promise<void> | null = null;
  let reason: string | null = null;
  const stop = () => { frozen = true; controller.abort(); };
  if (input.signal?.aborted) stop();
  else input.signal?.addEventListener("abort", stop, { once: true });
  return {
    start(gate: { enabled: boolean; speculative: boolean; blocked: boolean; scenePlanned: boolean }) {
      if (!input.enabled || !gate.enabled || gate.speculative || gate.blocked || !gate.scenePlanned || started || frozen) return;
      started = true;
      let response: Promise<string>;
      try { response = input.request(controller.signal); }
      catch { reason = "request_failed"; operation = Promise.resolve(); return; }
      operation = response.then(raw => {
        if (frozen || controller.signal.aborted) { reason = "late_or_cancelled"; return; }
        const result = acceptParallelPrefix(raw, input.question);
        if (!result.accepted) { reason = result.reason; return; }
        accepted = result;
        try { input.onAccepted?.(result); } catch { /* telemetry cannot affect selection */ }
      }).catch(() => { reason = controller.signal.aborted ? "cancelled" : "request_failed"; });
    },
    /** Never wait for a pending prefix once normal verified teaching may begin. */
    finishScene() {
      frozen = true;
      if (!accepted) controller.abort();
      input.signal?.removeEventListener("abort", stop);
      return accepted;
    },
    settled: () => operation ?? Promise.resolve(),
    snapshot: () => ({ started, accepted: accepted !== null, frozen, reason }),
  };
}
