import type { TTSClient } from "./speechClient";
import { StreamingSpeechClient } from "./streamingSpeechClient";
import type { TutorVoicePreferences } from "./voiceLanguage";

export type CreateTTSClientOptions = {
  /** Capture TTS bytes and keep the audio clock, but do not play through speakers. */
  muted?: boolean;
  /** Language/accent/latency from Settings; applied before the first connection. */
  voicePreferences?: TutorVoicePreferences;
};

/** The lesson's speech client. Only the browser session creates one. */
export function createTTSClient(options: CreateTTSClientOptions = {}): TTSClient {
  const client = new StreamingSpeechClient();
  if (options.muted) {
    client.setMuted?.(true);
  }
  if (options.voicePreferences) {
    client.setVoicePreferences?.(options.voicePreferences);
  }
  return client;
}
