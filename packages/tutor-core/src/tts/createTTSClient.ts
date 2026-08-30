import { ElevenLabsTTSClient, type TTSClient } from "./elevenLabsClient";
import { ElevenLabsWebSocketTTSClient } from "./elevenLabsWebSocketClient";
import { resolveApiUrl } from "../publicOrigins";
import type { TutorVoicePreferences } from "./voiceLanguage";

export type CreateTTSClientOptions = {
  /** Capture TTS bytes and keep the audio clock, but do not play through speakers. */
  muted?: boolean;
  /** Language/accent/latency from Settings; applied before the first connection. */
  voicePreferences?: TutorVoicePreferences;
};

export function createTTSClient(options: CreateTTSClientOptions = {}): TTSClient {
  const client =
    typeof window !== "undefined"
      ? new ElevenLabsWebSocketTTSClient()
      : new ElevenLabsTTSClient({
          proxyUrl: resolveApiUrl("/api/tts"),
          streamUrl: resolveApiUrl("/api/tts/stream"),
        });
  if (options.muted) {
    client.setMuted?.(true);
  }
  if (options.voicePreferences) {
    client.setVoicePreferences?.(options.voicePreferences);
  }
  return client;
}
