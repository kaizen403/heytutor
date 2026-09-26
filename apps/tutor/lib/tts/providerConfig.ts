import type { TutorVoiceKey } from "@heytutor/tutor-core";

export type SpeechProvider = "cartesia" | "elevenlabs";
export type SpeechEnvironment = Record<string, string | undefined>;
export const CARTESIA_VERSION = "2026-08-14";
/** Simi (formerly Indian Lady): native Indian English, verified against the live voice API. */
const DEFAULT_CARTESIA_VOICE = "3b554273-4299-48b9-9aaf-eefd438e3941";
const VOICE_SUFFIXES: Record<TutorVoiceKey, string> = {
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

export function ttsConfig(
  voiceKey: TutorVoiceKey = "en-IN",
  lowLatency = false,
  env: SpeechEnvironment = process.env,
) {
  const provider = speechProvider("tts", env);
  const prefix = provider.toUpperCase();
  const voiceId =
    env[`${prefix}_VOICE_ID${VOICE_SUFFIXES[voiceKey]}`]?.trim() ||
    env[`${prefix}_VOICE_ID`]?.trim() ||
    (provider === "cartesia" ? DEFAULT_CARTESIA_VOICE : undefined);
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
  return (Object.keys(VOICE_SUFFIXES) as TutorVoiceKey[]).filter(
    (key) =>
      Boolean(env[`${prefix}_VOICE_ID${VOICE_SUFFIXES[key]}`]?.trim()) ||
      (prefix === "CARTESIA" && key === "en-IN"),
  );
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
