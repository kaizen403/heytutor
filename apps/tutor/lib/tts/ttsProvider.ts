import {
  buildElevenLabsPayload,
  ELEVENLABS_TTS_BASE,
  type SpeechRequestBody,
} from "./ttsProxy";
import {
  buildMultiContextSegmentMessages,
  normalizeMultiContextServerPayload,
  type RelayVoiceSettings,
} from "./ttsRelayProtocol";
import { cartesiaRequest, CartesiaContexts } from "./cartesiaProtocol";
import type { TtsConfig } from "./providerConfig";

/** The browser speaks this app's segment protocol; vendor protocols stop at this boundary. */
export function createTtsRelay(config: TtsConfig) {
  const contexts = new CartesiaContexts();
  const cartesia = config.provider === "cartesia";
  return {
    url: cartesia
      ? `wss://api.cartesia.ai/tts/websocket?cartesia_version=${config.version}`
      : `wss://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}/multi-stream-input?model_id=${encodeURIComponent(config.model)}&sync_alignment=true&auto_mode=true`,
    headers: cartesia
      ? { "X-API-Key": config.apiKey! }
      : { "xi-api-key": config.apiKey! },
    segment(
      id: string,
      text: string,
      settings: RelayVoiceSettings,
    ): Record<string, unknown>[] {
      if (!cartesia)
        return buildMultiContextSegmentMessages(id, text, settings);
      contexts.start(id, text);
      return [
        {
          ...cartesiaRequest(config, text, settings.speed),
          context_id: id,
          continue: false,
        },
      ];
    },
    receive(raw: string): string | null {
      return cartesia
        ? contexts.accept(raw)
        : normalizeMultiContextServerPayload(raw).forwardPayload;
    },
    closeMessage: cartesia ? undefined : { close_socket: true },
    dispose() {
      contexts.clear();
    },
  };
}

/** SSE chunks can split JSON, UTF-8, and CRLF boundaries arbitrarily. */
export function normalizeCartesiaStream(
  body: ReadableStream<Uint8Array>,
  text: string,
  id: string,
): ReadableStream<Uint8Array> {
  const contexts = new CartesiaContexts();
  contexts.start(id, text);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let dataLines: string[] = [];
  let completed = false;
  const event = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (!dataLines.length) return;
    const data = dataLines.join("\n");
    dataLines = [];
    if (data === "[DONE]") return;
    // Some HTTP responses omit context_id; it is unambiguous for a single request.
    const message = JSON.parse(data);
    const normalized = contexts.accept(
      JSON.stringify({ ...message, context_id: id }),
    );
    if (normalized) {
      controller.enqueue(encoder.encode(normalized + "\n"));
      completed = true;
    }
  };
  const line = (
    value: string,
    controller: ReadableStreamDefaultController<Uint8Array>,
  ) => {
    const trimmed = value.replace(/\r$/, "");
    if (!trimmed) event(controller);
    else if (trimmed.startsWith("data:"))
      dataLines.push(trimmed.slice(5).trimStart());
  };
  return new ReadableStream({
    async pull(controller) {
      try {
        while (!completed) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            line(buffer.slice(0, newline), controller);
            buffer = buffer.slice(newline + 1);
          }
          if (buffer.length > 24 * 1024 * 1024)
            throw new Error("Speech event exceeded limit");
          if (done) {
            if (buffer) line(buffer, controller);
            event(controller);
            if (!completed)
              throw new Error("Speech stream ended before completion");
          }
        }
        controller.close();
        await reader.cancel();
      } catch (error) {
        contexts.clear();
        controller.error(error);
        await reader.cancel().catch(() => {});
      }
    },
    async cancel(reason) {
      contexts.clear();
      await reader.cancel(reason);
    },
  });
}

export async function requestTts(
  config: TtsConfig,
  body: SpeechRequestBody,
  timestamps: boolean,
  signal?: AbortSignal,
): Promise<Response> {
  const text = typeof body.text === "string" ? body.text : "";
  const cartesia = config.provider === "cartesia";
  const id = crypto.randomUUID();
  const url = cartesia
    ? `https://api.cartesia.ai/tts/${timestamps ? "sse" : "bytes"}`
    : `${ELEVENLABS_TTS_BASE}/${config.voiceId}${timestamps ? "/stream/with-timestamps" : ""}`;
  const payload: Record<string, unknown> = cartesia
    ? {
        ...cartesiaRequest(config, text, body.voice_settings?.speed),
        context_id: id,
        ...(!timestamps
          ? {
              add_timestamps: false,
              output_format: {
                container: "wav",
                encoding: "pcm_s16le",
                sample_rate: 24000,
              },
            }
          : {}),
      }
    : { ...buildElevenLabsPayload(body), model_id: config.model };
  if (cartesia && !timestamps) {
    // The bytes endpoint has no context or timestamp fields in its schema.
    delete payload.context_id;
    delete payload.add_timestamps;
    delete payload.use_normalized_timestamps;
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (cartesia) {
    headers.Authorization = `Bearer ${config.apiKey}`;
    headers["Cartesia-Version"] = config.version;
  } else headers["xi-api-key"] = config.apiKey!;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });
  if (!response.ok || !response.body || !cartesia || !timestamps)
    return response;
  return new Response(normalizeCartesiaStream(response.body, text, id), {
    headers: { "content-type": "application/x-ndjson" },
  });
}
