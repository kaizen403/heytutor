import type { TurnTelemetryEvent } from "@/lib/obs/langfuse";
import { resolveApiUrl } from "@heytutor/tutor-core";

interface TurnTelemetryPayload {
  traceId: string;
  sessionId?: string;
  events: TurnTelemetryEvent[];
  traceMetadata?: Record<string, unknown>;
}

interface ActiveSpan {
  name: string;
  startPerf: number;
  parentName?: string;
}

export interface TurnTelemetry {
  mark(name: string, metadata?: Record<string, unknown>): void;
  /** Marks `name` the first time only; true when this call emitted it. */
  markOnce(name: string, metadata?: Record<string, unknown>): boolean;
  span(name: string, parentName?: string): { end(metadata?: Record<string, unknown>): void };
  setTrace(traceId: string, sessionId?: string): void;
  meta(partial: Record<string, unknown>): void;
  /** Milliseconds since the turn's origin: the Ask click when one was given. */
  durationMs(): number;
  /**
   * Sends what is buffered without ending the turn. Every event leaves once;
   * a later checkpoint or the final flush sends only what came after it.
   */
  checkpoint(reason: string): Promise<void>;
  /**
   * Checkpoints on pagehide and on the tab going hidden, so a student who
   * closes the tab mid planning still leaves the turn's timings behind. The
   * final flush removes the listeners.
   */
  watchPageLifecycle(): void;
  flush(): Promise<void>;
}

/** Verified scene decisions need headroom; keep them over per-character noise. */
export const MAX_TURN_TELEMETRY_EVENTS = 400;

/**
 * Startup latency events. A full buffer evicts anything else before one of
 * these, so the Ask to first voice story survives a write-heavy turn. Span
 * names are the planner's children; marks come from planning, the teaching
 * stream, and the voice.
 */
export const STARTUP_PRIORITY_EVENTS = [
  "startup-ask",
  "thinking",
  "websocket-connect",
  "planner",
  "turn-plan",
  "problem-ir",
  "deterministic-figure",
  "scene-planner",
  "revalidate",
  "teaching-request",
  "teaching-first-token",
  "teaching-first-step",
  "teaching-hedge-start",
  "teaching-hedge-winner",
  "scene-speculative-start",
  "scene-speculative-abort",
  "tts-first-byte",
  "first-audible",
  "turn-checkpoint",
] as const;

const STARTUP_PRIORITY_SET = new Set<string>(STARTUP_PRIORITY_EVENTS);

/** Prefer keeping named decision events when the budget is tight. */
const DECISION_EVENT_PREFIXES = [
  "verified-scene",
  "unverified-draw-blocked",
  "draw-complete",
  "write-schedule-ready",
  "tts-timing-",
  "tts-startup-",
  "planner",
  "thinking",
] as const;

/** 2 startup, 1 decision, 0 noise. A full buffer only evicts a lower tier. */
export function turnTelemetryEventTier(name: string): 0 | 1 | 2 {
  if (STARTUP_PRIORITY_SET.has(name)) return 2;
  return DECISION_EVENT_PREFIXES.some(
    (prefix) => name === prefix || name.startsWith(prefix),
  )
    ? 1
    : 0;
}

/**
 * Keepalive fetch and sendBeacon both refuse bodies past 64 KiB. A batch
 * above this is split so a pagehide checkpoint is not silently dropped.
 */
const MAX_TELEMETRY_BODY_CHARS = 60_000;

/** Seams for the verify script; production reads the browser globals. */
export interface TurnTelemetryEnv {
  now(): number;
  wallNow(): number;
  send(body: string, options: { beacon: boolean }): Promise<void>;
  /** Window-like target for `pagehide`; null where there is no page. */
  window: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null;
  /** Document-like target for `visibilitychange`; null where there is no page. */
  document: (Pick<EventTarget, "addEventListener" | "removeEventListener"> & {
    visibilityState?: string;
  }) | null;
}

export interface CreateTurnTelemetryOptions {
  /**
   * `performance.now()` at the Ask click. Billing, the board commit and the
   * board epoch run before the turn's telemetry exists; with this origin
   * every mark and `durationMs()` still count from the click.
   */
  originPerf?: number;
  env?: Partial<TurnTelemetryEnv>;
}

async function sendTelemetryBody(body: string, { beacon }: { beacon: boolean }): Promise<void> {
  const beaconUrl = resolveApiUrl("/api/trace/event");
  const canBeacon = typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function";

  // A page being hidden or unloaded may never run a fetch's continuation;
  // the beacon is queued by the browser itself.
  if (beacon && canBeacon) {
    try {
      if (navigator.sendBeacon(beaconUrl, new Blob([body], { type: "application/json" }))) {
        return;
      }
    } catch {
      // fall through to keepalive fetch
    }
  }

  try {
    await fetch(beaconUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    });
    return;
  } catch {
    // fall through to sendBeacon
  }

  if (!beacon && canBeacon) {
    navigator.sendBeacon(
      beaconUrl,
      new Blob([body], { type: "application/json" }),
    );
  }
}

function defaultEnv(): TurnTelemetryEnv {
  return {
    now: () => performance.now(),
    wallNow: () => Date.now(),
    send: sendTelemetryBody,
    window: typeof window !== "undefined" && typeof window.addEventListener === "function"
      ? window
      : null,
    document: typeof document !== "undefined" && typeof document.addEventListener === "function"
      ? document
      : null,
  };
}

/** Splits a payload until every body fits a keepalive request. */
function payloadBodies(payload: TurnTelemetryPayload): string[] {
  const body = JSON.stringify(payload);
  if (body.length <= MAX_TELEMETRY_BODY_CHARS || payload.events.length <= 1) {
    return [body];
  }
  const half = Math.ceil(payload.events.length / 2);
  return [
    ...payloadBodies({ ...payload, events: payload.events.slice(0, half) }),
    ...payloadBodies({ ...payload, events: payload.events.slice(half), traceMetadata: undefined }),
  ];
}

export function createTurnTelemetry(options: CreateTurnTelemetryOptions = {}): TurnTelemetry {
  const env: TurnTelemetryEnv = { ...defaultEnv(), ...options.env };
  const createdPerf = env.now();
  const originPerf = typeof options.originPerf === "number" && Number.isFinite(options.originPerf) &&
    options.originPerf <= createdPerf
    ? options.originPerf
    : createdPerf;
  // Wall time of the origin, so ISO timestamps line up with server spans.
  const originWall = env.wallNow() - (createdPerf - originPerf);
  const perfToIso = (perfMs: number): string =>
    new Date(originWall + (perfMs - originPerf)).toISOString();

  const events: TurnTelemetryEvent[] = [];
  const activeSpans = new Map<string, ActiveSpan>();
  const markedOnce = new Set<string>();
  let traceId: string | undefined;
  let sessionId: string | undefined;
  const traceMetadata: Record<string, unknown> = {};
  let droppedEvents = 0;
  let lastSentMetadata: string | null = null;
  let removeLifecycle: (() => void) | null = null;

  const pushEvent = (event: TurnTelemetryEvent): void => {
    if (events.length < MAX_TURN_TELEMETRY_EVENTS) {
      events.push(event);
      return;
    }

    // Drop per-character write noise first so optics decision events survive,
    // and decision events before the startup timeline.
    const tier = turnTelemetryEventTier(event.name);
    const dropIndex = tier === 0
      ? -1
      : events.findIndex((existing) => turnTelemetryEventTier(existing.name) < tier);
    droppedEvents += 1;
    if (dropIndex >= 0) {
      events.splice(dropIndex, 1);
      events.push(event);
    }
  };

  const mark = (name: string, metadata?: Record<string, unknown>): void => {
    const iso = perfToIso(env.now());

    pushEvent({
      name,
      startTime: iso,
      endTime: iso,
      metadata,
    });
  };

  const metadataForSend = (): Record<string, unknown> | undefined => {
    if (droppedEvents > 0) traceMetadata.telemetry_dropped_events = droppedEvents;
    return Object.keys(traceMetadata).length > 0 ? { ...traceMetadata } : undefined;
  };

  const send = async (
    pendingEvents: TurnTelemetryEvent[],
    pendingMetadata: Record<string, unknown> | undefined,
    beacon: boolean,
  ): Promise<void> => {
    if (!traceId || (pendingEvents.length === 0 && !pendingMetadata)) {
      return;
    }
    try {
      const bodies = payloadBodies({
        traceId,
        sessionId,
        events: pendingEvents,
        traceMetadata: pendingMetadata,
      });
      // Sent together: a pagehide may not run anything queued after it.
      await Promise.all(bodies.map((body) => env.send(body, { beacon }).catch(() => undefined)));
    } catch {
      // Telemetry never throws into the turn.
    }
  };

  /**
   * Takes everything not yet sent. A mid-turn checkpoint holds a child back
   * while its parent span is still open, so Langfuse can nest it once the
   * parent lands; a page going away sends it anyway, flagged.
   */
  const takePending = (includeOpenChildren: boolean): TurnTelemetryEvent[] => {
    const taken: TurnTelemetryEvent[] = [];
    const kept: TurnTelemetryEvent[] = [];
    for (const event of events) {
      const parentOpen = event.parentName ? activeSpans.has(event.parentName) : false;
      if (!parentOpen) taken.push(event);
      else if (includeOpenChildren) {
        taken.push({ ...event, metadata: { ...event.metadata, parent_open: true, parent_span: event.parentName } });
      } else kept.push(event);
    }
    events.splice(0, events.length, ...kept);
    return taken;
  };

  const checkpoint = async (reason: string, lifecycle = false): Promise<void> => {
    try {
      // Without a trace the events stay buffered for the next send.
      if (!traceId) return;
      if (lifecycle) {
        mark("turn-checkpoint", {
          reason,
          since_ask_ms: Math.round(env.now() - originPerf),
          open_spans: [...activeSpans.keys()].slice(0, 20),
        });
      }
      const pendingEvents = takePending(lifecycle);
      const metadata = metadataForSend();
      const metadataJson = metadata ? JSON.stringify(metadata) : null;
      const pendingMetadata = metadataJson !== lastSentMetadata ? metadata : undefined;
      lastSentMetadata = metadataJson;
      await send(pendingEvents, pendingMetadata, lifecycle);
    } catch {
      // Telemetry never throws into the turn.
    }
  };

  return {
    mark,

    markOnce(name, metadata) {
      if (markedOnce.has(name)) return false;
      markedOnce.add(name);
      mark(name, metadata);
      return true;
    },

    span(name, parentName) {
      const startPerf = env.now();
      activeSpans.set(name, { name, startPerf, parentName });

      return {
        end: (metadata) => {
          const active = activeSpans.get(name);

          if (!active) {
            return;
          }

          activeSpans.delete(name);
          const endPerf = env.now();

          pushEvent({
            name,
            startTime: perfToIso(active.startPerf),
            endTime: perfToIso(endPerf),
            metadata,
            parentName: active.parentName,
          });
        },
      };
    },

    setTrace(nextTraceId, nextSessionId) {
      traceId = nextTraceId;
      sessionId = nextSessionId;
    },

    meta(partial) {
      Object.assign(traceMetadata, partial);
    },

    durationMs() {
      return Math.round(env.now() - originPerf);
    },

    checkpoint(reason) {
      return checkpoint(reason, false);
    },

    watchPageLifecycle() {
      if (removeLifecycle) return;
      const target = env.window;
      const doc = env.document;
      const onPageHide = () => { void checkpoint("pagehide", true); };
      const onVisibility = () => {
        if (doc?.visibilityState === "hidden") void checkpoint("hidden", true);
      };
      try {
        target?.addEventListener("pagehide", onPageHide);
        doc?.addEventListener("visibilitychange", onVisibility);
      } catch {
        return;
      }
      removeLifecycle = () => {
        try {
          target?.removeEventListener("pagehide", onPageHide);
          doc?.removeEventListener("visibilitychange", onVisibility);
        } catch {
          // ignore
        }
      };
    },

    async flush() {
      // The turn is over: a later hide has nothing of this turn to save.
      removeLifecycle?.();
      removeLifecycle = null;

      if (!traceId) {
        return;
      }

      // Drain so a cancel flush plus the turn's `finally` flush cannot
      // duplicate every span. Metadata is resent so later fields still land.
      const pendingEvents = events.splice(0, events.length);
      const pendingMetadata = metadataForSend();
      lastSentMetadata = pendingMetadata ? JSON.stringify(pendingMetadata) : null;

      await send(pendingEvents, pendingMetadata, false);
    },
  };
}

type FirstByteTransport = "ws" | "http";

/**
 * `tts-first-byte` for one segment. Takes an unknown telemetry shape because
 * verify fakes and replay refs carry partial objects; never throws.
 */
export function recordTtsFirstByte(
  tel: TurnTelemetry | null | undefined,
  info: { segmentIndex: number; sinceRequestMs: number; transport: FirstByteTransport; prefetched: boolean },
): void {
  try {
    if (typeof tel?.mark !== "function") return;
    tel.mark("tts-first-byte", {
      segment_index: info.segmentIndex,
      since_request_ms: Math.max(0, Math.round(info.sinceRequestMs)),
      transport: info.transport,
      prefetched: info.prefetched,
    });
  } catch {
    // Telemetry never throws into the turn.
  }
}

/**
 * Which signal said the voice became audible.
 * - `html-audio-playing`: the media element's `playing` event or its `play()`
 *   promise resolving, whichever came first. Both mean the element left the
 *   paused state with data to play.
 * - `audio-context-scheduled`: a buffer source was scheduled `leadMs` ahead
 *   of the context clock; the lead is added to `since_ask_ms`.
 * - `speech-synthesis-start`: the browser voice's `start` event.
 */
export type FirstAudibleSignal =
  | "html-audio-playing"
  | "audio-context-scheduled"
  | "speech-synthesis-start"
  | "unknown";

/**
 * `first-audible`, once per turn, then a checkpoint so the startup timeline
 * reaches Langfuse even if the student leaves mid lesson.
 */
export function recordFirstAudible(
  tel: TurnTelemetry | null | undefined,
  info: { segmentIndex: number; transport: "provider" | "browser"; signal: FirstAudibleSignal; leadMs: number },
): void {
  try {
    if (typeof tel?.markOnce !== "function" || typeof tel.durationMs !== "function") return;
    const leadMs = Number.isFinite(info.leadMs) ? Math.max(0, Math.round(info.leadMs)) : 0;
    const sinceAskMs = tel.durationMs() + leadMs;
    if (!tel.markOnce("first-audible", {
      since_ask_ms: sinceAskMs,
      segment_index: info.segmentIndex,
      transport: info.transport,
      signal: info.signal,
      scheduled_lead_ms: leadMs,
    })) return;
    tel.meta({ first_audible_since_ask_ms: sinceAskMs });
    void tel.checkpoint("first-audible");
  } catch {
    // Telemetry never throws into the turn.
  }
}
