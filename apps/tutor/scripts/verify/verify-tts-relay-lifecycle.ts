import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { Duplex } from "node:stream";
import { resolve } from "node:path";
import { mock } from "node:test";
import { WebSocket, WebSocketServer } from "ws";

// Exercise the real relay and ws CONNECTING termination on loopback. Only
// provider configuration, telemetry, identity and billing leave this fixture.
const app = resolve(import.meta.dirname, "../..");
const load = createRequire(import.meta.url);
const file = (name: string) => resolve(app, name);
const failures: unknown[] = [];
const settlementFailure = new Error("synthetic receipt settlement failed");
let revoke: (() => void) | undefined;
let releases = 0;
let disposals = 0;
let reservations = 0;
let rejectSettlement = false;
let providerMode: "hold" | "open" = "hold";
let providerUrl = "";

mock.module(file("lib/db/prisma.ts"), { namedExports: { prisma: { user: { findUnique: async () => ({ id: "student" }) } } } });
mock.module(file("lib/obs/sentryNode.ts"), { namedExports: { captureTtsRelayFailure: (error: unknown) => failures.push(error) } });
mock.module(file("lib/obs/langfuse.ts"), { namedExports: { recordTtsSpan() {}, flushInBackground() {} } });
mock.module(file("lib/billing/track.ts"), { namedExports: { recordTtsSpend() {} } });
mock.module(file("lib/obs/traceOwnership.ts"), { namedExports: { assertOwnedTrace: async () => true } });
mock.module(file("lib/tts/wsTicket.ts"), { namedExports: {
  registerWsConnectionRevocation: (_user: string, callback: () => void) => {
    revoke = callback;
    return () => { revoke = undefined; };
  },
} });
mock.module(file("lib/tts/providerConfig.ts"), { namedExports: {
  ttsConfig: () => ({ apiKey: "synthetic", voiceId: "synthetic", provider: "elevenlabs", model: "eleven_flash_v2_5" }),
} });
mock.module(file("lib/tts/ttsProvider.ts"), { namedExports: { createTtsRelay: () => ({
  url: providerUrl, headers: {},
  segment: (id: string, text: string) => [{ id, text }],
  receive: (raw: string) => raw,
  dispose: () => { disposals++; },
}) } });
mock.module(file("lib/billing/paidUsage.ts"), { namedExports: {
  reservePaidUsage: async () => {
    reservations++;
    return {
      finish: async () => { if (rejectSettlement) throw settlementFailure; },
      cancelBeforeDispatch: async () => {},
    };
  },
} });

const { createLessonGrant, releaseTurnGrant } = load(file("lib/billing/grant.ts")) as typeof import("../../lib/billing/grant");
// A sibling source copy permits historical/mutation checks without modifying
// the production module or making the fixture emulate ws's error semantics.
const { relayTtsWebSocket, speechSettlementsDone, openSpeechSettlements } = load(
  process.env.TTS_RELAY_LIFECYCLE_SOURCE ?? file("lib/tts/wsRelay.ts"),
) as typeof import("../../lib/tts/wsRelay");
const server = createServer();
const clients = new WebSocketServer({ noServer: true });
const providers = new WebSocketServer({ noServer: true });
const sockets = new Set<Duplex>();
server.on("connection", socket => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});
server.on("upgrade", (request, socket, head) => {
  if (request.url === "/client") {
    clients.handleUpgrade(request, socket, head, client => {
      const minted = createLessonGrant({ userId: "student", traceId: "synthetic-trace", planId: "free", usdMillicents: 500, skipAutumn: true });
      assert(minted.ok);
      relayTtsWebSocket(client, {
        userId: "student", traceId: "synthetic-trace", grant: minted.grant,
        releaseConnection: () => { releases++; server.emit("relay-release"); },
      });
    });
  } else if (request.url === "/provider") {
    if (providerMode === "open") providers.handleUpgrade(request, socket, head, provider => providers.emit("connection", provider));
    // In hold mode no upgrade response is sent: the upstream stays CONNECTING.
    server.emit("provider-request", socket);
  } else {
    socket.destroy();
  }
});

const tick = () => new Promise<void>(done => setImmediate(done));
async function connect() {
  failures.length = 0;
  releases = 0;
  disposals = 0;
  releaseTurnGrant("student");
  const request = once(server, "provider-request");
  const released = once(server, "relay-release");
  const client = new WebSocket(providerUrl.replace("/provider", "/client"));
  const messages: Array<Record<string, unknown>> = [];
  client.on("message", raw => messages.push(JSON.parse(raw.toString())));
  const closed = once(client, "close");
  await once(client, "open");
  const [upstream] = await request as [Duplex];
  return { client, upstream, messages, closed, released };
}
async function settled(attempt: Awaited<ReturnType<typeof connect>>) {
  await attempt.released;
  await speechSettlementsDone();
  await tick();
  assert.equal(openSpeechSettlements(), 0, "receipt settlement work is drained");
  assert.equal(releases, 1, "the connection slot is released exactly once");
  assert.equal(disposals, 1, "the provider adapter is disposed exactly once");
}

async function main() {
  // No external listeners, credentials, database or provider requests.
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  providerUrl = `ws://127.0.0.1:${address.port}/provider`;

  let attempt = await connect();
  attempt.client.close();
  await attempt.closed;
  await settled(attempt);
  assert.deepEqual(failures, [], "closing a client during CONNECTING must not report the ws termination as a provider failure");
  assert.equal(reservations, 0, "a cancelled handshake does not admit paid speech");
  attempt.upstream.destroy();

  attempt = await connect();
  assert(revoke);
  revoke();
  assert.equal((await attempt.closed)[0], 1008);
  await settled(attempt);
  assert.deepEqual(attempt.messages, [{ type: "skip", reason: "account_revoked" }]);
  assert.deepEqual(failures, [], "revocation owns the CONNECTING termination too");
  attempt.upstream.destroy();

  attempt = await connect();
  attempt.upstream.destroy();
  assert.equal((await attempt.closed)[0], 1011);
  await settled(attempt);
  assert.equal(failures.length, 1, "a genuine upstream connection failure still reports once");
  assert.match(String(failures[0]), /socket hang up/);
  assert.deepEqual(attempt.messages, [{ type: "skip", reason: "speech_generation_failed" }]);

  attempt = await connect();
  attempt.upstream.end("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  assert.equal((await attempt.closed)[0], 1011);
  await settled(attempt);
  assert.equal(failures.length, 1, "a genuine provider HTTP refusal still reports once");
  assert.match(String(failures[0]), /Unexpected server response: 503/);

  // A failed connection does not disable a later attempt or swallow accounting
  // errors that settle after teardown. Use real WS traffic to admit a segment.
  providerMode = "open";
  const providerConnected = once(providers, "connection");
  attempt = await connect();
  const [provider] = await providerConnected as [WebSocket];
  if (!attempt.messages.some(message => message.type === "ready")) await once(attempt.client, "message");
  assert.deepEqual(attempt.messages, [{ type: "ready" }], "a fresh retry completes the handshake");
  const speech = once(provider, "message");
  attempt.client.send(JSON.stringify({ text: "Synthetic sentence", flush: true, segment_index: 1 }));
  const [raw] = await speech;
  assert.deepEqual(JSON.parse(String(raw)), { id: "segment_1", text: "Synthetic sentence" });
  assert.equal(reservations, 1, "only the successful retry reserves speech");
  rejectSettlement = true;
  attempt.client.close();
  await attempt.closed;
  await settled(attempt);
  assert.deepEqual(failures, [settlementFailure], "receipt errors remain observable after relay teardown");
  console.log("TTS relay lifecycle: client cancellation, revocation, real handshake failures, retry and settlement reporting passed (loopback ws, no external I/O)");
}

const timeout = setTimeout(() => {
  console.error("TTS relay lifecycle timed out");
  process.exitCode = 1;
  for (const socket of sockets) socket.destroy();
  server.close();
}, 8_000);
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  clearTimeout(timeout);
  for (const client of [...clients.clients, ...providers.clients]) client.terminate();
  for (const socket of sockets) socket.destroy();
  clients.close();
  providers.close();
  await new Promise<void>(done => server.close(() => done()));
  releaseTurnGrant("student");
  mock.restoreAll();
});
