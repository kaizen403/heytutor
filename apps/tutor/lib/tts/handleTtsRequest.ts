import { flushInBackground, recordTtsSpan } from "../obs/langfuse";
import { requireLessonGrant } from "../billing/gate";
import { recordTtsSpend } from "../billing/track";
import { reservePaidUsage, holdPaidUsage } from "../billing/paidUsage";
import { calculateTtsCostDetails } from "../obs/usageCost";
import { readBoundedJson, RequestBodyError } from "../http/requestBody";
import {
  consumeTtsChars,
  markGrantInUse,
  shouldSkipTtsForUsage,
} from "../billing/grant";
import { ttsSkippedResponse } from "../billing/ttsSkip";
import { ttsConfig } from "./providerConfig";
import { requestTts } from "./ttsProvider";
import {
  ttsNotConfiguredResponse,
  voiceKeyFromRequest,
  type SpeechRequestBody,
} from "./ttsProxy";

export async function handleTtsRequest(
  request: Request,
  timestamps: boolean,
): Promise<Response> {
  const gated = await requireLessonGrant(request);
  if (gated instanceof Response) return gated;
  const { actor, grant } = gated;
  let body: SpeechRequestBody;
  try {
    body = await readBoundedJson(request, 96 * 1024);
    if (
      !body ||
      typeof body.text !== "string" ||
      !body.text.trim() ||
      body.text.length > 20_000
    )
      throw new Error("Invalid text");
  } catch (error) {
    return Response.json(
      { error: "Send non-empty speech text (up to 20000 characters)." },
      { status: error instanceof RequestBodyError ? error.status : 400 },
    );
  }
  const config = ttsConfig(
    voiceKeyFromRequest(request),
    body.low_latency === true || body.model_id === "eleven_flash_v2_5",
  );
  const browserFallback =
    request.headers.get("x-tts-transport") === "browser-fallback";
  const record = (latencyMs: number) => {
    recordTtsSpan({
      userId: actor.userId,
      traceId: request.headers.get("x-heytutor-trace-id") ?? undefined,
      sessionId: request.headers.get("x-session-id") ?? undefined,
      characters: body.text!.length,
      model: config.model,
      provider: config.provider,
      voiceId: config.voiceId ?? "unknown",
      transport: browserFallback ? "browser-fallback" : "http",
      latencyMs,
    });
    if (!browserFallback)
      recordTtsSpend({
        userId: actor.userId,
        characters: body.text!.length,
        model: config.model,
        provider: config.provider,
        skipAutumn: actor.skipAutumn,
        skipGates: actor.skipGates,
        accounted: true,
      });
    flushInBackground();
  };
  if (browserFallback) {
    record(0);
    return new Response(null, { status: 204 });
  }
  if (!config.apiKey || !config.voiceId) return ttsNotConfiguredResponse();
  if (
    shouldSkipTtsForUsage(grant) ||
    !consumeTtsChars(grant, body.text!.length).allowed
  )
    return ttsSkippedResponse("budget");
  const startedAt = Date.now();
  const reservation = await reservePaidUsage({ actor, grant, kind: "tts", traceId: request.headers.get("x-heytutor-trace-id") ?? undefined, usd: calculateTtsCostDetails(body.text.length, config).total ?? 0 });
  if (reservation instanceof Response) return reservation;
  markGrantInUse(grant, 1);
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      markGrantInUse(grant, -1);
    }
  };
  try {
    const response = await requestTts(config, body, timestamps, AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]));
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      release();
      await reservation.finish();
      return Response.json(
        {
          error: "Speech provider request failed",
          provider: config.provider,
          upstream_status: response.status,
        },
        { status: response.status === 429 ? 429 : 502 },
      );
    }
    const reader = response.body.getReader();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { value, done } = await reader.read();
          if (done) {
            record(Date.now() - startedAt);
            release();
            controller.close();
          } else controller.enqueue(value);
        } catch (error) {
          release();
          controller.error(error);
          await reader.cancel().catch(() => {});
        }
      },
      async cancel(reason) {
        release();
        await reader.cancel(reason);
      },
    });
    return new Response(holdPaidUsage(stream, reservation), {
      headers: {
        "content-type": response.headers.get("content-type") ?? "audio/mpeg",
        "cache-control": "no-store",
      },
    });
  } catch {
    release();
    await reservation.finish();
    return Response.json(
      { error: "Speech is temporarily unavailable. Please retry." },
      { status: 502 },
    );
  }
}
