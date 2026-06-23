import { flushInBackground, recordTtsSpan } from "@/lib/langfuse";
import {
  buildElevenLabsPayload,
  DEFAULT_ELEVENLABS_MODEL,
  ELEVENLABS_TTS_BASE,
  type ElevenLabsTtsBody,
  ttsNotConfiguredResponse,
  upstreamErrorResponse,
} from "@/lib/ttsProxy";

function readTraceHeaders(request: Request): { traceId?: string; sessionId?: string } {
  return {
    traceId: request.headers.get("x-heytutor-trace-id") ?? undefined,
    sessionId: request.headers.get("x-session-id") ?? undefined,
  };
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    return ttsNotConfiguredResponse();
  }

  let body: ElevenLabsTtsBody = {};

  try {
    body = (await request.json()) as ElevenLabsTtsBody;
  } catch {
    return Response.json({ error: "invalid json body" }, { status: 400 });
  }

  const payload = buildElevenLabsPayload(body);
  const url = new URL(`${ELEVENLABS_TTS_BASE}/${voiceId}/stream/with-timestamps`);
  url.searchParams.set("optimize_streaming_latency", "3");

  const startedAt = Date.now();
  const { traceId, sessionId } = readTraceHeaders(request);
  const spokenText = typeof payload.text === "string" ? payload.text : "";
  const model =
    typeof payload.model_id === "string"
      ? payload.model_id
      : process.env.ELEVENLABS_MODEL ?? DEFAULT_ELEVENLABS_MODEL;

  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return upstreamErrorResponse(response.status, errorBody);
    }

    if (!response.body) {
      return Response.json({ error: "upstream tts stream returned no body" }, { status: 502 });
    }

    recordTtsSpan({
      traceId,
      sessionId,
      characters: spokenText.length,
      model,
      voiceId,
      transport: "http",
      latencyMs: Date.now() - startedAt,
    });
    flushInBackground();

    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
        "cache-control": "no-cache",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown tts stream proxy error";
    return Response.json({ error: message }, { status: 500 });
  }
}
