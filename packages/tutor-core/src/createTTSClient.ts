import { ElevenLabsTTSClient, type TTSClient } from "./elevenLabsClient";
import { ElevenLabsWebSocketTTSClient } from "./elevenLabsWebSocketClient";

export function createTTSClient(): TTSClient {
  if (typeof window !== "undefined") {
    return new ElevenLabsWebSocketTTSClient();
  }

  return new ElevenLabsTTSClient({
    proxyUrl: "/api/tts",
    streamUrl: "/api/tts/stream",
  });
}
