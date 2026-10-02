import { transcriptionRequest } from "@/lib/tts/transcriptionProvider";
import { requireLessonCredits } from "@/lib/billing/gate";
import { sttConfig } from "@/lib/tts/providerConfig";
import {
  MAX_DICTATION_AUDIO_BYTES,
  validateDictationAudio,
} from "@/lib/tts/audioValidation";
import { readBoundedFormData, RequestBodyError } from "@/lib/http/requestBody";
import { reservePaidUsage } from "@/lib/billing/paidUsage";

/** Provider selection and credentials stay on the server. */
export async function POST(request: Request): Promise<Response> {
  const gated = await requireLessonCredits(request);
  if (gated instanceof Response) return gated;

  const config = sttConfig();
  const { provider, apiKey, url } = config;
  if (!apiKey) {
    // Not the student's fault and not fatal — the mic falls back to the
    // browser's own dictation, so say so in a shape the client can branch on.
    return Response.json(
      { error: "Voice input is not configured yet.", unconfigured: true },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await readBoundedFormData(
      request,
      MAX_DICTATION_AUDIO_BYTES + 64 * 1024,
    );
  } catch (error) {
    return Response.json(
      { error: "Send the recording as multipart form data." },
      { status: error instanceof RequestBodyError ? error.status : 400 },
    );
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return Response.json(
      { error: "Nothing was recorded. Hold the mic a moment longer." },
      { status: 400 },
    );
  }
  const entries = [...form.entries()];
  if (
    entries.some(([key]) => key !== "audio" && key !== "language_code") ||
    form.getAll("audio").length !== 1 ||
    form.getAll("language_code").length > 1
  ) {
    return Response.json(
      { error: "Send one audio recording." },
      { status: 400 },
    );
  }
  const languageCode = form.get("language_code");
  if (
    languageCode !== null &&
    (typeof languageCode !== "string" ||
      !/^[a-z]{2,3}(?:-[a-zA-Z]{2,4})?$/.test(languageCode))
  ) {
    return Response.json(
      { error: "That language is not supported." },
      { status: 400 },
    );
  }
  const validated = await validateDictationAudio(audio, request.signal);
  if (!validated.ok)
    return Response.json(
      {
        error: validated.error,
        ...(validated.status === 503 ? { unconfigured: true } : {}),
      },
      { status: validated.status },
    );
  const configuredRate = Number(process.env.STT_USD_PER_MINUTE ?? "0.02");
  const rate =
    Number.isFinite(configuredRate) && configuredRate > 0 && configuredRate <= 1
      ? configuredRate
      : 0.02;
  const usd = (validated.durationSeconds / 60) * rate;
  const reservation = await reservePaidUsage({
    actor: gated.actor,
    grant: gated.grant,
    kind: "stt",
    usd,
    traceId: request.headers.get("x-heytutor-trace-id") ?? undefined,
  });
  if (reservation instanceof Response) return reservation;
  const startedAt = Date.now();
  try {
    if (request.signal.aborted) {
      await reservation.cancelBeforeDispatch();
      return Response.json(
        { error: "The recording request was cancelled." },
        { status: 400 },
      );
    }
    const upstream = transcriptionRequest(
      config,
      audio,
      validated.filename,
      typeof languageCode === "string" ? languageCode : undefined,
    );
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        ...upstream,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
      });
    } catch {
      return Response.json(
        { error: "Could not reach the transcriber. Check your connection." },
        { status: 502 },
      );
    }

    if (!response.ok) {
      await response.body?.cancel();
      console.error(`[stt] ${provider} returned ${response.status}`);
      return Response.json(
        {
          error:
            response.status === 429
              ? "The transcriber is busy. Try again in a moment."
              : "Could not transcribe that. Try again.",
        },
        { status: response.status === 429 ? 429 : 502 },
      );
    }

    const data = (await response.json().catch(() => ({}))) as {
      text?: unknown;
      language_code?: unknown;
      language?: unknown;
    };
    // Decoded duration is server-owned; an empty transcript still used the vendor.
    await reservation.settle(usd);
    const text = typeof data.text === "string" ? data.text.trim() : "";
    if (!text) {
      return Response.json(
        { error: "Could not make out any speech in that." },
        { status: 422 },
      );
    }

    return Response.json({
      text,
      languageCode:
        typeof data.language_code === "string"
          ? data.language_code
          : typeof data.language === "string"
            ? data.language
            : null,
      latencyMs: Date.now() - startedAt,
    });
  } finally {
    await reservation.finish();
  }
}
