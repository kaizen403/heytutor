import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { Socket as NativeSocket } from "node:net";
import { resolve } from "node:path";
import { mock } from "node:test";
import type { SpendActor } from "../../lib/billing/actor";
import type { PeriodBalance } from "../../lib/billing/ledgerMath";

// Real routes, paidUsage receipts, grants, storageQuota, middleware, and server
// handlers; fake only authentication, persistence, telemetry, and provider IO.
const load = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
const file = (path: string) => resolve(root, path);
Object.assign(process.env, { NODE_ENV: "production", FIREWORKS_API_KEY: "test-only", WS_TICKET_SECRET: "test-only", LANGFUSE_ENABLED: "false" });
delete process.env.AUTH_DISABLED;
delete process.env.BACKEND_ORIGIN;
delete process.env.TUTOR_NOTES_EVALUATION_MODE;
globalThis.fetch = async () => { throw new Error("Network is prohibited in lifecycle verification"); };

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolvePromise => { release = resolvePromise; });
  return { promise, release };
}
const tick = async () => { for (let index = 0; index < 8; index++) await new Promise(resolveTick => setImmediate(resolveTick)); };
let actor: SpendActor;
let userExists = true;
let boardExists = true;
let charged = 0;
let reservedBytes = 0n;
let providerCalls = 0;
let notesAllowanceRefunds = 0;
let currentGrant: import("../../lib/billing/grant").TurnGrant;
let reservationWait: ReturnType<typeof deferred> | undefined;
let reservationStarted: ReturnType<typeof deferred> | undefined;
let assistantWait: ReturnType<typeof deferred> | undefined;
let assistantStarted: ReturnType<typeof deferred> | undefined;
let providerController: ReadableStreamDefaultController<Uint8Array> | undefined;
let providerCanceled = false;
let fetchThrows = false;
let failPaidSettlement = false;
let failUserReadAfterReservation = false;
let evaluatorCalls = 0;
let providerSignal: AbortSignal | undefined;
let throwVendorConnect = false;
let throwVendorSend = false;
let throwUpgrade = false;
let rejectUpgradeSilently = false;
let disposed = 0;
let testNumber = 0;
const receiptAmounts = new Map<string, number>();
const events: string[] = [];
type ChatRow = { id: string; boardId: string; userId: string; role: string; content: string; tag?: unknown; storageBytes: bigint; createdAt: Date };
const chatRows: ChatRow[] = [];
const deletionJobs: Array<{ id: string; prefix: string; userId: string; bytes: bigint }> = [];
const balance = (): PeriodBalance => ({ period: "2026-10", planId: "free", spentMillicents: charged, bonusMillicents: 0,
  allowanceMillicents: 100_000, remainingMillicents: 100_000 - charged, remainingPct: 100,
  nextResetAt: Date.now() + 86_400_000 });
const storedChatBytes = () => chatRows.reduce((bytes, row) => bytes + row.storageBytes, 0n);

class Socket extends EventEmitter {
  static OPEN = 1; static CONNECTING = 0;
  static upstream: Socket[] = [];
  readyState = Socket.OPEN;
  bufferedAmount = 0;
  sent: string[] = [];
  constructor(url?: string) {
    super();
    if (url) {
      if (throwVendorConnect) throw new Error("fake failed speech connection construction");
      this.readyState = Socket.CONNECTING;
      Socket.upstream.push(this);
    }
  }
  send(data: unknown) {
    if (Socket.upstream.includes(this)) {
      assert(charged > 0, "speech cannot dispatch before a durable receipt commits");
      events.push("vendor-send");
      if (throwVendorSend) throw new Error("fake uncertain vendor send failure");
    }
    this.sent.push(String(data));
  }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.emit("close"); }
  terminate() { this.close(); }
  open() { this.readyState = Socket.OPEN; this.emit("open"); }
}
const httpServer = new EventEmitter() as EventEmitter & { listen: () => void };
httpServer.listen = () => undefined;
mock.module("http", { namedExports: { createServer: () => httpServer } });
mock.module("next", { defaultExport: () => ({ prepare: () => ({ then: (ready: () => void) => ready() }), getRequestHandler: () => () => undefined }) });
mock.module(load.resolve("ws"), { namedExports: {
  WebSocket: Socket,
  WebSocketServer: class {
    handleUpgrade(_request: unknown, _socket: unknown, _head: unknown, callback: (ws: Socket) => void) {
      if (throwUpgrade) throw new Error("fake upgrade rejected after admission");
      if (rejectUpgradeSilently) { (_socket as NativeSocket).destroy(); return; }
      callback(new Socket());
    }
  },
} });
mock.module(resolve(root, "../../packages/tutor-core/src/index.ts"), { namedExports: {
  NOTES_CHAT_SYSTEM_PROMPT: "Explain the student's notes.",
  tutorDebug: () => undefined,
  stripNotesChatProtocol: (text: string) => text,
  getMockNotesChatResponse: () => "A mock answer",
  normalizeVoiceKey: () => "default",
  lessonNarrationText: (text: string) => text,
  readTraceIdHeader: (text?: string | null) => text ?? undefined,
} });
mock.module(file("lib/auth.ts"), { namedExports: { ensureUser: async () => undefined, getUserId: async () => actor.userId } });
mock.module(file("lib/billing/gate.ts"), { namedExports: {
  requireNotesAccess: async () => ({ actor, remaining: 10, release: async () => { notesAllowanceRefunds++; } }),
  requireSpendActor: async () => actor,
  isSpendActor: (value: unknown) => !(value instanceof Response),
} });
const db = {
  $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    if (/FROM boards/i.test(sql)) return userExists && boardExists && values[0] === "lifecycle-board" && values[1] === actor.userId
      ? [{ id: "lifecycle-board" }] : [];
    if (/FROM object_deletion_jobs/i.test(sql)) return deletionJobs.filter(job => job.userId === values[0]).map(job => ({ id: job.id }));
    return userExists ? [{ id: actor.userId }] : [];
  },
  user: { findUnique: async () => {
    if (failUserReadAfterReservation && receiptAmounts.size) throw new Error("fake account lookup failure");
    return userExists ? { id: actor.userId, planId: "free" } : null;
  } },
  userStorage: {
    findUnique: async () => ({ userId: actor.userId, reservedBytes, pendingTurns: 0 }),
    create: async () => { throw new Error("test accounting row already exists"); },
    update: async ({ data }: { data: { reservedBytes: bigint | { increment: bigint } } }) => {
      reservedBytes = typeof data.reservedBytes === "bigint" ? data.reservedBytes : reservedBytes + data.reservedBytes.increment;
      return { reservedBytes, pendingTurns: 0 };
    },
  },
  board: {
    findFirst: async () => boardExists ? { id: "lifecycle-board", userId: actor.userId, preview: "", title: "Lifecycle", createdAt: new Date() } : null,
    delete: async () => { boardExists = false; chatRows.length = 0; },
  },
  turn: { findMany: async () => [], aggregate: async () => ({ _sum: { storageBytes: 0n } }), count: async () => 0 },
  segment: { count: async () => 0 },
  boardChatMessage: {
    count: async ({ where }: { where?: { storageBytes?: number } } = {}) => where?.storageBytes === 0
      ? chatRows.filter(row => row.storageBytes === 0n && row.content !== "").length : chatRows.length,
    findMany: async ({ take }: { take?: number }) => take === undefined ? [...chatRows] : chatRows.slice(-take).reverse(),
    aggregate: async () => ({ _sum: { storageBytes: storedChatBytes() } }),
    create: async ({ data }: { data: Omit<ChatRow, "id" | "createdAt"> }) => {
      if (data.role === "assistant") { assistantStarted?.release(); await assistantWait?.promise; }
      assert(boardExists && userExists, "a persisted notes row must retain both FK owners");
      const row = { ...data, id: crypto.randomUUID(), createdAt: new Date() };
      chatRows.push(row); return row;
    },
  },
  objectDeletionJob: {
    // This notes/WS fixture creates deletion receipts, never expired upload intents.
    findFirst: async () => null,
    aggregate: async ({ where }: { where: { userId: string } }) => {
      const jobs = deletionJobs.filter(job => job.userId === where.userId);
      return { _sum: { bytes: jobs.length ? jobs.reduce((sum, job) => sum + job.bytes, 0n) : null, pendingTurns: 0 } };
    },
    create: async ({ data }: { data: typeof deletionJobs[number] }) => { deletionJobs.push(data); return data; },
  },
};
let transactionTail: Promise<void> = Promise.resolve();
const prisma = { ...db, $transaction: <T>(run: (tx: typeof db) => Promise<T>) => {
  const work = transactionTail.then(async () => {
    const bytes = reservedBytes;
    const rows = [...chatRows];
    const exists = boardExists;
    const jobs = [...deletionJobs];
    try { return await run(db); }
    catch (error) { reservedBytes = bytes; chatRows.splice(0, chatRows.length, ...rows); boardExists = exists; deletionJobs.splice(0, deletionJobs.length, ...jobs); throw error; }
  });
  transactionTail = work.then(() => undefined, () => undefined);
  return work;
} };
mock.module(file("lib/db/prisma.ts"), { namedExports: { prisma } });
mock.module(file("lib/billing/ledger.ts"), { namedExports: {
  reservePeriodUsage: async ({ millicents }: { millicents: number }) => {
    if (!userExists || millicents > balance().remainingMillicents) return null;
    const id = crypto.randomUUID();
    receiptAmounts.set(id, millicents); charged += millicents;
    events.push("reserved"); reservationStarted?.release(); await reservationWait?.promise;
    return { id, amountMillicents: millicents, remainingMillicents: balance().remainingMillicents, planId: "free" };
  },
  settlePeriodUsage: async ({ reservationId, actualMillicents }: { reservationId: string; actualMillicents?: number }) => {
    if (failPaidSettlement) throw new Error("fake paid settlement failure");
    const amount = receiptAmounts.get(reservationId);
    assert.notEqual(amount, undefined, "real receipt must settle exactly once");
    charged -= amount! - Math.min(amount!, actualMillicents ?? amount!);
    receiptAmounts.delete(reservationId);
    events.push(actualMillicents === 0 ? "refunded" : "finished");
  },
  loadPeriodBalance: async () => balance(),
} });
mock.module(file("lib/obs/sentryNode.ts"), { namedExports: { captureTtsRelayFailure: () => undefined } });
mock.module(file("lib/obs/langfuse.ts"), { namedExports: {
  genTraceId: () => `notes-lifecycle-${testNumber}`,
  startTurnTrace: () => null, endLlmGeneration: () => undefined,
  recordTtsSpan: () => undefined, flushInBackground: () => undefined,
} });
mock.module(file("lib/obs/traceOwnership.ts"), { namedExports: { assertOwnedTrace: async () => userExists } });
mock.module(file("lib/billing/track.ts"), { namedExports: {
  recordTtsSpend: () => undefined, recordLlmSpend: () => undefined, recordNotesMessage: () => undefined,
} });
mock.module(file("lib/tts/providerConfig.ts"), { namedExports: { ttsConfig: () => ({ apiKey: "test-only", voiceId: "test-only", provider: "elevenlabs", model: "eleven_flash_v2_5" }) } });
mock.module(file("lib/tts/ttsProvider.ts"), { namedExports: { createTtsRelay: () => ({
  url: "wss://fake.invalid", headers: {}, receive: (raw: string) => raw,
  segment: (id: string, text: string) => [{ id, text }], dispose: () => { disposed++; },
}) } });
mock.module(file("lib/llm/evaluation/gateway.ts"), { namedExports: { assessTutorState: async () => {
  evaluatorCalls++; assert(charged > 0, "policy cannot dispatch before its durable receipt commits");
  return { status: "assessed", decision: "allow", useCheapGenerator: false,
    usage: { inputTokens: 10, outputTokens: 10, estimatedUsd: 0.002 }, provenance: { model: "test-evaluator" } };
} } });
mock.module(file("lib/llm/teachingTransport.ts"), { namedExports: { fetchTeachingCompletion: async (input: { signal?: AbortSignal }) => {
  providerCalls++;
  providerSignal = input.signal;
  assert(charged > 0, "notes cannot dispatch before a durable receipt commits");
  events.push("notes-dispatch");
  if (fetchThrows) throw new Error("fake uncertain provider dispatch failure");
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      providerController = controller;
      input.signal?.addEventListener("abort", () => { try { controller.error(new DOMException("Provider aborted", "AbortError")); } catch { /* already complete */ } }, { once: true });
    },
    cancel() { providerCanceled = true; },
  }));
} } });
mock.module(file("lib/object-store/deletionJobs.ts"), { namedExports: { startObjectDeletionWorker: () => () => undefined } });

const grants = load(file("lib/billing/grant.ts")) as typeof import("../../lib/billing/grant");
const limits = load(file("lib/tts/wsRelayLimits.ts")) as typeof import("../../lib/tts/wsRelayLimits");
const tickets = load(file("lib/tts/wsTicket.ts")) as typeof import("../../lib/tts/wsTicket");
const { relayTtsWebSocket } = load(file("lib/tts/wsRelay.ts")) as typeof import("../../lib/tts/wsRelay");
const notes = load(file("app/api/boards/[boardId]/notes-chat/route.ts")) as typeof import("../../app/api/boards/[boardId]/notes-chat/route");
const board = load(file("app/api/boards/[boardId]/route.ts")) as typeof import("../../app/api/boards/[boardId]/route");
const { middleware } = load(file("middleware.ts")) as typeof import("../../middleware");
const { NextRequest } = load("next/server") as typeof import("next/server");
load(file("server.ts"));
const context = () => ({ params: Promise.resolve({ boardId: "lifecycle-board" }) });
function reset() {
  testNumber++;
  grants.resetTurnGrantsForTests(); limits.resetTtsWsConnectionsForTests();
  actor = { userId: `lifecycle-user-${testNumber}`, email: "fake@example.test", staff: false, lectureLab: false, skipGates: false, skipAutumn: true };
  userExists = true; boardExists = true; charged = 0; reservedBytes = 0n;
  providerCalls = 0; providerCanceled = false; notesAllowanceRefunds = 0; disposed = 0;
  fetchThrows = false; throwVendorConnect = false; throwVendorSend = false; throwUpgrade = false;
  rejectUpgradeSilently = false;
  failPaidSettlement = false; failUserReadAfterReservation = false; evaluatorCalls = 0; providerSignal = undefined;
  delete process.env.TUTOR_NOTES_EVALUATION_MODE;
  reservationWait = undefined; reservationStarted = undefined; assistantWait = undefined; assistantStarted = undefined;
  providerController = undefined; Socket.upstream.length = 0;
  chatRows.length = 0; deletionJobs.length = 0; receiptAmounts.clear(); events.length = 0;
  const minted = grants.createLessonGrant({ userId: actor.userId, traceId: "lifecycle-trace", usdMillicents: 100_000, skipAutumn: true });
  assert(minted.ok); currentGrant = minted.grant;
}
function wsClient() {
  assert(limits.tryAcquireTtsWsConnection(actor.userId));
  const client = new Socket();
  relayTtsWebSocket(client as unknown as import("ws").WebSocket, { userId: actor.userId, grant: currentGrant, traceId: "lifecycle-trace" });
  Socket.upstream.at(-1)?.open();
  return client;
}
function segment(client: Socket, value: unknown = { text: "An ordinary sentence", flush: true, segment_index: 1 }) {
  client.emit("message", Buffer.from(JSON.stringify(value)), false);
}
function request(body: unknown = { message: "Explain this step." }, signal?: AbortSignal) {
  return new Request("http://localhost/api/boards/lifecycle-board/notes-chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
}
function answer(text = "An ordinary answer", usage?: unknown) {
  providerController!.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }], ...(usage ? { usage } : {}) })}\n\n`));
  providerController!.close();
}
const failures: string[] = [];
async function check(name: string, run: () => Promise<void>) {
  reset();
  try { await run(); console.log(`PASS: ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL: ${name}`, error); }
  finally {
    reservationWait?.release(); assistantWait?.release();
    for (const vendor of Socket.upstream) vendor.close();
    tickets.revokeWsTickets(actor.userId);
    await tick();
  }
}
async function main() {
  await check("WS dispatch reserves real durable usage and missing finals retain its charge", async () => {
    const client = wsClient(); segment(client); await tick();
    assert.deepEqual(events.slice(0, 2), ["reserved", "vendor-send"]);
    const before = charged; assert(before > 0);
    client.close(); await tick();
    assert.equal(charged, before); assert.equal(receiptAmounts.size, 0); assert.equal(currentGrant.inUse, 0);
  });
  await check("WS cancellation while reservation commits refunds definitely undispatched work", async () => {
    reservationWait = deferred(); reservationStarted = deferred();
    const client = wsClient(); segment(client); await reservationStarted.promise;
    client.close(); reservationWait.release(); await tick();
    assert(!events.includes("vendor-send")); assert.equal(charged, 0); assert.equal(receiptAmounts.size, 0); assert.equal(currentGrant.inUse, 0);
  });
  await check("live-account deletion during WS admission prevents vendor dispatch", async () => {
    reservationWait = deferred(); reservationStarted = deferred();
    const client = wsClient(); segment(client); await reservationStarted.promise;
    userExists = false; grants.releaseTurnGrant(actor.userId); tickets.revokeWsTickets(actor.userId);
    reservationWait.release(); await tick();
    assert.equal(client.readyState, 3); assert(!events.includes("vendor-send")); assert.equal(receiptAmounts.size, 0);
  });
  await check("WS uncertain send errors retain charge and release receipt admission", async () => {
    const client = wsClient(); throwVendorSend = true; segment(client); await tick();
    assert(charged > 0); assert.equal(client.readyState, 3); assert.equal(receiptAmounts.size, 0); assert.equal(currentGrant.inUse, 0);
  });
  await check("WS provider errors retain dispatched charges and release all active receipts", async () => {
    const client = wsClient(); segment(client); await tick();
    const spent = charged; Socket.upstream.at(-1)!.emit("error", new Error("fake provider error")); await tick();
    assert.equal(client.readyState, 3); assert.equal(charged, spent); assert.equal(receiptAmounts.size, 0); assert.equal(currentGrant.inUse, 0);
  });
  await check("duplicate vendor finals cannot settle a receipt twice", async () => {
    const client = wsClient(); segment(client); await tick();
    const vendor = Socket.upstream.at(-1)!;
    const final = Buffer.from(JSON.stringify({ isFinal: true, contextId: "segment_1" }));
    vendor.emit("message", final, false); vendor.emit("message", final, false); await tick();
    assert.equal(events.filter(event => event === "finished").length, 1); assert.equal(receiptAmounts.size, 0);
    client.close();
  });
  await check("invalid WS primitive, segment and oversized messages never spend", async () => {
    for (const invalid of [null, 1, [], { text: 1, flush: true }, { text: "ok", flush: true, segment_index: -1 }, { text: "x".repeat(8001), flush: true }]) {
      const client = wsClient(); segment(client, invalid); await tick();
      assert.equal(client.readyState, 3); assert.equal(charged, 0); assert(!events.includes("vendor-send"));
    }
  });
  await check("upstream construction failure closes the client and releases WS capacity", async () => {
    throwVendorConnect = true;
    assert.doesNotThrow(() => wsClient(), "provider setup failure must use the same teardown path as a socket error");
    assert.equal(disposed, 1);
    for (let index = 0; index < 3; index++) assert(limits.tryAcquireTtsWsConnection(actor.userId), "failed setup must not occupy one of the three live slots");
  });
  await check("server upgrade failure releases capacity acquired before handleUpgrade", async () => {
    throwUpgrade = true;
    const socket = new NativeSocket();
    const ticket = tickets.mintWsTicket(actor.userId);
    httpServer.emit("upgrade", { url: `/api/tts/ws?ticket=${ticket}&traceId=lifecycle-trace`, headers: { host: "localhost", origin: "http://localhost" } }, socket, Buffer.alloc(0));
    await tick(); assert(socket.destroyed);
    for (let index = 0; index < 3; index++) assert(limits.tryAcquireTtsWsConnection(actor.userId), "rejected upgrade must release its acquired slot");
  });
  await check("a silently rejected WS handshake releases capacity when its raw socket closes", async () => {
    rejectUpgradeSilently = true;
    const socket = new NativeSocket();
    const ticket = tickets.mintWsTicket(actor.userId);
    httpServer.emit("upgrade", { url: `/api/tts/ws?ticket=${ticket}&traceId=lifecycle-trace`, headers: { host: "localhost", origin: "http://localhost" } }, socket, Buffer.alloc(0));
    await tick(); assert(socket.destroyed);
    for (let index = 0; index < 3; index++) assert(limits.tryAcquireTtsWsConnection(actor.userId), "handshake rejection without a callback must release its slot");
  });
  await check("notes missing usage retains precharge and refunds unused reply capacity", async () => {
    const response = await notes.POST(request(), context());
    assert.equal(response.status, 200); assert(charged > 0);
    const before = charged; answer(); await response.text(); await tick();
    assert.equal(charged, before); assert.equal(receiptAmounts.size, 0); assert.equal(reservedBytes, storedChatBytes()); assert.equal(chatRows.length, 2);
    assert.equal(notesAllowanceRefunds, 0, "a delivered answer consumes its notes-message allowance");
  });
  await check("notes upstream read errors release only unused reply storage and settle paid usage", async () => {
    const response = await notes.POST(request(), context());
    providerController!.error(new Error("fake provider read failure"));
    await assert.rejects(() => response.text()); await tick();
    assert.equal(reservedBytes, storedChatBytes()); assert.equal(chatRows.length, 1); assert.equal(receiptAmounts.size, 0); assert(charged > 0);
    assert(notesAllowanceRefunds > 0, "a failed response without an answer releases its notes-message allowance");
  });
  await check("a failed paid settlement cannot prevent unused notes storage from being released", async () => {
    fetchThrows = true; failPaidSettlement = true;
    await assert.rejects(() => notes.POST(request(), context())); await tick();
    assert(charged > 0, "uncertain dispatch and settlement failure must retain the durable charge");
    assert.equal(reservedBytes, storedChatBytes()); assert.equal(currentGrant.inUse, 0);
  });
  await check("a policy preflight failure refunds undispatched policy usage and releases storage", async () => {
    process.env.TUTOR_NOTES_EVALUATION_MODE = "shadow"; process.env.AI_GATEWAY_API_KEY = "test-only";
    failUserReadAfterReservation = true;
    await assert.rejects(() => notes.POST(request(), context())); await tick();
    assert.equal(evaluatorCalls, 0); assert.equal(charged, 0); assert.equal(receiptAmounts.size, 0);
    assert.equal(reservedBytes, storedChatBytes()); assert.equal(currentGrant.inUse, 0);
  });
  await check("known policy usage settles once while notes without usage retains its own cap", async () => {
    process.env.TUTOR_NOTES_EVALUATION_MODE = "shadow"; process.env.AI_GATEWAY_API_KEY = "test-only";
    const response = await notes.POST(request(), context()); answer(); await response.text(); await tick();
    assert.equal(evaluatorCalls, 1); assert.equal(providerCalls, 1); assert.equal(receiptAmounts.size, 0);
    assert.equal(events.filter(event => event === "finished").length, 2); assert.equal(reservedBytes, storedChatBytes());
  });
  await check("notes stream cancellation refunds unused storage and retains dispatched usage", async () => {
    const response = await notes.POST(request(), context());
    await response.body!.cancel(); await tick();
    assert(providerCanceled); assert.equal(reservedBytes, storedChatBytes()); assert.equal(chatRows.length, 1); assert.equal(receiptAmounts.size, 0); assert(charged > 0);
  });
  await check("notes cancellation during reply persistence cannot refund stored assistant bytes", async () => {
    assistantWait = deferred(); assistantStarted = deferred();
    const response = await notes.POST(request(), context()); answer();
    const reader = response.body!.getReader(); await reader.read(); await assistantStarted.promise;
    const canceled = reader.cancel(); await tick(); assistantWait.release();
    // A canceled TransformStream can reject its final enqueue. The accounting
    // invariant must hold on that path as well as on a resolved cancellation.
    await canceled.catch((error: { code?: string }) => { assert.equal(error.code, "ERR_INVALID_STATE"); }); await tick();
    assert.equal(reservedBytes, storedChatBytes(), "stored replies must remain charged even when cancellation races their transaction");
    assert.equal(receiptAmounts.size, 0);
  });
  await check("board deletion while notes streams cannot leak or refund unrelated storage", async () => {
    const unrelatedBytes = 500n; reservedBytes = unrelatedBytes;
    const response = await notes.POST(request(), context());
    const deleted = await board.DELETE(new Request("http://localhost/api/boards/lifecycle-board", { method: "DELETE" }), context());
    assert.equal(deleted.status, 200); assert.equal(deletionJobs.length, 1);
    answer(); await assert.rejects(() => response.text()); await tick();
    assert.equal(reservedBytes, unrelatedBytes + deletionJobs[0]!.bytes, "only confirmed object cleanup can refund the deleted board charge");
    assert.equal(chatRows.length, 0); assert.equal(receiptAmounts.size, 0);
  });
  await check("notes primitive, malformed and oversized inputs never reserve storage or paid work", async () => {
    for (const invalid of [null, true, [], { message: null }, { message: " " }, { message: "x".repeat(2001) }]) {
      const response = await notes.POST(request(invalid), context());
      assert.equal(response.status, 400); assert.equal(reservedBytes, 0n); assert.equal(charged, 0); assert.equal(providerCalls, 0);
    }
    const oversized = await notes.POST(request({ message: "ok", ignored: "x".repeat(513 * 1024) }), context());
    assert.equal(oversized.status, 413); assert.equal(charged, 0); assert.equal(providerCalls, 0);
  });
  await check("an already canceled notes request never dispatches and refunds its reservation", async () => {
    const abort = new AbortController(); abort.abort();
    const response = await notes.POST(request(undefined, abort.signal), context());
    if (response.body) await response.body.cancel(); await tick();
    assert.equal(providerCalls, 0, "pre-dispatch cancellation must not call the provider");
    assert.equal(charged, 0); assert.equal(reservedBytes, storedChatBytes()); assert.equal(receiptAmounts.size, 0);
  });
  await check("account deletion while notes admission commits prevents subsequent dispatch", async () => {
    reservationWait = deferred(); reservationStarted = deferred();
    const responsePromise = notes.POST(request(), context()); await reservationStarted.promise;
    userExists = false; grants.releaseTurnGrant(actor.userId); tickets.revokeWsTickets(actor.userId);
    reservationWait.release(); const response = await responsePromise;
    if (response.body) await response.body.cancel(); await tick();
    assert.equal(providerCalls, 0, "the deleted owner must be checked again after asynchronous admission");
  });
  await check("account deletion aborts an already dispatched notes provider stream", async () => {
    const response = await notes.POST(request(), context());
    const spentBeforeDeletion = charged;
    userExists = false; reservedBytes = 0n; chatRows.length = 0;
    grants.releaseTurnGrant(actor.userId); tickets.revokeWsTickets(actor.userId);
    assert(providerSignal?.aborted, "live account revocation must reach the provider's abort signal");
    await assert.rejects(() => response.text()); await tick();
    assert.equal(receiptAmounts.size, 0); assert.equal(charged, spentBeforeDeletion);
  });
  await check("production API middleware replaces caller CSP/nonce and propagates matching fresh nonces", async () => {
    const make = () => new NextRequest("http://localhost/api/boards", { headers: { "x-nonce": "attacker", "content-security-policy": "script-src * 'unsafe-inline'" } });
    const first = await middleware(make()); const second = await middleware(make());
    const nonce = first.headers.get("x-middleware-request-x-nonce");
    assert(nonce && nonce !== "attacker"); assert.notEqual(second.headers.get("x-middleware-request-x-nonce"), nonce);
    const policy = first.headers.get("content-security-policy")!;
    assert(policy.includes(`'nonce-${nonce}'`));
    assert.equal(first.headers.get("x-middleware-request-content-security-policy"), policy);
    const script = policy.split(";").find(value => value.trim().startsWith("script-src"))!;
    assert(!script.includes("unsafe-inline") && !script.includes("unsafe-eval"));
  });
  if (failures.length) throw new Error(`${failures.length} lifecycle checks failed: ${failures.join("; ")}`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => mock.restoreAll());
