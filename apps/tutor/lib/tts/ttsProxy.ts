import { availableVoiceKeys, ttsConfig } from "./providerConfig";
import {
  normalizeVoiceKey,
  TTS_LANG_HEADER,
  type TutorVoiceKey,
  type TutorVoiceSettings,
} from "@heytutor/tutor-core";

export const ELEVENLABS_TTS_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_ELEVENLABS_MODEL = "eleven_multilingual_v2";

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
  voice_settings?: TutorVoiceSettings;
  previous_text?: string;
  next_text?: string;
}

function missingTtsConfig(): string[] {
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

export function ttsNotConfiguredResponse(): Response {
  return Response.json(
    {
      error: "tts not configured",
      missing_env: missingTtsConfig(),
    },
    { status: 503 },
  );
}
