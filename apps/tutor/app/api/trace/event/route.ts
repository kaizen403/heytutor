import {
  flushSafely,
  recordTurnEvents,
  updateTurnTrace,
  type TurnTelemetryEvent,
} from "@/lib/obs/langfuse";
import { MAX_TURN_TELEMETRY_EVENTS } from "@/lib/obs/turnTelemetry";
import { ensureUser, getUserId } from "@/lib/auth";
import { assertOwnedTrace } from "@/lib/obs/traceOwnership";
import { readBoundedText, RequestBodyError } from "@/lib/http/requestBody";

interface TraceEventRequestBody {
  traceId?: string;
  sessionId?: string;
  events?: TurnTelemetryEvent[];
  traceMetadata?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidEvent(value: unknown): value is TurnTelemetryEvent {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.name === "string" && value.name.length > 0 && value.name.length <= 120 &&
    typeof value.startTime === "string" && value.startTime.length <= 40 && Number.isFinite(Date.parse(value.startTime)) &&
    typeof value.endTime === "string" && value.endTime.length <= 40 && Number.isFinite(Date.parse(value.endTime))
  );
}

function boundedMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || Array.isArray(value)) return undefined;
  const fields = Object.entries(value).slice(0, 50).flatMap<[string, unknown]>(([key, item]) => {
    if (!/^[\w.-]{1,80}$/.test(key)) return [];
    if (typeof item === "string") return [[key, item.slice(0, 500)]];
    if (typeof item === "number" && Number.isFinite(item)) return [[key, item]];
    if (typeof item === "boolean" || item === null) return [[key, item]];
    if (Array.isArray(item)) return [[key, item.slice(0, 20).filter(item => typeof item === "string").map(item => item.slice(0, 120))]];
    return [];
  });
  return Object.fromEntries(fields);
}

function parseBody(rawBody: string): TraceEventRequestBody | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);

    if (!isRecord(parsed)) {
      return null;
    }

    const events = parsed.events;
    const validEvents = Array.isArray(events)
      ? events.filter(isValidEvent).slice(0, MAX_TURN_TELEMETRY_EVENTS).map(event => ({
          name: event.name,
          startTime: event.startTime,
          endTime: event.endTime,
          parentName: typeof event.parentName === "string" ? event.parentName.slice(0, 120) : undefined,
          level: event.level === "DEBUG" || event.level === "WARNING" || event.level === "ERROR" ? event.level : "DEFAULT" as const,
          metadata: { ...boundedMetadata(event.metadata), client_reported: true },
        }))
      : [];
    const traceMetadata = boundedMetadata(parsed.traceMetadata);

    if (validEvents.length === 0 && !traceMetadata) {
      return null;
    }

    return {
      traceId: typeof parsed.traceId === "string" ? parsed.traceId : undefined,
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
      events: validEvents,
      traceMetadata,
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const userId = await getUserId();
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  await ensureUser(userId);

  let rawBody: string;
  try {
    rawBody = await readBoundedText(request, 128 * 1024);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "invalid request body" }, { status: error instanceof RequestBodyError ? error.status : 400 });
  }
  const body = parseBody(rawBody);

  if (!body?.traceId) {
    return Response.json({ ok: false, reason: "missing traceId" }, { status: 400 });
  }
  if (!(await assertOwnedTrace(userId, body.traceId, body.sessionId))) {
    return Response.json({ error: "trace not found" }, { status: 404 });
  }

  const events = body.events ?? [];
  if (events.length > 0) {
    recordTurnEvents({
      userId,
      traceId: body.traceId,
      sessionId: body.sessionId,
      events,
    });
  }

  if (body.traceMetadata) {
    updateTurnTrace({
      userId,
      traceId: body.traceId,
      sessionId: body.sessionId,
      // Client timing and outcome reports are diagnostics, never server cost,
      // ownership, entitlement, or verification authority.
      metadata: { client_telemetry: body.traceMetadata },
    });
  }

  await flushSafely();

  return Response.json({ ok: true, events: body.events?.length ?? 0 });
}
