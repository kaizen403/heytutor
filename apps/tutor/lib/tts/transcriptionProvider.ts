import { CARTESIA_VERSION, sttConfig } from "./providerConfig";

export function transcriptionRequest(
  config: ReturnType<typeof sttConfig>,
  audio: Blob,
  filename: string,
  languageCode?: string,
) {
  const body = new FormData();
  body.set("file", audio, filename);
  const cartesia = config.provider === "cartesia";
  body.set(cartesia ? "model" : "model_id", config.model);
  if (!cartesia) {
    body.set("tag_audio_events", "false");
    body.set("diarize", "false");
  }
  if (languageCode?.trim()) {
    const code = languageCode.trim();
    const language = cartesia
      ? ({ eng: "en", hin: "hi" }[code] ?? code.split("-")[0]!)
      : code;
    body.set(cartesia ? "language" : "language_code", language);
  }
  const headers: Record<string, string> = cartesia
    ? {
        Authorization: `Bearer ${config.apiKey}`,
        "Cartesia-Version": CARTESIA_VERSION,
      }
    : { "xi-api-key": config.apiKey! };
  return { body, headers };
}
