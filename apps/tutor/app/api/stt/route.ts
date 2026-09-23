import { transcriptionRequest } from "@/lib/tts/transcriptionProvider";
import { requireLessonCredits } from "@/lib/billing/gate";

import { sttConfig } from "@/lib/tts/providerConfig";

/** A minute of browser-encoded speech is well under this; the cap is for junk. */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/**
 * ElevenLabs picks the decoder off the filename, so a blob named `.bin` is
 * rejected even when the bytes are fine. MediaRecorder gives us the container
 * in the blob's MIME type; translate it into an extension it recognises.
 */
function filenameForAudio(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "audio/mp4" || base === "audio/aac" || base === "audio/x-m4a") return "dictation.mp4";
  if (base === "audio/mpeg" || base === "audio/mp3") return "dictation.mp3";
  if (base === "audio/wav" || base === "audio/x-wav") return "dictation.wav";
  if (base === "audio/ogg") return "dictation.ogg";
  return "dictation.webm";
}

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
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "Send the recording as multipart form data." },
      { status: 400 },
    );
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return Response.json(
      { error: "Nothing was recorded. Hold the mic a moment longer." },
      { status: 400 },
    );
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return Response.json(
      { error: "That recording is too long. Keep it under a minute." },
      { status: 413 },
    );
  }
  if (audio.type && !audio.type.startsWith("audio/")) {
    return Response.json({ error: "That is not an audio recording." }, { status: 400 });
  }

  const languageCode = form.get("language_code");
  const upstream = transcriptionRequest(config, audio, filenameForAudio(audio.type),
    typeof languageCode === "string" ? languageCode : undefined);

  const startedAt = Date.now();
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
  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!text) {
    return Response.json(
      { error: "Could not make out any speech in that." },
      { status: 422 },
    );
  }

  return Response.json({
    text,
    languageCode: typeof data.language_code === "string" ? data.language_code : typeof data.language === "string" ? data.language : null,
    latencyMs: Date.now() - startedAt,
  });
}
