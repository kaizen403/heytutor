/**
 * Sarvam speaks the Hinglish voice and nothing else.
 *
 * Cartesia keeps every English voice even when a Sarvam key is present; the
 * Sarvam key only ever reaches api.sarvam.ai; one segment is in flight at a
 * time because Sarvam has no context ids; a final carries a 24 kHz WAV and no
 * invented alignment; and digits reach the voice as English words, because
 * Sarvam reads "9" as a Hindi numeral that the pen cannot match.
 */
import assert from "node:assert/strict";
import {
  availableVoiceKeys,
  DEFAULT_SARVAM_SPEAKER,
  hinglishVoiceAvailable,
  ttsConfig,
} from "../../lib/tts/providerConfig";
import { createTtsRelay, requestTts } from "../../lib/tts/ttsProvider";
import {
  SARVAM_MAX_TEXT_CHARS,
  sarvamSpeechText,
  sarvamTextMessages,
} from "../../lib/tts/sarvamProtocol";
import {
  calculateTtsCostDetails,
  resolveTtsRateLane,
} from "../../lib/obs/usageCost";

const KEY = "sk_test_sarvam_key";
const env = {
  TTS_PROVIDER: "cartesia",
  CARTESIA_API_KEY: "cartesia_key",
  SARVAM_API_KEY: KEY,
};
const noSarvam = { TTS_PROVIDER: "cartesia", CARTESIA_API_KEY: "cartesia_key" };

// Routing: hi-IN only, and only with a key.
const hindi = ttsConfig("hi-IN", false, env);
assert.equal(hindi.provider, "sarvam");
assert.equal(hindi.apiKey, KEY);
assert.equal(hindi.voiceId, DEFAULT_SARVAM_SPEAKER);
assert.equal(DEFAULT_SARVAM_SPEAKER, "ritu", "the owner picked ritu by ear");
assert.equal(hindi.model, "bulbul:v3");
assert.equal(
  ttsConfig("hi-IN", false, {
    ...env,
    SARVAM_SPEAKER: "priya",
    SARVAM_MODEL: "bulbul:v2",
  }).voiceId,
  "priya",
);
for (const key of ["en-IN", "en-GB", "en-US"] as const) {
  const config = ttsConfig(key, false, env);
  assert.equal(
    config.provider,
    "cartesia",
    `${key} stays on Cartesia with a Sarvam key present`,
  );
  assert.equal(config.apiKey, "cartesia_key");
}
assert.equal(
  ttsConfig("hi-IN", false, noSarvam).provider,
  "cartesia",
  "no key, no Sarvam",
);
assert.equal(hinglishVoiceAvailable(env), true);
assert.equal(hinglishVoiceAvailable({ SARVAM_API_KEY: "  " }), false);
assert.ok(availableVoiceKeys(env).includes("hi-IN"));
assert.ok(!availableVoiceKeys(noSarvam).includes("hi-IN"));

// The relay: Sarvam URL and header only, config on open, keepalive.
const relay = createTtsRelay(hindi, { speed: 1.1 });
assert.match(relay.url, /^wss:\/\/api\.sarvam\.ai\/text-to-speech\/ws\?/);
assert.match(relay.url, /model=bulbul%3Av3/);
assert.match(
  relay.url,
  /send_completion_event=true/,
  "without it no final arrives and the watchdog fires",
);
assert.deepEqual(Object.keys(relay.headers), ["Api-Subscription-Key"]);
assert.equal(relay.headers["Api-Subscription-Key"], KEY);
const config = relay.openMessages?.[0] as {
  type: string;
  data: Record<string, unknown>;
};
assert.equal(config.type, "config");
assert.equal(config.data.language_code, "hi-IN");
assert.equal(config.data.speaker, "ritu");
assert.equal(config.data.output_audio_codec, "linear16");
assert.equal(config.data.speech_sample_rate, 24000);
assert.equal(config.data.pace, 1.1);
assert.ok(
  relay.keepalive && relay.keepalive.everyMs < 60_000,
  "Sarvam closes after about a minute idle",
);
assert.deepEqual(relay.keepalive?.message, { type: "ping" });

// One segment in flight; the next waits for the final.
const settings = { stability: 0.5, similarity_boost: 0.75, speed: 1 };
const first = relay.segment("segment_1", "तो x equals 9 है।", settings);
assert.deepEqual(first, [
  { type: "text", data: { text: "तो x equals nine है." } },
  { type: "flush" },
]);
assert.deepEqual(
  relay.segment("segment_2", "अब force देखो.", settings),
  [],
  "queued behind segment_1",
);
assert.deepEqual(
  relay.drain?.(),
  [],
  "nothing to send while segment_1 is in flight",
);
assert.deepEqual(relay.undispatched?.(), ["segment_2"]);

const pcm = Buffer.alloc(4800, 1);
assert.equal(
  relay.receive(
    JSON.stringify({
      type: "audio",
      data: { content_type: "audio/pcm", audio: pcm.toString("base64") },
    }),
  ),
  null,
);
assert.equal(
  relay.receive(JSON.stringify({ type: "pong" })),
  null,
  "unknown server messages are ignored",
);
const final = JSON.parse(
  relay.receive(
    JSON.stringify({ type: "event", data: { event_type: "final" } }),
  )!,
);
assert.equal(final.contextId, "segment_1");
assert.equal(final.isFinal, true);
assert.equal(
  final.alignment,
  undefined,
  "no invented timings: the client keeps its estimate",
);
const wav = Buffer.from(final.audio, "base64");
assert.equal(wav.subarray(0, 4).toString(), "RIFF");
assert.equal(wav.readUInt32LE(24), 24000);
assert.equal(wav.length, 44 + pcm.length);
assert.deepEqual(relay.drain?.(), [
  { type: "text", data: { text: "अब force देखो." } },
  { type: "flush" },
]);
assert.deepEqual(relay.undispatched?.(), []);

// Errors close the socket without echoing Sarvam's message (it can quote the student).
assert.throws(
  () =>
    relay.receive(
      JSON.stringify({
        type: "error",
        data: { message: "bad text: तो x equals" },
      }),
    ),
  (error: Error) => error.message === "Sarvam speech generation failed",
);
relay.dispose();
assert.deepEqual(relay.undispatched?.(), []);

// A punctuation-only sentence can come back empty: a breath of silence, not a dead socket.
const empty = createTtsRelay(hindi);
empty.segment("segment_1", "...", settings);
const silent = JSON.parse(empty.receive(JSON.stringify({ type: "event", data: { event_type: "final" } }))!);
assert.equal(silent.contextId, "segment_1");
assert.ok(Buffer.from(silent.audio, "base64").length > 44, "an empty final becomes a short silent WAV");

// A queued sentence the client dropped can be removed; the one in flight cannot.
const queue = createTtsRelay(hindi);
queue.segment("segment_1", "one.", settings);
queue.segment("segment_2", "two.", settings);
queue.segment("segment_3", "three.", settings);
assert.equal(queue.cancel?.("segment_1"), false, "the sentence in flight cannot be recalled");
assert.equal(queue.cancel?.("segment_3"), true);
assert.deepEqual(queue.undispatched?.(), ["segment_2"]);

// Speech text: digits become English words, Devanagari is untouched.
assert.equal(
  sarvamSpeechText("v equals 20 meters per second"),
  "v equals twenty meters per second",
);
assert.equal(
  sarvamSpeechText("total 12,500 joules"),
  "total twelve thousand five hundred joules",
);
assert.equal(
  sarvamSpeechText("g की value 9.8 है"),
  "g की value nine point eight है",
);
assert.equal(sarvamSpeechText("steps 1,2,3"), "steps one, two, three");
assert.equal(sarvamSpeechText("H2O और 5x"), "H two O और five x");
assert.equal(
  sarvamSpeechText("roots 2 और 3 होंगे।"),
  "roots two और three होंगे.",
);
assert.equal(
  sarvamSpeechText("अब हम force को mass से divide करेंगे"),
  "अब हम force को mass से divide करेंगे",
);
assert.equal(sarvamSpeechText("x equals 9, then"), "x equals nine, then");
// Review findings, 6 Oct 2026: Indian grouping read as a list, ordinals, times.
assert.equal(sarvamSpeechText("Rs 1,00,000 का loan"), "Rs one lakh का loan");
assert.equal(sarvamSpeechText("total 2,50,00,000"), "total two crore fifty lakh");
assert.equal(sarvamSpeechText("1,234.5"), "one thousand two hundred thirty four point five");
assert.equal(sarvamSpeechText("Newton का 2nd law"), "Newton का second law");
assert.equal(sarvamSpeechText("1st, 3rd, 12th, 21st, 40th"), "first, third, twelfth, twenty first, fortieth");
assert.equal(sarvamSpeechText("class 10:30 पर, या 9:05, या 4:00"), "class ten thirty पर, या nine oh five, या four o'clock");
assert.equal(sarvamSpeechText(".5 metres"), "point five metres");
assert.equal(sarvamSpeechText("100% efficiency"), "one hundred percent efficiency");
assert.equal(sarvamSpeechText("q1 and v0x"), "q one and v zero x");

// Long text splits at whitespace under Sarvam's per-message cap.
const long = Array.from(
  { length: 700 },
  (_, index) => `word${index % 10}`,
).join(" ");
const parts = sarvamTextMessages(long) as { data: { text: string } }[];
assert.ok(parts.length > 1);
assert.ok(
  parts.every((part) => part.data.text.length <= SARVAM_MAX_TEXT_CHARS),
);
assert.equal(parts.map((part) => part.data.text).join(""), long);

// Billing: its own lane at the listed rate, never the ElevenLabs default.
assert.equal(resolveTtsRateLane("bulbul:v3"), "sarvam");
assert.equal(
  calculateTtsCostDetails(1000, { model: "bulbul:v3" }).total,
  0.035,
);
assert.equal(
  calculateTtsCostDetails(1000, { provider: "sarvam", model: "bulbul:v3" })
    .total,
  0.035,
);

// HTTP: the key goes to Sarvam only, and the response matches the client protocol.
async function verifyHttp(): Promise<void> {
  const realFetch = globalThis.fetch;
  const calls: {
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });
    return Response.json({ request_id: "r", audios: [pcm.toString("base64")] });
  }) as typeof fetch;
  try {
    const ndjson = await requestTts(hindi, { text: "x equals 9" }, true);
    assert.equal(ndjson.headers.get("content-type"), "application/x-ndjson");
    const line = JSON.parse((await ndjson.text()).trim());
    assert.equal(line.isFinal, true);
    assert.equal(line.alignment, undefined);
    assert.equal(
      Buffer.from(line.audio, "base64").subarray(0, 4).toString(),
      "RIFF",
    );

    const bytes = await requestTts(hindi, { text: "x equals 9" }, false);
    assert.equal(bytes.headers.get("content-type"), "audio/wav");
    assert.equal(
      Buffer.from(await bytes.arrayBuffer())
        .subarray(0, 4)
        .toString(),
      "RIFF",
    );

    for (const call of calls) {
      assert.equal(call.url, "https://api.sarvam.ai/text-to-speech");
      assert.equal(call.headers["api-subscription-key"], KEY);
      assert.equal(
        call.headers["xi-api-key"],
        undefined,
        "the Sarvam key never goes to ElevenLabs",
      );
      assert.equal(call.headers.Authorization, undefined);
      assert.equal(call.body.text, "x equals nine");
      assert.equal(call.body.language_code, "hi-IN");
      assert.equal(call.body.speaker, "ritu");
      assert.equal(call.body.output_audio_codec, "linear16");
    }

    globalThis.fetch = (async () =>
      new Response("quota", { status: 429 })) as typeof fetch;
    assert.equal(
      (await requestTts(hindi, { text: "x" }, true)).status,
      429,
      "429 passes through for the retry path",
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}

void verifyHttp()
  .then(() =>
    console.log(
      "sarvam tts: routing, key isolation, serial relay, WAV finals, speech text, billing and HTTP passed",
    ),
  )
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
