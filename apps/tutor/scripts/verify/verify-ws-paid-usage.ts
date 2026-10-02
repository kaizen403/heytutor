import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";

const root = resolve(import.meta.dirname, "../..");
const load = createRequire(import.meta.url);
const events: string[] = [];
let exists = true;
let revoked: (() => void) | undefined;
class Socket extends EventEmitter {
  static OPEN = 1; static CONNECTING = 0;
  readyState = 1; bufferedAmount = 0; sent: string[] = [];
  static upstream: Socket[] = [];
  constructor(url?: string) { super(); if (url) Socket.upstream.push(this); }
  send(data: unknown) { this.sent.push(String(data)); if (Socket.upstream.includes(this)) events.push("send"); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.emit("close"); }
  terminate() { this.close(); }
}
mock.module(load.resolve("ws"), { namedExports: { WebSocket: Socket } });
mock.module(resolve(root, "lib/db/prisma.ts"), { namedExports: { prisma: { user: { findUnique: async () => exists ? { id: "student" } : null } } } });
mock.module(resolve(root, "lib/obs/sentryNode.ts"), { namedExports: { captureTtsRelayFailure: () => {} } });
mock.module(resolve(root, "lib/obs/langfuse.ts"), { namedExports: { recordTtsSpan: () => {}, flushInBackground: () => {} } });
mock.module(resolve(root, "lib/billing/track.ts"), { namedExports: { recordTtsSpend: () => {} } });
mock.module(resolve(root, "lib/tts/wsTicket.ts"), { namedExports: { registerWsConnectionRevocation: (_id: string, cb: () => void) => { revoked = cb; return () => {}; } } });
mock.module(resolve(root, "lib/obs/traceOwnership.ts"), { namedExports: { assertOwnedTrace: async () => true } });
mock.module(resolve(root, "lib/tts/providerConfig.ts"), { namedExports: { ttsConfig: () => ({ apiKey: "test", voiceId: "test", model: "eleven_flash_v2_5", provider: "elevenlabs" }) } });
mock.module(resolve(root, "lib/tts/ttsProvider.ts"), { namedExports: { createTtsRelay: () => ({ url: "wss://fake.invalid", headers: {}, segment: (id: string, text: string) => [{ id, text }], receive: (raw: string) => raw, dispose: () => {} }) } });
mock.module(resolve(root, "lib/billing/paidUsage.ts"), { namedExports: { reservePaidUsage: async () => { events.push("reserved"); let done = false; return { finish: async () => { if (!done) { done = true; events.push("charged"); } }, cancelBeforeDispatch: async () => { if (!done) { done = true; events.push("refunded"); } } }; } } });
const { createLessonGrant, releaseTurnGrant } = load(resolve(root, "lib/billing/grant.ts"));
const { relayTtsWebSocket } = load(resolve(root, "lib/tts/wsRelay.ts"));
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(resolveTick => setImmediate(resolveTick)); };
function client() {
  releaseTurnGrant("student"); events.length = 0; exists = true;
  const minted = createLessonGrant({ userId: "student", traceId: "lesson-trace", planId: "free", usdMillicents: 500, skipAutumn: true });
  assert(minted.ok);
  const ws = new Socket();
  relayTtsWebSocket(ws, { userId: "student", grant: minted.grant, traceId: "lesson-trace" });
  Socket.upstream.at(-1)!.emit("open");
  return ws;
}
async function main() {
let ws = client();
ws.emit("message", Buffer.from(JSON.stringify({ text: "First sentence", flush: true, segment_index: 1 })), false);
await tick();
assert.deepEqual(events.slice(0, 2), ["reserved", "send"], "receipt must commit before vendor speech dispatch");
ws.close(); await tick();
assert.equal(events.filter(e => e === "charged").length, 1, "disconnect without final provider usage keeps durable charge");
ws = client();
ws.emit("message", Buffer.from(JSON.stringify({ text: "one", flush: true, segment_index: 1 })), false);
ws.emit("message", Buffer.from(JSON.stringify({ text: "two", flush: true, segment_index: 1 })), false);
await tick();
assert.equal(events.filter(e => e === "send").length, 1, "repeated provider context cannot overwrite a pending paid segment");
ws.close(); await tick();
ws = client(); exists = false;
ws.emit("message", Buffer.from(JSON.stringify({ text: "deleted account", flush: true })), false);
await tick(); assert(!events.includes("send"), "deleted users cannot dispatch using an earlier cached grant");
ws.close();
ws = client(); revoked?.(); await tick(); assert.equal(ws.readyState, 3, "account deletion closes already-open speech sockets");
ws = client(); ws.emit("message", Buffer.from("not text"), true); await tick(); assert.equal(ws.readyState, 3, "binary speech requests are rejected");
console.log("WebSocket paid usage checks passed (5)");
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => mock.restoreAll());
