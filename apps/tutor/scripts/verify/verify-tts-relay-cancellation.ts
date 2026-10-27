import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const source = resolve(import.meta.dirname, "../../lib/tts/wsRelay.ts");
const code = ts.transpileModule(readFileSync(process.env.TTS_RELAY_CANCELLATION_MUTATION_SOURCE ?? source, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
let checks = 0;
function check(actual: unknown, expected: unknown, message: string) {
  assert.equal(actual, expected, message);
  checks++;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise<void>(done => setImmediate(done)); };

/** The real relay is evaluated with an error-emitting ws fake; no provider or DB calls. */
function fixture(options: { reservePending?: boolean; finishFails?: boolean; cancelFails?: boolean; undispatched?: boolean; asyncTerminate?: boolean } = {}) {
  const captures: unknown[] = [];
  let released = 0, disposed = 0, unregistered = 0, finished = 0, cancelled = 0, reserved = 0;
  let revoke = () => {};
  const timers = new Set<() => void>();
  class Socket extends EventEmitter {
    static OPEN = 1; static CONNECTING = 0;
    static upstream: Socket;
    readyState: number;
    bufferedAmount = 0;
    sent: string[] = [];
    closeCalls = 0;
    terminateCalls = 0;
    constructor(url?: string) {
      super();
      this.readyState = url ? Socket.CONNECTING : Socket.OPEN;
      if (url) Socket.upstream = this;
    }
    send(data: unknown) { this.sent.push(String(data)); }
    close() {
      this.closeCalls++;
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.emit("close");
    }
    terminate() {
      this.terminateCalls++;
      const connecting = this.readyState === Socket.CONNECTING;
      this.readyState = 3;
      // ws emits this error when terminate() aborts an unfinished handshake.
      if (connecting) {
        const error = new Error("WebSocket was closed before the connection was established");
        if (options.asyncTerminate) queueMicrotask(() => this.emit("error", error));
        else this.emit("error", error);
      }
      this.emit("close");
    }
    open() { this.readyState = Socket.OPEN; this.emit("open"); }
  }
  const grant = { skipGates: false, skipAutumn: true, allowedTraceIds: new Set(["synthetic-trace"]) };
  const receipt = {
    finish: async () => { finished++; if (options.finishFails) throw new Error("synthetic billing settlement failure"); },
    cancelBeforeDispatch: async () => { cancelled++; if (options.cancelFails) throw new Error("synthetic billing cancellation failure"); },
  };
  const reservation = deferred<typeof receipt>();
  const dependencies: Record<string, unknown> = {
    ws: { WebSocket: Socket },
    "@heytutor/tutor-core": { normalizeVoiceKey: (voice: unknown) => voice },
    "../db/prisma": { prisma: { user: { findUnique: async () => ({ id: "synthetic-user" }) } } },
    "../obs/sentryNode": { captureTtsRelayFailure: (error: unknown) => captures.push(error) },
    "../obs/langfuse": { flushInBackground: () => {}, recordTtsSpan: () => {} },
    "../obs/traceOwnership": { assertOwnedTrace: async () => true },
    "../obs/usageCost": { calculateTtsCostDetails: () => ({ total: 0 }) },
    "../billing/grant": { consumeTtsChars: () => ({ allowed: true }), getTurnGrant: () => grant, shouldSkipTtsForUsage: () => false },
    "../billing/paidUsage": { reservePaidUsage: async () => { reserved++; return options.reservePending ? reservation.promise : receipt; } },
    "../billing/track": { recordTtsSpend: () => {} },
    "./providerConfig": { ttsConfig: () => ({ apiKey: "synthetic", voiceId: "synthetic", model: "synthetic", provider: "cartesia" }) },
    "./ttsProvider": { createTtsRelay: () => ({
      url: "wss://provider.example.test/synthetic", headers: {},
      segment: () => [{ text: "synthetic speech" }], receive: (raw: string) => raw,
      dispose: () => { disposed++; },
      undispatched: () => options.undispatched ? ["segment_1"] : [],
    }) },
    "./sarvamProtocol": { sarvamSpeechText: (text: string) => text },
    "./wsTicket": { registerWsConnectionRevocation: (_user: string, callback: () => void) => { revoke = callback; return () => { unregistered++; }; } },
    "./wsRelayLimits": { releaseTtsWsConnection: () => { released++; }, TTS_WS_IDLE_MS: 120000, TTS_WS_MAX_MESSAGE_CHARS: 8000, ttsWsCharsWithinCeiling: () => true },
  };
  const compiledModule = { exports: {} };
  vm.runInNewContext(code, {
    exports: compiledModule.exports, module: compiledModule, Response, Date, Set, Map,
    require: (name: string) => {
      assert(name in dependencies, `Unexpected relay fixture dependency: ${name}`);
      return dependencies[name];
    },
    setTimeout: (callback: () => void) => { timers.add(callback); return callback; },
    clearTimeout: (callback: () => void) => timers.delete(callback),
    setInterval: (callback: () => void) => { timers.add(callback); return callback; },
    clearInterval: (callback: () => void) => timers.delete(callback),
  }, { filename: source });
  const client = new Socket();
  const relay = compiledModule.exports as {
    relayTtsWebSocket: (client: Socket, context: Record<string, unknown>) => void;
    inFlightSpeechSegments: () => number;
    beginSpeechDrain: () => void;
  };
  relay.relayTtsWebSocket(client, { userId: "synthetic-user", traceId: "synthetic-trace", grant });
  return {
    client, vendor: Socket.upstream, captures, receipt, reservation, revoke: () => revoke(),
    say: (index = 1) => client.emit("message", Buffer.from(JSON.stringify({ text: "synthetic speech", flush: true, segment_index: index })), false),
    final: (index = 1) => Socket.upstream.emit("message", Buffer.from(JSON.stringify({ contextId: `segment_${index}`, isFinal: true })), false),
    inFlight: () => relay.inFlightSpeechSegments(),
    beginDrain: () => relay.beginSpeechDrain(),
    stats: () => ({ released, disposed, unregistered, finished, cancelled, reserved, timers: timers.size }),
    skips: () => client.sent.map(raw => JSON.parse(raw)).filter(message => message.type === "skip"),
  };
}
function checkClosed(f: ReturnType<typeof fixture>, skips: number) {
  check(f.stats().released, 1, "connection quota is released exactly once");
  check(f.stats().disposed, 1, "provider relay is disposed exactly once");
  check(f.stats().unregistered, 1, "revocation subscription is removed exactly once");
  check(f.stats().timers, 0, "idle and keepalive timers are cleared");
  check(f.skips().length, skips, "teardown never sends a second skip");
}

async function main() {
  // This is the production noise: client Stop while the upstream is CONNECTING.
  let f = fixture();
  f.client.close();
  check(f.captures.length, 0, "client cancellation before handshake must not report a provider failure");
  check(f.vendor.terminateCalls, 1, "unfinished upstream handshake is terminated once");
  f.client.emit("close");
  checkClosed(f, 0);

  f = fixture({ asyncTerminate: true });
  f.client.close(); await tick();
  check(f.captures.length, 0, "asynchronous handshake termination error after cancellation is ignored");
  checkClosed(f, 0);

  f = fixture();
  f.vendor.open();
  f.client.close();
  check(f.captures.length, 0, "cancellation after open is not a provider error");
  check(f.vendor.closeCalls, 1, "open upstream is closed once");
  checkClosed(f, 0);

  f = fixture();
  f.revoke();
  check(f.captures.length, 0, "account revocation aborting the handshake is not a provider error");
  check(f.skips()[0]?.reason, "account_revoked", "revocation keeps the original client reason");
  checkClosed(f, 1);

  // Genuine errors before teardown remain failures, including handshake timeout.
  for (const opened of [false, true]) {
    f = fixture();
    if (opened) f.vendor.open();
    const error = new Error(opened ? "synthetic vendor failure" : "Opening handshake has timed out");
    f.vendor.emit("error", error);
    check(f.captures.length, 1, "genuine vendor error is captured once, without a teardown duplicate");
    check(f.captures[0], error, "the genuine error is retained");
    check(f.skips()[0]?.reason, "speech_generation_failed", "genuine vendor error closes the lesson speech connection");
    checkClosed(f, 1);
  }

  // A durable accounting failure after Stop still requires reporting.
  for (const undispatched of [false, true]) {
    f = fixture({ finishFails: !undispatched, cancelFails: undispatched, undispatched });
    f.vendor.open(); f.say(); await tick();
    check(f.stats().reserved, 1, "synthetic segment passed actual relay admission");
    f.client.close(); await tick();
    check(f.captures.length, 1, "late receipt failure is reported even though the relay stopped");
    check(f.stats().finished, undispatched ? 0 : 1, "dispatched segment settlement is attempted once");
    check(f.stats().cancelled, undispatched ? 1 : 0, "undispatched segment cancellation is attempted once");
    checkClosed(f, 0);
  }

  // An in-flight queue awaiting admission can fail after the connection closes.
  f = fixture({ reservePending: true, cancelFails: true });
  f.vendor.open(); f.say(); await tick();
  check(f.stats().reserved, 1, "reservation is pending before cancellation");
  f.client.close();
  f.reservation.resolve(f.receipt); await tick();
  check(f.captures.length, 1, "late queued admission cancellation failure remains reported");
  check(f.stats().cancelled, 1, "late admission is cancelled before dispatch once");
  check(f.vendor.sent.length, 0, "late admission never sends speech after Stop");
  checkClosed(f, 0);
  // A restart lets the sentence being spoken finish. An idle relay closes at
  // the drain with 1012; a busy one admits nothing new, keeps its in-flight
  // segment, and closes when that segment's final arrives.
  f = fixture();
  f.vendor.open();
  check(f.inFlight(), 0, "an open relay with nothing sent has no speech in flight");
  f.beginDrain();
  check(f.skips()[0]?.reason, "server_restarting", "an idle relay closes at the drain as a service restart");
  checkClosed(f, 1);

  f = fixture();
  f.vendor.open(); f.say(1); await tick();
  check(f.inFlight(), 1, "a dispatched segment is in flight until its final");
  f.beginDrain();
  check(f.skips().length, 0, "a busy relay is not closed at the drain");
  f.say(2); await tick();
  check(f.stats().reserved, 1, "no new segment is admitted or charged during the drain");
  check(f.vendor.sent.filter((raw) => raw.includes("synthetic speech")).length, 1, "no new segment reaches the provider during the drain");
  check(f.skips().length, 0, "a refused segment does not cut the sentence still being spoken");
  f.final(1); await tick();
  check(f.inFlight(), 0, "the in-flight segment finished");
  check(f.stats().finished, 1, "the finished segment is settled once");
  check(f.skips()[0]?.reason, "server_restarting", "the relay closes as a restart once its last segment finishes");
  checkClosed(f, 1);

  console.log(`TTS relay cancellation: ${checks} checks passed; actual relay with fake sockets and receipts, no network; a restart lets the sentence in flight finish`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
