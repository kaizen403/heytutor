import {
  flushInBackground,
  recordTurnEvents,
  updateTurnTrace,
  type TurnTelemetryEvent,
} from "@/lib/langfuse";
import { enrichTraceMetadataWithCosts } from "@/lib/usageCost";

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
    typeof value.name === "string" &&
    typeof value.startTime === "string" &&
    typeof value.endTime === "string"
  );
}

function parseBody(rawBody: string): TraceEventRequestBody | null {
  try {
    const parsed: unknown = JSON.parse(rawBody);

    if (!isRecord(parsed)) {
      return null;
    }

    const events = parsed.events;

    if (!Array.isArray(events)) {
      return null;
    }

    const validEvents = events.filter(isValidEvent);

    if (validEvents.length === 0) {
      return null;
    }

    return {
      traceId: typeof parsed.traceId === "string" ? parsed.traceId : undefined,
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
      events: validEvents.slice(0, 200),
      traceMetadata: isRecord(parsed.traceMetadata) ? parsed.traceMetadata : undefined,
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const body = parseBody(rawBody);

  if (!body?.traceId) {
    return Response.json({ ok: false, reason: "missing traceId or events" }, { status: 400 });
  }

  recordTurnEvents({
    traceId: body.traceId,
    sessionId: body.sessionId,
    events: body.events ?? [],
  });

  if (body.traceMetadata) {
    updateTurnTrace({
      traceId: body.traceId,
      sessionId: body.sessionId,
      metadata: enrichTraceMetadataWithCosts(body.traceMetadata),
    });
  }

  flushInBackground();

  return Response.json({ ok: true, events: body.events?.length ?? 0 });
}
