import { getUserId } from "@/lib/auth";

const ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
const DEFAULT_STT_MODEL = "scribe_v1";
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

/**
 * Speech-to-text for the mic in the ask bar.
 *
 * Deliberately reads `ELEVENLABS_STT_API_KEY` and not the `ELEVENLABS_API_KEY`
 * the narration uses: dictation and lesson audio are separate budgets, and one
 * running dry or being rotated must not silence the other.
 */
export async function POST(request: Request): Promise<Response> {
  const userId = await getUserId();
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ELEVENLABS_STT_API_KEY;
  if (!apiKey) {
    // Not the student's fault and not fatal — the mic falls back to the
    // browser's own dictation, so say so in a shape the client can branch on.
    return Response.json(
      { error: "Voice input needs ELEVENLABS_STT_API_KEY.", unconfigured: true },
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

  const upstream = new FormData();
  upstream.set("file", audio, filenameForAudio(audio.type));
  upstream.set("model_id", process.env.ELEVENLABS_STT_MODEL ?? DEFAULT_STT_MODEL);
  // Punctuation is wanted; "(laughs)" and "(background noise)" are not — they
  // would be typed straight into the question box.
  upstream.set("tag_audio_events", "false");
  upstream.set("diarize", "false");
  const languageCode = form.get("language_code");
  if (typeof languageCode === "string" && languageCode.trim()) {
    upstream.set("language_code", languageCode.trim());
  }

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(ELEVENLABS_STT_URL, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: upstream,
    });
  } catch {
    return Response.json(
      { error: "Could not reach the transcriber. Check your connection." },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[stt] elevenlabs ${response.status}: ${detail.slice(0, 400)}`);
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
    languageCode: typeof data.language_code === "string" ? data.language_code : null,
    latencyMs: Date.now() - startedAt,
  });
}
