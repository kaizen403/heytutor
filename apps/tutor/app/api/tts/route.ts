import { flushInBackground, recordTtsSpan } from "@/lib/langfuse";
import {
  DEFAULT_ELEVENLABS_MODEL,
  ELEVENLABS_TTS_BASE,
  upstreamErrorResponse,
} from "@/lib/ttsProxy";
import { getUserId } from "@/lib/auth";

interface TtsRequestBody {
  text?: string;
  model_id?: string;
}

function readTraceHeaders(request: Request): { traceId?: string; sessionId?: string } {
  return {
    traceId: request.headers.get("x-heytutor-trace-id") ?? undefined,
    sessionId: request.headers.get("x-session-id") ?? undefined,
  };
}

function parseTtsBody(body: string): { text: string; modelId?: string } {
  try {
    const parsed = JSON.parse(body) as TtsRequestBody;
    return {
      text: typeof parsed.text === "string" ? parsed.text : "",
      modelId: typeof parsed.model_id === "string" ? parsed.model_id : undefined,
    };
  } catch {
    return { text: body };
  }
}

async function recordTtsFromRequest(
  request: Request,
  transport: "http" | "browser-fallback",
  latencyMs: number,
  body: string,
): Promise<void> {
  const { traceId, sessionId } = readTraceHeaders(request);
  const { text, modelId } = parseTtsBody(body);
  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? "unknown";
  const model = modelId ?? process.env.ELEVENLABS_MODEL ?? DEFAULT_ELEVENLABS_MODEL;

  recordTtsSpan({
    traceId,
    sessionId,
    characters: text.length,
    model,
    voiceId,
    transport,
    latencyMs,
  });

  flushInBackground();
}

export async function POST(request: Request): Promise<Response> {
  const userId = await getUserId();
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.text();
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const transport = request.headers.get("x-tts-transport") === "browser-fallback"
    ? "browser-fallback"
    : "http";

  if (transport === "browser-fallback") {
    await recordTtsFromRequest(request, "browser-fallback", 0, body);

    return new Response(null, { status: 204 });
  }

  if (!apiKey || !voiceId) {
    return new Response(new Uint8Array(), {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    });
  }

  const url = new URL(request.url);

  if (url.searchParams.get("timestamps") === "true") {
    return handleTTSWithTimestamps(request, body, apiKey, voiceId);
  }

  return handleTTS(request, body, apiKey, voiceId);
}

async function handleTTS(
  request: Request,
  body: string,
  apiKey: string,
  voiceId: string,
): Promise<Response> {
  const startedAt = Date.now();

  try {
    const response = await fetch(`${ELEVENLABS_TTS_BASE}/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return upstreamErrorResponse(response.status, errorBody);
    }

    await recordTtsFromRequest(request, "http", Date.now() - startedAt, body);

    return new Response(response.body, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "audio/mpeg" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown tts proxy error";
    return Response.json({ error: message }, { status: 500 });
  }
}

async function handleTTSWithTimestamps(
  request: Request,
  body: string,
  apiKey: string,
  voiceId: string,
): Promise<Response> {
  const startedAt = Date.now();

  try {
    const response = await fetch(`${ELEVENLABS_TTS_BASE}/${voiceId}/stream/with-timestamps`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return upstreamErrorResponse(response.status, errorBody);
    }

    await recordTtsFromRequest(request, "http", Date.now() - startedAt, body);

    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
        "cache-control": "no-cache",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown tts timestamps proxy error";
    return Response.json({ error: message }, { status: 500 });
  }
}
