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
    const validEvents = Array.isArray(events) ? events.filter(isValidEvent).slice(0, 200) : [];
    const traceMetadata = isRecord(parsed.traceMetadata) ? parsed.traceMetadata : undefined;

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
  const rawBody = await request.text();
  const body = parseBody(rawBody);

  if (!body?.traceId) {
    return Response.json({ ok: false, reason: "missing traceId" }, { status: 400 });
  }

  const events = body.events ?? [];
  if (events.length > 0) {
    recordTurnEvents({
      traceId: body.traceId,
      sessionId: body.sessionId,
      events,
    });
  }

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
