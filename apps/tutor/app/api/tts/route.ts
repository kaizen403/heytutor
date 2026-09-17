import { flushInBackground, recordTtsSpan } from "@/lib/obs/langfuse";
import {
  DEFAULT_ELEVENLABS_MODEL,
  ELEVENLABS_TTS_BASE,
  resolveVoiceId,
  upstreamErrorResponse,
  voiceKeyFromRequest,
} from "@/lib/tts/ttsProxy";
import { requireLessonGrant } from "@/lib/billing/gate";
import { recordTtsSpend } from "@/lib/billing/track";
import { consumeTtsChars, markGrantInUse, shouldSkipTtsForUsage } from "@/lib/billing/grant";
import { ttsSkippedResponse } from "@/lib/billing/ttsSkip";
import type { SpendActor } from "@/lib/billing/actor";

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
  actor?: SpendActor,
): Promise<void> {
  const { traceId, sessionId } = readTraceHeaders(request);
  const { text, modelId } = parseTtsBody(body);
  const voiceId = resolveVoiceId(voiceKeyFromRequest(request)) ?? "unknown";
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

  if (actor && transport !== "browser-fallback") {
    recordTtsSpend({
      userId: actor.userId,
      characters: text.length,
      skipAutumn: actor.skipAutumn,
      skipGates: actor.skipGates,
    });
  }

  flushInBackground();
}

export async function POST(request: Request): Promise<Response> {
  const gated = await requireLessonGrant(request);
  if (gated instanceof Response) return gated;
  const { actor, grant } = gated;

  const body = await request.text();
  const { text } = parseTtsBody(body);
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = resolveVoiceId(voiceKeyFromRequest(request));
  const transport = request.headers.get("x-tts-transport") === "browser-fallback"
    ? "browser-fallback"
    : "http";

  if (transport === "browser-fallback") {
    await recordTtsFromRequest(request, "browser-fallback", 0, body, actor);

    return new Response(null, { status: 204 });
  }

  if (!apiKey || !voiceId) {
    return ttsSkippedResponse("unconfigured");
  }

  if (shouldSkipTtsForUsage(grant)) {
    return ttsSkippedResponse("budget");
  }
  const budget = consumeTtsChars(grant, text.length);
  if (!budget.allowed) {
    return ttsSkippedResponse("budget");
  }

  const url = new URL(request.url);
  markGrantInUse(grant, 1);
  try {
    if (url.searchParams.get("timestamps") === "true") {
      return await handleTTSWithTimestamps(request, body, apiKey, voiceId, actor);
    }

    return await handleTTS(request, body, apiKey, voiceId, actor);
  } finally {
    markGrantInUse(grant, -1);
  }
}

async function handleTTS(
  request: Request,
  body: string,
  apiKey: string,
  voiceId: string,
  actor: SpendActor,
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

    await recordTtsFromRequest(request, "http", Date.now() - startedAt, body, actor);

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
  actor: SpendActor,
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

    await recordTtsFromRequest(request, "http", Date.now() - startedAt, body, actor);

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
