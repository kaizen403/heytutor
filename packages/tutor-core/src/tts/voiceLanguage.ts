/**
 * Which voice the tutor speaks with.
 *
 * The student picks a language and an accent in Settings; those two choices
 * collapse to one `TutorVoiceKey`, which is the only thing that crosses the
 * wire. The browser sends it (header on HTTP, query param on the WebSocket)
 * and the server maps it to an ElevenLabs voice id from env — voice ids are
 * never exposed to the client.
 *
 * Hindi has a single voice, so it ignores the accent choice.
 */

export const TUTOR_AUDIO_LANGUAGES = ["english", "hindi"] as const;
export type TutorAudioLanguage = (typeof TUTOR_AUDIO_LANGUAGES)[number];

export const TUTOR_ACCENTS = ["india", "uk", "us"] as const;
export type TutorAccent = (typeof TUTOR_ACCENTS)[number];

/** Indian English is the product default; every fallback lands back here. */
export const DEFAULT_AUDIO_LANGUAGE: TutorAudioLanguage = "english";
export const DEFAULT_ACCENT: TutorAccent = "india";

export const TUTOR_VOICE_KEYS = ["en-IN", "en-GB", "en-US", "hi-IN"] as const;
export type TutorVoiceKey = (typeof TUTOR_VOICE_KEYS)[number];

export const DEFAULT_VOICE_KEY: TutorVoiceKey = "en-IN";

/** HTTP header carrying the voice key on `/api/tts` and `/api/tts/stream`. */
export const TTS_LANG_HEADER = "x-tts-lang";
/** Query param carrying the voice key on the `/api/tts/ws` upgrade. */
export const TTS_LANG_QUERY = "lang";

export function isTutorVoiceKey(value: unknown): value is TutorVoiceKey {
  return typeof value === "string" && (TUTOR_VOICE_KEYS as readonly string[]).includes(value);
}

export function isTutorAudioLanguage(value: unknown): value is TutorAudioLanguage {
  return typeof value === "string"
    && (TUTOR_AUDIO_LANGUAGES as readonly string[]).includes(value);
}

export function isTutorAccent(value: unknown): value is TutorAccent {
  return typeof value === "string" && (TUTOR_ACCENTS as readonly string[]).includes(value);
}

/** Anything unrecognised falls back to Indian English rather than going silent. */
export function normalizeVoiceKey(value: unknown): TutorVoiceKey {
  return isTutorVoiceKey(value) ? value : DEFAULT_VOICE_KEY;
}

const ENGLISH_ACCENT_KEYS: Record<TutorAccent, TutorVoiceKey> = {
  india: "en-IN",
  uk: "en-GB",
  us: "en-US",
};

export function toVoiceKey(
  language: TutorAudioLanguage,
  accent: TutorAccent,
): TutorVoiceKey {
  if (language === "hindi") return "hi-IN";
  return ENGLISH_ACCENT_KEYS[accent] ?? DEFAULT_VOICE_KEY;
}

/** Human-readable label for logs and settings copy. */
export function voiceKeyLabel(key: TutorVoiceKey): string {
  switch (key) {
    case "hi-IN":
      return "Hindi (India)";
    case "en-GB":
      return "English (UK)";
    case "en-US":
      return "English (US)";
    default:
      return "English (India)";
  }
}

/** What the student chose in Settings, as the TTS clients carry it. */
export interface TutorVoicePreferences {
  voiceKey: TutorVoiceKey;
  /** Trade voice quality for first-audio latency (`eleven_flash_v2_5`). */
  lowLatency: boolean;
}

export const DEFAULT_VOICE_PREFERENCES: TutorVoicePreferences = {
  voiceKey: DEFAULT_VOICE_KEY,
  lowLatency: false,
};
