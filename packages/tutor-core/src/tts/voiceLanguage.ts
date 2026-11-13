/**
 * Which voice the tutor speaks with.
 *
 * The student picks a language and an accent in Settings; those two choices
 * collapse to one `TutorVoiceKey`, which is the only thing that crosses the
 * wire. The browser sends it (header on HTTP, query param on the WebSocket)
 * and the server maps it to the selected provider's voice id from env — voice ids are
 * never exposed to the client.
 *
 * Each Indian language has one Sarvam voice, so it ignores the accent choice.
 * Rows saved as "hindi" before the Hinglish voice meant an English lesson in
 * a Hindi accent; that value is no longer recognised and reads as English.
 */

/** Regional lessons use native grammar with English subject terms and board maths. */
export const INDIAN_LANGUAGE_OPTIONS = [
  { language: "hinglish", voiceKey: "hi-IN", label: "Hinglish", script: "Devanagari" },
  { language: "bengali", voiceKey: "bn-IN", label: "Bengali", script: "Bengali" },
  { language: "gujarati", voiceKey: "gu-IN", label: "Gujarati", script: "Gujarati" },
  { language: "kannada", voiceKey: "kn-IN", label: "Kannada", script: "Kannada" },
  { language: "malayalam", voiceKey: "ml-IN", label: "Malayalam", script: "Malayalam" },
  { language: "marathi", voiceKey: "mr-IN", label: "Marathi", script: "Devanagari" },
  { language: "odia", voiceKey: "od-IN", label: "Odia", script: "Odia" },
  { language: "punjabi", voiceKey: "pa-IN", label: "Punjabi", script: "Gurmukhi" },
  { language: "tamil", voiceKey: "ta-IN", label: "Tamil", script: "Tamil" },
  { language: "telugu", voiceKey: "te-IN", label: "Telugu", script: "Telugu" },
] as const;
export const TUTOR_AUDIO_LANGUAGES = ["english", ...INDIAN_LANGUAGE_OPTIONS.map((option) => option.language)] as const;
export type TutorAudioLanguage = (typeof TUTOR_AUDIO_LANGUAGES)[number];

export const TUTOR_ACCENTS = ["india", "uk", "us"] as const;
export type TutorAccent = (typeof TUTOR_ACCENTS)[number];

/** Indian English is the product default; every fallback lands back here. */
export const DEFAULT_AUDIO_LANGUAGE: TutorAudioLanguage = "english";
export const DEFAULT_ACCENT: TutorAccent = "india";

export const TUTOR_VOICE_KEYS = ["en-IN", "en-GB", "en-US", ...INDIAN_LANGUAGE_OPTIONS.map((option) => option.voiceKey)] as const;
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
  const regional = INDIAN_LANGUAGE_OPTIONS.find((option) => option.language === language);
  if (regional) return regional.voiceKey;
  return ENGLISH_ACCENT_KEYS[accent] ?? DEFAULT_VOICE_KEY;
}

/** Human-readable label for logs and settings copy. */
export function voiceKeyLabel(key: TutorVoiceKey): string {
  const regional = INDIAN_LANGUAGE_OPTIONS.find((option) => option.voiceKey === key);
  if (regional) return regional.label;
  switch (key) {
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
  /** Request the deployment's low-latency model, when configured. */
  lowLatency: boolean;
}

export const DEFAULT_VOICE_PREFERENCES: TutorVoicePreferences = {
  voiceKey: DEFAULT_VOICE_KEY,
  lowLatency: false,
};

/** A narration change waits for the next turn; English accent changes can be immediate. */
export function switchesNarrationLanguage(before: TutorVoiceKey, after: TutorVoiceKey): boolean {
  return (before.startsWith("en-") ? "english" : before) !==
    (after.startsWith("en-") ? "english" : after);
}

export function isIndianVoiceKey(key: TutorVoiceKey): boolean {
  return INDIAN_LANGUAGE_OPTIONS.some((option) => option.voiceKey === key);
}
