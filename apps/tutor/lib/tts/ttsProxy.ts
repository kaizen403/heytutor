import { availableVoiceKeys, ttsConfig } from "./providerConfig";
import {
  normalizeVoiceKey,
  TTS_LANG_HEADER,
  type TutorVoiceKey,
} from "@heytutor/tutor-core";

export const ELEVENLABS_TTS_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
export const DEFAULT_ELEVENLABS_MODEL = "eleven_multilingual_v2";

/**
 * Low-latency alternative to the default model. Settings exposes this as
 * "Response speed"; the client sends the model id it wants per request.
 */
export const LOW_LATENCY_ELEVENLABS_MODEL = "eleven_flash_v2_5";

/** Compatibility exports; provider selection and voice configuration have one owner. */
export function resolveVoiceId(voiceKey: TutorVoiceKey): string | undefined {
  return ttsConfig(voiceKey).voiceId;
}
export function configuredVoiceKeys(): TutorVoiceKey[] { return availableVoiceKeys(); }

export function voiceKeyFromRequest(request: Request): TutorVoiceKey {
  return normalizeVoiceKey(request.headers.get(TTS_LANG_HEADER));
}

export interface SpeechRequestBody {
  low_latency?: boolean;
  text?: string;
  model_id?: string;
  voice_settings?: Record<string, number>;
  previous_text?: string;
  next_text?: string;
}

export function missingTtsConfig(): string[] {
  const config = ttsConfig();
  const prefix = config.provider.toUpperCase();
  const missing: string[] = [];
  if (!config.apiKey) missing.push(`${prefix}_API_KEY`);
  if (!config.voiceId) missing.push(`${prefix}_VOICE_ID`);

  return missing;
}

export function buildElevenLabsPayload(body: SpeechRequestBody): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    text: typeof body.text === "string" ? body.text : "",
    model_id: body.model_id ?? process.env.ELEVENLABS_MODEL ?? DEFAULT_ELEVENLABS_MODEL,
  };

  if (body.voice_settings && typeof body.voice_settings === "object") {
    payload.voice_settings = body.voice_settings;
  }

  if (typeof body.previous_text === "string" && body.previous_text.length > 0) {
    payload.previous_text = body.previous_text;
  }

  if (typeof body.next_text === "string" && body.next_text.length > 0) {
    payload.next_text = body.next_text;
  }

  return payload;
}

function redactSecrets(text: string): string {
  return text
    .replace(/sk_[a-zA-Z0-9]+/g, "[redacted]")
    .replace(/xi-api-key[:\s]+[^\s"']+/gi, "xi-api-key: [redacted]");
}

export function parseUpstreamErrorMessage(errorBody: string): string {
  const trimmed = errorBody.trim();

  if (!trimmed) {
    return "upstream tts request failed";
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      detail?: unknown;
      message?: string;
      error?: string;
    };

    if (typeof parsed.message === "string") {
      return redactSecrets(parsed.message);
    }

    if (typeof parsed.error === "string") {
      return redactSecrets(parsed.error);
    }

    if (typeof parsed.detail === "string") {
      return redactSecrets(parsed.detail);
    }

    if (typeof parsed.detail === "object" && parsed.detail !== null) {
      if ("message" in parsed.detail && typeof parsed.detail.message === "string") {
        return redactSecrets(parsed.detail.message);
      }
    }

    if (Array.isArray(parsed.detail)) {
      const messages = parsed.detail
        .map((item) => {
          if (typeof item === "object" && item !== null && "msg" in item) {
            return String((item as { msg: unknown }).msg);
          }

          return null;
        })
        .filter((message): message is string => Boolean(message));

      if (messages.length > 0) {
        return redactSecrets(messages.join("; "));
      }
    }
  } catch {
    // fall through to raw body
  }

  const redacted = redactSecrets(trimmed);
  return redacted.length > 500 ? `${redacted.slice(0, 500)}…` : redacted;
}

export function upstreamErrorResponse(status: number, errorBody: string): Response {
  return Response.json(
    {
      error: "Speech provider request failed",
      upstream_status: status,
      upstream_message: parseUpstreamErrorMessage(errorBody),
    },
    { status },
  );
}

export function ttsNotConfiguredResponse(): Response {
  return Response.json(
    {
      error: "tts not configured",
      missing_env: missingTtsConfig(),
    },
    { status: 503 },
  );
}

/** Legacy import compatibility. */
export type ElevenLabsTtsBody = SpeechRequestBody;
