/**
 * The real WebSocket relay driving the Sarvam (Hinglish) voice.
 *
 * Sarvam has no context ids, so the relay keeps one sentence in flight and
 * sends the next only after a `final`. A sentence the client drops before it
 * reaches Sarvam is refunded; the one in flight is charged when the socket
 * closes; queued ones are refunded. Run with --experimental-test-module-mocks.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";

const root = resolve(import.meta.dirname, "../..");
const load = createRequire(import.meta.url);
const events: string[] = [];
class Socket extends EventEmitter {
  static OPEN = 1; static CONNECTING = 0;
  readyState = 1; bufferedAmount = 0; sent: string[] = [];
  static upstream: Socket[] = [];
  constructor(url?: string, public options?: { headers?: Record<string, string> }) { super(); if (url) { Socket.upstream.push(this); this.url = url; } }
  url = "";
  send(data: unknown) { this.sent.push(String(data)); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.emit("close"); }
  terminate() { this.close(); }
}
mock.module(load.resolve("ws"), { namedExports: { WebSocket: Socket } });
mock.module(resolve(root, "lib/db/prisma.ts"), { namedExports: { prisma: { user: { findUnique: async () => ({ id: "student" }) } } } });
mock.module(resolve(root, "lib/obs/sentryNode.ts"), { namedExports: { captureTtsRelayFailure: () => {} } });
mock.module(resolve(root, "lib/obs/langfuse.ts"), { namedExports: { recordTtsSpan: () => {}, flushInBackground: () => {} } });
mock.module(resolve(root, "lib/billing/track.ts"), { namedExports: { recordTtsSpend: () => {} } });
mock.module(resolve(root, "lib/tts/wsTicket.ts"), { namedExports: { registerWsConnectionRevocation: () => () => {} } });
mock.module(resolve(root, "lib/obs/traceOwnership.ts"), { namedExports: { assertOwnedTrace: async () => true } });
mock.module(resolve(root, "lib/billing/paidUsage.ts"), { namedExports: { reservePaidUsage: async () => {
  let done = false;
  return {
    finish: async () => { if (!done) { done = true; events.push("charged"); } },
    cancelBeforeDispatch: async () => { if (!done) { done = true; events.push("refunded"); } },
  };
} } });

const SARVAM_ENV = { SARVAM_API_KEY: "sk_test", TTS_PROVIDER: "cartesia", CARTESIA_API_KEY: "c" };
const { ttsConfig } = load(resolve(root, "lib/tts/providerConfig.ts"));
const config = ttsConfig("hi-IN", false, SARVAM_ENV);
assert.equal(config.provider, "sarvam");
mock.module(resolve(root, "lib/tts/providerConfig.ts"), { namedExports: { ttsConfig: () => config } });
const { createLessonGrant, releaseTurnGrant } = load(resolve(root, "lib/billing/grant.ts"));
const { relayTtsWebSocket } = load(resolve(root, "lib/tts/wsRelay.ts"));

const tick = async () => { for (let i = 0; i < 12; i++) await new Promise((done) => setImmediate(done)); };
const say = (ws: Socket, index: number, text: string) =>
  ws.emit("message", Buffer.from(JSON.stringify({ text, flush: true, segment_index: index })), false);
const texts = (vendor: Socket) =>
  vendor.sent.map((raw) => JSON.parse(raw)).filter((m) => m.type === "text").map((m) => m.data.text);
const final = (vendor: Socket) => {
  vendor.emit("message", Buffer.from(JSON.stringify({ type: "audio", data: { audio: Buffer.alloc(480).toString("base64") } })), false);
  vendor.emit("message", Buffer.from(JSON.stringify({ type: "event", data: { event_type: "final" } })), false);
};

function client(): { ws: Socket; vendor: Socket } {
  releaseTurnGrant("student"); events.length = 0;
  const minted = createLessonGrant({ userId: "student", traceId: "lesson-trace", planId: "free", usdMillicents: 500, skipAutumn: true });
  assert(minted.ok);
  const ws = new Socket();
  relayTtsWebSocket(ws, { userId: "student", grant: minted.grant, traceId: "lesson-trace", voiceKey: "hi-IN", speed: 1 });
  const vendor = Socket.upstream.at(-1)!;
  vendor.emit("open");
  return { ws, vendor };
}

async function main() {
  // Vendor socket: Sarvam URL, key in the header, config before anything else.
  let { ws, vendor } = client();
  assert.match(vendor.url, /^wss:\/\/api\.sarvam\.ai\/text-to-speech\/ws\?/);
  assert.equal(vendor.options?.headers?.["Api-Subscription-Key"], "sk_test");
  assert.equal(JSON.parse(vendor.sent[0]!).type, "config", "config is the first message Sarvam sees");
  assert.equal(JSON.parse(ws.sent[0]!).type, "ready");

  // Three sentences arrive; only the first reaches Sarvam.
  say(ws, 1, "पहला sentence.");
  say(ws, 2, "दूसरा sentence.");
  say(ws, 3, "तीसरा sentence.");
  await tick();
  assert.deepEqual(texts(vendor), ["पहला sentence."], "one sentence in flight at a time");

  // The client drops sentence 3 before it was sent: refunded, never spoken.
  ws.emit("message", Buffer.from(JSON.stringify({ cancel_segment_index: 3 })), false);
  await tick();
  assert.deepEqual(events, ["refunded"], "a dropped, unsent sentence is refunded");

  // The first final reaches the client and releases sentence 2, not 3.
  final(vendor);
  await tick();
  const delivered = ws.sent.map((raw) => JSON.parse(raw)).filter((m) => m.isFinal);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].contextId, "segment_1");
  assert.equal(Buffer.from(delivered[0].audio, "base64").subarray(0, 4).toString(), "RIFF");
  assert.equal(delivered[0].alignment, undefined);
  assert.deepEqual(texts(vendor), ["पहला sentence.", "दूसरा sentence."], "the next queued sentence follows the final");
  assert.deepEqual(events, ["refunded", "charged"], "the spoken sentence is charged at its final");

  // Cancelling the sentence already in flight does nothing: it cannot be recalled.
  ws.emit("message", Buffer.from(JSON.stringify({ cancel_segment_index: 2 })), false);
  await tick();
  assert.deepEqual(events, ["refunded", "charged"]);

  // Closing mid-sentence charges the one in flight.
  ws.close();
  await tick();
  assert.deepEqual(events, ["refunded", "charged", "charged"]);
  assert.equal(vendor.readyState, 3, "the vendor socket closes with the client");

  // Teardown with sentences still queued: in flight charged, queued refunded.
  ({ ws, vendor } = client());
  say(ws, 1, "one.");
  say(ws, 2, "two.");
  say(ws, 3, "three.");
  await tick();
  ws.close();
  await tick();
  assert.equal(events.filter((e) => e === "charged").length, 1, "only the sentence Sarvam received is charged");
  assert.equal(events.filter((e) => e === "refunded").length, 2, "both queued sentences are refunded");

  // A cancel naming garbage closes the socket like any malformed request.
  ({ ws, vendor } = client());
  ws.emit("message", Buffer.from(JSON.stringify({ cancel_segment_index: "x" })), false);
  await tick();
  assert.equal(ws.readyState, 3);

  // A Sarvam error closes the socket and never echoes its message.
  ({ ws, vendor } = client());
  say(ws, 1, "secret student words");
  await tick();
  vendor.emit("message", Buffer.from(JSON.stringify({ type: "error", data: { message: "bad: secret student words" } })), false);
  await tick();
  assert.equal(ws.readyState, 3);
  assert(!ws.sent.some((raw) => raw.includes("secret student words")), "Sarvam's error text never reaches the client");

  console.log("sarvam relay: serial dispatch, drain on final, cancel refunds, teardown charges and refunds passed");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => mock.restoreAll());
