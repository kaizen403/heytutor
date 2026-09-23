import assert from "node:assert/strict";
import {
  availableVoiceKeys,
  speechProvider,
  sttConfig,
  ttsConfig,
} from "../../lib/tts/providerConfig";
import {
  createTtsRelay,
  normalizeCartesiaStream,
  requestTts,
} from "../../lib/tts/ttsProvider";
import {
  cartesiaRequest,
  characterAlignment,
  pcmToWav,
} from "../../lib/tts/cartesiaProtocol";
import { transcriptionRequest } from "../../lib/tts/transcriptionProvider";
import { isTtsConfigured } from "../../lib/billing/flags";
import { calculateTtsCostDetails } from "../../lib/obs/usageCost";
import {
  lectureAudioKey,
  parseStoredObjectKey,
} from "../../lib/object-store/keys";
import {
  contentTypeForStoredKey,
  contentDispositionForKey,
} from "../../lib/object-store/safeContentType";
import { validateTurnUploadParts } from "../../lib/scene/turnUploadLimits";
import { speechAudioMimeType } from "@heytutor/tutor-core";

async function main() {
  const env = {
    CARTESIA_API_KEY: "cartesia-test",
    ELEVENLABS_API_KEY: "eleven-test",
    ELEVENLABS_VOICE_ID: "legacy",
  };
  assert.equal(speechProvider("tts", env), "cartesia");
  assert.equal(speechProvider("stt", env), "cartesia");
  assert.equal(ttsConfig("en-IN", false, env).apiKey, "cartesia-test");
  assert(
    !isTtsConfigured({
      NODE_ENV: "test",
      ELEVENLABS_API_KEY: "unused",
      ELEVENLABS_VOICE_ID: "unused",
    }),
  );
  assert(isTtsConfigured({ ...env, NODE_ENV: "test" }));
  assert.throws(() => speechProvider("tts", { TTS_PROVIDER: "typo" }));
  assert.equal(
    ttsConfig("hi-IN", false, { ...env, CARTESIA_VOICE_ID_HI: "hindi" })
      .voiceId,
    "hindi",
  );
  assert.deepEqual(availableVoiceKeys({ CARTESIA_VOICE_ID_HI: "hindi" }), [
    "en-IN",
    "hi-IN",
  ]);
  const config = ttsConfig("en-IN", true, env);
  const relay = createTtsRelay(config);
  const settings = { stability: 0.4, similarity_boost: 0.75, speed: 0.95 };
  const [request] = relay.segment("segment_1", "Hello, world!", settings);
  assert.equal(request!.continue, false);
  assert.equal(request!.locale, "en-IN");
  assert.equal(request!.language, undefined);
  assert.equal(request!.voice_settings, undefined);
  assert.deepEqual(request!.generation_config, { speed: 0.95 });
  assert(relay.url.startsWith("wss://api.cartesia.ai/"));
  assert.equal(relay.headers["X-API-Key"], "cartesia-test");
  relay.segment("segment_2", "Next.", settings);
  const send = (id: string, payload: object) =>
    relay.receive(JSON.stringify({ context_id: id, ...payload }));
  assert.equal(
    send("segment_1", {
      type: "chunk",
      data: Buffer.from([1, 0]).toString("base64"),
    }),
    null,
  );
  assert.equal(
    send("segment_2", {
      type: "chunk",
      data: Buffer.from([2, 0]).toString("base64"),
    }),
    null,
  );
  const second = JSON.parse(send("segment_2", { type: "done" })!);
  assert.equal(second.contextId, "segment_2");
  assert.equal(Buffer.from(second.audio, "base64").readInt16LE(44), 2);
  send("segment_1", {
    type: "timestamps",
    word_timestamps: {
      words: ["Hello", "world"],
      start: [0, 0.6],
      end: [0.5, 1],
    },
  });
  const first = JSON.parse(send("segment_1", { type: "done" })!);
  assert(first.isFinal);
  assert.equal(first.alignment.characters.join(""), "Hello, world!");
  assert.equal(first.alignment.character_start_times_seconds[7], 0.6);
  const wav = Buffer.from(first.audio, "base64");
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt32LE(40), 2);
  assert.equal(speechAudioMimeType(wav), "audio/wav");
  assert.equal(speechAudioMimeType(new Uint8Array([255, 251])), "audio/mpeg");
  assert.equal(
    characterAlignment("x = 2", [{ word: "two", start: 0, end: 1 }]),
    undefined,
  );
  assert.equal(
    send("segment_1", { type: "done" }),
    null,
    "duplicate completion must not replay audio",
  );
  relay.segment("segment_3", "Cancelled.", settings);
  relay.dispose();
  assert.equal(send("segment_3", { type: "done" }), null);
  relay.segment("segment_4", "Failure.", settings);
  assert.throws(
    () =>
      send("segment_4", { type: "error", message: "secret upstream detail" }),
    /generation failed/,
  );
  relay.segment("segment_5", "Empty.", settings);
  assert.throws(() => send("segment_5", { type: "done" }), /no audio/);

  const eleven = ttsConfig("en-IN", true, {
    ...env,
    TTS_PROVIDER: "elevenlabs",
  });
  const legacy = createTtsRelay(eleven);
  assert.equal(eleven.model, "eleven_flash_v2_5");
  assert.equal(legacy.segment("segment_1", "Hello", settings).length, 3);
  assert.equal(
    JSON.parse(legacy.receive('{"context_id":"segment_1","is_final":true}')!)
      .isFinal,
    true,
  );
  assert.equal(legacy.headers["xi-api-key"], "eleven-test");
  assert.equal(
    cartesiaRequest(config, "Hello", NaN).generation_config.speed,
    1,
  );

  const events = [
    { type: "chunk", data: Buffer.from([0, 0, 1, 0]).toString("base64") },
    {
      type: "timestamps",
      word_timestamps: { words: ["नमस्ते"], start: [0], end: [1] },
    },
    { type: "done" },
  ];
  const encoded = new TextEncoder().encode(
    events
      .map((e) => `event: message\r\ndata: ${JSON.stringify(e)}\r\n\r\n`)
      .join(""),
  );
  // One byte at a time includes split UTF-8 and CRLF boundaries.
  let index = 0;
  const upstream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (index < encoded.length) c.enqueue(encoded.slice(index, ++index));
      else c.close();
    },
  });
  const normalized = await new Response(
    normalizeCartesiaStream(upstream, "नमस्ते", "http"),
  ).text();
  assert.equal(JSON.parse(normalized).alignment.characters.join(""), "नमस्ते");
  const truncated = new ReadableStream<Uint8Array>({
    start(c) {
      c.close();
    },
  });
  await assert.rejects(
    new Response(normalizeCartesiaStream(truncated, "Hi", "http")).text(),
    /before completion/,
  );
  let cancelled = false;
  const pending = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  await normalizeCartesiaStream(pending, "Hi", "http").cancel();
  assert(cancelled);

  const originalFetch = globalThis.fetch;
  const calls: {
    url: string;
    payload: Record<string, unknown>;
    headers: Headers;
  }[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      payload: JSON.parse(String(init?.body)),
      headers: new Headers(init?.headers),
    });
    return new Response("provider failed", { status: 401 });
  };
  try {
    const failed = await requestTts(
      config,
      { text: "Test", model_id: "eleven_multilingual_v2" },
      true,
    );
    assert.equal(failed.status, 401);
    assert.equal(calls[0]!.url, "https://api.cartesia.ai/tts/sse");
    assert.equal(calls[0]!.payload.model_id, "sonic-3.6");
    assert.equal(calls[0]!.headers.get("xi-api-key"), null);
    await requestTts(eleven, { text: "Test" }, true);
    assert(calls[1]!.url.includes("api.elevenlabs.io"));
    assert.equal(calls[1]!.headers.get("Authorization"), null);
    await requestTts(config, { text: "Test" }, false);
    assert.equal(calls[2]!.url, "https://api.cartesia.ai/tts/bytes");
    assert.equal(calls[2]!.payload.context_id, undefined);
    assert.equal(calls[2]!.payload.add_timestamps, undefined);
    assert.equal(calls[2]!.payload.use_normalized_timestamps, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }

  for (const provider of ["cartesia", "elevenlabs"] as const) {
    const stt = sttConfig({
      ...env,
      STT_PROVIDER: provider,
      ELEVENLABS_STT_API_KEY: "separate",
    });
    const input = transcriptionRequest(
      stt,
      new Blob(["audio"], { type: "audio/webm" }),
      "dictation.webm",
      "hin",
    );
    assert.equal(
      input.body.get(provider === "cartesia" ? "language" : "language_code"),
      provider === "cartesia" ? "hi" : "hin",
    );
    assert.equal(
      input.body.get(provider === "cartesia" ? "model" : "model_id"),
      stt.model,
    );
    assert.equal(
      stt.apiKey,
      provider === "cartesia" ? "cartesia-test" : "separate",
    );
  }
  assert.equal(
    calculateTtsCostDetails(1000, { provider: "cartesia", model: "custom" })
      .total,
    0.05,
  );
  assert.equal(
    calculateTtsCostDetails(1000, { model: "eleven_multilingual_v2" }).total,
    0.1,
  );
  for (const type of ["audio/wav", "audio/mpeg"]) {
    const key = lectureAudioKey("board", "turn", 0, type);
    assert.equal(parseStoredObjectKey(key)?.kind, "lecture");
    assert.equal(contentTypeForStoredKey(key), type);
    assert(
      contentDispositionForKey(key).includes(
        type === "audio/wav" ? ".wav" : ".mp3",
      ),
    );
    const form = new FormData();
    form.set("metadata", "{}");
    form.set(
      "audio-0",
      new Blob([new Uint8Array(pcmToWav(Buffer.alloc(4)))], { type }),
    );
    assert(validateTurnUploadParts(form, "{}", [{ orderIndex: 0 }]).ok);
  }
  console.log(
    "speech providers: defaults, protocols, interleaving, timings, failure/cancel, HTTP, STT, billing and recordings passed",
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
