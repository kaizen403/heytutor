import { ElevenLabsTTSClient, type TTSClient } from "./elevenLabsClient";
import { ElevenLabsWebSocketTTSClient } from "./elevenLabsWebSocketClient";
import { resolveApiUrl } from "./publicOrigins";

export function createTTSClient(): TTSClient {
  if (typeof window !== "undefined") {
    return new ElevenLabsWebSocketTTSClient();
  }

  return new ElevenLabsTTSClient({
    proxyUrl: resolveApiUrl("/api/tts"),
    streamUrl: resolveApiUrl("/api/tts/stream"),
  });
}
