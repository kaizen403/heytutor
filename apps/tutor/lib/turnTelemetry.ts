import type { TurnTelemetryEvent } from "@/lib/langfuse";

export interface TurnTelemetryPayload {
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
  span(name: string, parentName?: string): { end(metadata?: Record<string, unknown>): void };
  setTrace(traceId: string, sessionId?: string): void;
  meta(partial: Record<string, unknown>): void;
  durationMs(): number;
  flush(): Promise<void>;
}

const BEACON_URL = "/api/trace/event";
const MAX_EVENTS = 200;

function perfToIso(perfMs: number, turnStartPerf: number, turnStartWall: number): string {
  return new Date(turnStartWall + (perfMs - turnStartPerf)).toISOString();
}

export function createTurnTelemetry(): TurnTelemetry {
  const turnStartPerf = performance.now();
  const turnStartWall = Date.now();
  const events: TurnTelemetryEvent[] = [];
  const activeSpans = new Map<string, ActiveSpan>();
  let traceId: string | undefined;
  let sessionId: string | undefined;
  const traceMetadata: Record<string, unknown> = {};

  const pushEvent = (event: TurnTelemetryEvent): void => {
    if (events.length >= MAX_EVENTS) {
      return;
    }

    events.push(event);
  };

  return {
    mark(name, metadata) {
      const nowPerf = performance.now();
      const iso = perfToIso(nowPerf, turnStartPerf, turnStartWall);

      pushEvent({
        name,
        startTime: iso,
        endTime: iso,
        metadata,
      });
    },

    span(name, parentName) {
      const startPerf = performance.now();
      activeSpans.set(name, { name, startPerf, parentName });

      return {
        end: (metadata) => {
          const active = activeSpans.get(name);

          if (!active) {
            return;
          }

          activeSpans.delete(name);
          const endPerf = performance.now();

          pushEvent({
            name,
            startTime: perfToIso(active.startPerf, turnStartPerf, turnStartWall),
            endTime: perfToIso(endPerf, turnStartPerf, turnStartWall),
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
      return Math.round(performance.now() - turnStartPerf);
    },

    async flush() {
      if (!traceId || events.length === 0) {
        return;
      }

      const payload: TurnTelemetryPayload = {
        traceId,
        sessionId,
        events,
        traceMetadata: Object.keys(traceMetadata).length > 0 ? traceMetadata : undefined,
      };

      const body = JSON.stringify(payload);

      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        const sent = navigator.sendBeacon(
          BEACON_URL,
          new Blob([body], { type: "application/json" }),
        );

        if (sent) {
          return;
        }
      }

      try {
        await fetch(BEACON_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          keepalive: true,
        });
      } catch {
        // telemetry must not block the tutor UI
      }
    },
  };
}
