import { flushInBackground, recordTtsSpan } from "@/lib/obs/langfuse";
import {
  buildElevenLabsPayload,
  DEFAULT_ELEVENLABS_MODEL,
  ELEVENLABS_TTS_BASE,
  type ElevenLabsTtsBody,
  resolveVoiceId,
  ttsNotConfiguredResponse,
  upstreamErrorResponse,
  voiceKeyFromRequest,
} from "@/lib/tts/ttsProxy";
import { requireLessonGrant } from "@/lib/billing/gate";
import { recordTtsSpend } from "@/lib/billing/track";
import { consumeTtsChars, markGrantInUse, shouldSkipTtsForUsage } from "@/lib/billing/grant";
import { ttsSkippedResponse } from "@/lib/billing/ttsSkip";

function readTraceHeaders(request: Request): { traceId?: string; sessionId?: string } {
  return {
    traceId: request.headers.get("x-heytutor-trace-id") ?? undefined,
    sessionId: request.headers.get("x-session-id") ?? undefined,
  };
}

export async function POST(request: Request): Promise<Response> {
  const gated = await requireLessonGrant(request);
  if (gated instanceof Response) return gated;
  const { actor, grant } = gated;

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = resolveVoiceId(voiceKeyFromRequest(request));

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
  const spokenText = typeof payload.text === "string" ? payload.text : "";
  if (shouldSkipTtsForUsage(grant)) {
    return ttsSkippedResponse("budget");
  }
  const budget = consumeTtsChars(grant, spokenText.length);
  if (!budget.allowed) {
    return ttsSkippedResponse("budget");
  }

  const url = new URL(`${ELEVENLABS_TTS_BASE}/${voiceId}/stream/with-timestamps`);
  url.searchParams.set("optimize_streaming_latency", "0");

  const startedAt = Date.now();
  const { traceId, sessionId } = readTraceHeaders(request);
  const model =
    typeof payload.model_id === "string"
      ? payload.model_id
      : process.env.ELEVENLABS_MODEL ?? DEFAULT_ELEVENLABS_MODEL;

  markGrantInUse(grant, 1);
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
    recordTtsSpend({
      userId: actor.userId,
      characters: spokenText.length,
      model,
      skipAutumn: actor.skipAutumn,
      skipGates: actor.skipGates,
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
  } finally {
    markGrantInUse(grant, -1);
  }
}
