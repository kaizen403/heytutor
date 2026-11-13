import { isIndianVoiceKey, TUTOR_VOICE_KEYS, type TutorVoiceKey } from "@heytutor/tutor-core";

export type SpeechProvider = "cartesia" | "elevenlabs";
/** Sarvam is never a deployment-wide vendor; it speaks Indian language voices. */
export type TtsProvider = SpeechProvider | "sarvam";
export type SpeechEnvironment = Record<string, string | undefined>;
export const CARTESIA_VERSION = "2026-08-14";
/**
 * Built-in Cartesia teaching voices, one per accent. Each is verified against
 * the live voice API for a native accent, and each synthesizes on sonic-3.6.
 * Per-accent env overrides below still win over these defaults.
 */
const DEFAULT_CARTESIA_VOICES: Partial<Record<TutorVoiceKey, string>> = {
  /** Simi (formerly Indian Lady): native Indian English. */
  "en-IN": "3b554273-4299-48b9-9aaf-eefd438e3941",
  /** Courtney: native British English, measured delivery for complex information. */
  "en-GB": "16a4052e-1f11-47ac-95f5-9330bee062f9",
  /** Clara: native General American, precise enunciation for instructions. */
  "en-US": "01eaafa9-308a-4276-a017-6ab0cf061b1f",
  /** No Hindi-native default yet; keeps the previous Indian-voice fallback. */
  "hi-IN": "3b554273-4299-48b9-9aaf-eefd438e3941",
};
const VOICE_SUFFIXES: Partial<Record<TutorVoiceKey, string>> = {
  "en-IN": "",
  "en-GB": "_EN_GB",
  "en-US": "_EN_US",
  "hi-IN": "_HI",
};

/** Selection is deployment-owned. Missing credentials never select another vendor. */
export function speechProvider(
  kind: "tts" | "stt" = "tts",
  env: SpeechEnvironment = process.env,
): SpeechProvider {
  const value =
    env[kind === "tts" ? "TTS_PROVIDER" : "STT_PROVIDER"]
      ?.trim()
      .toLowerCase() || "cartesia";
  if (value !== "cartesia" && value !== "elevenlabs")
    throw new Error(`Unsupported ${kind.toUpperCase()}_PROVIDER`);
  return value;
}

/** Picked by ear from the bulbul:v3 voices on 6 Oct 2026. SARVAM_SPEAKER overrides it. */
export const DEFAULT_SARVAM_SPEAKER = "ritu";
export const DEFAULT_SARVAM_MODEL = "bulbul:v3";

/** Indian language choices share the Sarvam credential gate. Legacy name retained for API compatibility. */
export function hinglishVoiceAvailable(
  env: SpeechEnvironment = process.env,
): boolean {
  return Boolean(env.SARVAM_API_KEY?.trim());
}

export function ttsConfig(
  voiceKey: TutorVoiceKey = "en-IN",
  lowLatency = false,
  env: SpeechEnvironment = process.env,
): {
  provider: TtsProvider;
  apiKey: string | undefined;
  voiceId: string | undefined;
  model: string;
  voiceKey: TutorVoiceKey;
  version: string;
} {
  if (isIndianVoiceKey(voiceKey) && hinglishVoiceAvailable(env))
    return {
      provider: "sarvam",
      apiKey: env.SARVAM_API_KEY?.trim(),
      voiceId: env.SARVAM_SPEAKER?.trim() || DEFAULT_SARVAM_SPEAKER,
      model: env.SARVAM_MODEL?.trim() || DEFAULT_SARVAM_MODEL,
      voiceKey,
      version: CARTESIA_VERSION,
    };
  // An unavailable regional voice follows the same English fallback as settings.
  if (isIndianVoiceKey(voiceKey) && voiceKey !== "hi-IN") return ttsConfig("en-IN", lowLatency, env);
  const provider = speechProvider("tts", env);
  const prefix = provider.toUpperCase();
  const perAccent = env[`${prefix}_VOICE_ID${VOICE_SUFFIXES[voiceKey]}`]?.trim();
  const base = env[`${prefix}_VOICE_ID`]?.trim();
  const builtin =
    provider === "cartesia" ? DEFAULT_CARTESIA_VOICES[voiceKey] : undefined;
  // The base voice id is the Indian-voice setting (its suffix is en-IN's). It
  // must not mask the built-in UK/US defaults: picking UK has to sound
  // British even when a deployment pins the Indian voice. ElevenLabs has no
  // built-ins, so the base stays the global fallback there.
  const voiceId =
    perAccent ||
    (provider === "cartesia" && (voiceKey === "en-GB" || voiceKey === "en-US")
      ? builtin
      : base || builtin);
  const model =
    provider === "cartesia"
      ? (lowLatency && env.CARTESIA_LOW_LATENCY_MODEL?.trim()) ||
        env.CARTESIA_MODEL?.trim() ||
        "sonic-3.6"
      : lowLatency
        ? "eleven_flash_v2_5"
        : env.ELEVENLABS_MODEL?.trim() || "eleven_multilingual_v2";
  return {
    provider,
    apiKey: env[`${prefix}_API_KEY`]?.trim(),
    voiceId,
    model,
    voiceKey,
    version: CARTESIA_VERSION,
  };
}
export type TtsConfig = ReturnType<typeof ttsConfig>;

export function availableVoiceKeys(
  env: SpeechEnvironment = process.env,
): TutorVoiceKey[] {
  const prefix = speechProvider("tts", env).toUpperCase();
  return TUTOR_VOICE_KEYS.filter((key) => {
    if (isIndianVoiceKey(key)) {
      return hinglishVoiceAvailable(env) ||
        (key === "hi-IN" && Boolean(env[`${prefix}_VOICE_ID_HI`]?.trim()));
    }
    return prefix === "CARTESIA" || Boolean(env[`${prefix}_VOICE_ID${VOICE_SUFFIXES[key]}`]?.trim());
  });
}

export function sttConfig(env: SpeechEnvironment = process.env) {
  const provider = speechProvider("stt", env);
  return provider === "cartesia"
    ? {
        provider,
        apiKey:
          env.CARTESIA_STT_API_KEY?.trim() || env.CARTESIA_API_KEY?.trim(),
        model: env.CARTESIA_STT_MODEL?.trim() || "ink-whisper",
        url: "https://api.cartesia.ai/stt",
      }
    : {
        provider,
        apiKey: env.ELEVENLABS_STT_API_KEY?.trim(),
        model: env.ELEVENLABS_STT_MODEL?.trim() || "scribe_v1",
        url: "https://api.elevenlabs.io/v1/speech-to-text",
      };
}
