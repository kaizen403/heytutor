import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";

// Real handlers and resource policy; only identity, persistence, providers, and
// listening sockets are replaced. This script cannot contact a paid provider.
const load = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
const modulePath = (path: string) => resolve(root, path);
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("External network is prohibited in resource verification"); };
Object.assign(process.env, { NODE_ENV: "production" });
process.env.LANGFUSE_ENABLED = "false";

const userId = "f6fa709b-b77a-487c-b7d0-5fb8a6c60679";
const boardId = "2ee1e7eb-aae0-40ba-a494-a13c99d63e9a";
const date = new Date("2026-10-02T00:00:00Z");
const board = { id: boardId, userId, title: "A lesson", preview: "", createdAt: date, updatedAt: date, pinnedAt: null, archivedAt: null };
let scenario: "normal" | "board-limit" | "turn-limit" | "storage-limit" | "list" | "near-turn-limit" | "foreign-trace" | "save-and-cleanup-failure" | "cancel-upload" = "normal";
let uploadStarted: (() => void) | null = null;
let writes = 0;
let uploads = 0;
let parses = 0;
let ledgerBytes = 0n;
let pendingTurns = 0;
let createdTurns = 0;
let mediaReads = 0;
const committedTurns = new Map<string, Record<string, unknown>>();
const traceReceipts = new Map<string, string>();
const deletionJobs = new Map<string, Record<string, unknown>>();
const quotaRow = () => ({ userId, reservedBytes: scenario === "storage-limit" ? 1_099_511_627_776n : ledgerBytes, pendingTurns });
const boardRows = Array.from({ length: 251 }, (_, index) => ({ ...board, id: `listed-${index}` }));
const tx = {
  $queryRaw: async () => [{ id: userId, userId, reserved_bytes: quotaRow().reservedBytes, reservedBytes: quotaRow().reservedBytes }],
  $executeRaw: async () => 1,
  user: {
    findUnique: async () => ({ id: userId, email: "resource-test@example.test", onboardingCompletedAt: date, createdAt: date, settings: null }),
    update: async () => ({ id: userId }),
  },
  userStorage: {
    findUnique: async () => quotaRow(),
    upsert: async () => quotaRow(),
    update: async ({ data }: { data: { reservedBytes?: bigint | { increment: bigint }; pendingTurns?: number | { increment: number } } }) => {
      if (typeof data.reservedBytes === "bigint") ledgerBytes = data.reservedBytes;
      else if (data.reservedBytes) ledgerBytes += data.reservedBytes.increment;
      if (typeof data.pendingTurns === "number") pendingTurns = data.pendingTurns;
      else if (data.pendingTurns) pendingTurns += data.pendingTurns.increment;
      return quotaRow();
    },
    updateMany: async () => ({ count: 1 }),
    create: async () => quotaRow(),
  },
  ownedTrace: {
    findUnique: async ({ where }: { where: { traceId: string } }) => ({
      traceId: where.traceId, userId: scenario === "foreign-trace" ? "another-user" : userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), savedTurnId: traceReceipts.get(where.traceId) ?? null,
    }),
    update: async ({ where, data }: { where: { traceId: string }; data: { savedTurnId: string } }) => {
      traceReceipts.set(where.traceId, data.savedTurnId);
    },
  },
  objectDeletionJob: {
    findUnique: async ({ where }: { where: { prefix?: string; id?: string } }) => where.prefix ? deletionJobs.get(where.prefix) ?? null : [...deletionJobs.values()].find(job => job.id === where.id) ?? null,
    create: async ({ data }: { data: Record<string, unknown> & { prefix: string } }) => { const job = { attempts: 0, ...data }; deletionJobs.set(data.prefix, job); return job; },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const job = [...deletionJobs.values()].find(item => item.id === where.id)!; Object.assign(job, data); return job;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      for (const [prefix, job] of deletionJobs) if (job.id === where.id) deletionJobs.delete(prefix);
    },
  },
  board: {
    findFirst: async ({ where }: { where: { id?: string } } = { where: {} }) => where.id && where.id !== boardId ? null : board,
    findUnique: async () => board,
    findMany: async ({ take, skip = 0 }: { take?: number; skip?: number } = {}) => scenario === "list" ? boardRows.slice(skip, take === undefined ? undefined : skip + take) : [board],
    count: async () => scenario === "board-limit" ? 4_000_000 : 0,
    create: async ({ data }: { data: object }) => { writes++; return { ...board, ...data }; },
    update: async ({ data }: { data: object }) => { writes++; return { ...board, ...data }; },
  },
  turn: {
    findFirst: async ({ where }: { where: { id?: string; userId?: string; boardId?: string } }) => {
      const turn = where.id ? committedTurns.get(where.id) : undefined;
      return turn && Object.entries(where).every(([key, value]) => turn[key] === value) ? turn : null;
    },
    count: async () => scenario === "turn-limit" ? 4_000_000 : scenario === "near-turn-limit" ? 99 + createdTurns : createdTurns,
    findMany: async ({ take, skip = 0 }: { take?: number; skip?: number } = {}) => scenario === "list" ? boardRows.slice(skip, take === undefined ? undefined : skip + take) : [],
    aggregate: async () => ({ _sum: { storageBytes: quotaRow().reservedBytes } }),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      writes++; createdTurns++;
      const turn = { ...data, createdAt: date, segments: [] };
      committedTurns.set(String(data.id), turn);
      return turn;
    },
  },
  segment: {
    createManyAndReturn: async ({ data }: { data: object[] }) => data.map((value, index) => ({ ...value, id: `segment-${index}` })),
  },
  boardChatMessage: { findMany: async ({ take }: { take?: number } = {}) => boardRows.slice(0, take), aggregate: async () => ({ _sum: { storageBytes: 0n } }) },
};
let lockTail = Promise.resolve();
const prisma = {
  ...tx,
  $queryRaw: async (...args: unknown[]) => {
    const sql = Array.isArray(args[0]) ? args[0].join("") : "";
    if (!sql.includes("WITH due")) return tx.$queryRaw();
    const now = args[1] as Date;
    const lease = args[2] as Date;
    const job = [...deletionJobs.values()].find(item => (item.nextAttemptAt as Date) <= now);
    if (!job) return [];
    job.attempts = Number(job.attempts) + 1;
    job.nextAttemptAt = lease;
    return [{ ...job }];
  },
  $transaction: async <T>(callback: (value: typeof tx) => Promise<T>) => {
    if (scenario === "save-and-cleanup-failure" && uploads > 0) throw new Error("fake transient database outage");
    let unlock: (() => void) | undefined;
    const connection = { ...tx, $queryRaw: async (...args: unknown[]) => {
      const sql = Array.isArray(args[0]) ? args[0].join("") : "";
      if (!unlock && sql.includes("users") && sql.includes("FOR UPDATE")) {
        const previous = lockTail;
        lockTail = new Promise<void>((release) => { unlock = release; });
        await previous;
      }
      return tx.$queryRaw();
    } };
    try { return await callback(connection); } finally { unlock?.(); }
  },
};
mock.module(modulePath("lib/auth.ts"), {
  namedExports: { getUserId: async () => userId, ensureUser: async () => undefined, requireSessionUserId: async () => userId, isAuthFailure: () => false },
});
mock.module(modulePath("lib/db/prisma.ts"), { namedExports: { prisma } });
mock.module(modulePath("lib/object-store/s3.ts"), {
  namedExports: {
    uploadAudio: async (_key: string, _bytes: Uint8Array, _format: string, signal?: AbortSignal) => {
      uploads++;
      if (scenario !== "cancel-upload") return "/api/media?key=resource-verification";
      uploadStarted?.();
      assert(signal, "the real handler must forward cancellation to object storage");
      return new Promise<null>(resolve => {
        if (signal.aborted) resolve(null);
        else signal.addEventListener("abort", () => resolve(null), { once: true });
      });
    },
    deletePrefix: async () => undefined,
    deleteObject: async () => undefined,
    deleteObjects: async () => undefined,
    boardAudioPrefix: (id: string) => `boards/${id}/`,
    getObject: async () => {
      mediaReads++;
      return { body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([73, 68, 51])); controller.close(); } }), contentType: "audio/mpeg" };
    },
  },
});

const boards = load(modulePath("app/api/boards/route.ts")) as typeof import("../../app/api/boards/route");
const ownedBoard = load(modulePath("app/api/boards/[boardId]/route.ts")) as typeof import("../../app/api/boards/[boardId]/route");
const turns = load(modulePath("app/api/boards/[boardId]/turns/route.ts")) as typeof import("../../app/api/boards/[boardId]/turns/route");
const { MAX_TURN_UPLOAD_BYTES } = load(modulePath("lib/scene/turnUploadLimits.ts")) as typeof import("../../lib/scene/turnUploadLimits");
const quota = load(modulePath("lib/boards/storageQuota.ts")) as typeof import("../../lib/boards/storageQuota");
const { runObjectDeletionBatch } = load(modulePath("lib/object-store/deletionJobs.ts")) as typeof import("../../lib/object-store/deletionJobs");
const accountExport = load(modulePath("app/api/account/export/route.ts")) as typeof import("../../app/api/account/export/route");
const { serveUserObject } = load(modulePath("lib/object-store/serveMedia.ts")) as typeof import("../../lib/object-store/serveMedia");
const context = { params: Promise.resolve({ boardId }) };
const jsonRequest = (path: string, body: object, method = "POST") => new Request(`https://example.test${path}`, {
  method, headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify(body),
});
function lessonRequest(traceId: string | null = crypto.randomUUID(), signal?: AbortSignal): Request {
  const form = new FormData();
  form.set("metadata", JSON.stringify({
    question: "What is 2 + 2?", rawResponse: "2 + 2 = 4.", visualStatus: "text_only", traceId: traceId ?? undefined,
    segments: [{ orderIndex: 0, narration: "The answer is four.", spokenText: "The answer is four.", command: null }],
  }));
  // Valid mono PCM WAVE; a media-format denial must not masquerade as a quota
  // denial. Two samples keep the fixture small and fully in memory.
  const audio = new Uint8Array(48);
  const view = new DataView(audio.buffer);
  audio.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, 40, true);
  audio.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  audio.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, 4, true);
  form.set("audio-0", new Blob([audio], { type: "audio/wav" }), "lesson.wav");
  return new Request(`https://example.test/api/boards/${boardId}/turns`, {
    method: "POST", headers: { origin: "https://example.test" }, body: form, signal,
  });
}
const failures: string[] = [];
async function check(name: string, run: () => Promise<void>): Promise<void> {
  writes = 0;
  uploads = 0;
  parses = 0;
  ledgerBytes = 0n;
  pendingTurns = 0;
  createdTurns = 0;
  mediaReads = 0;
  committedTurns.clear();
  traceReceipts.clear();
  deletionJobs.clear();
  uploadStarted = null;
  scenario = "normal";
  try { await run(); console.log(`PASS: ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL: ${name}`, error); }
}
function deniedWithoutWrite(response: Response): void {
  assert(response.status >= 400 && response.status < 500, `expected client denial, got ${response.status}`);
  assert.equal(writes, 0, "denial cannot commit data");
  assert.equal(uploads, 0, "denial cannot allocate object storage");
}
async function deniedByQuota(response: Response): Promise<void> {
  deniedWithoutWrite(response);
  const body = await response.json() as { error?: string; code?: string };
  assert(/quota|limit|capacity/i.test(`${body.error ?? ""} ${body.code ?? ""}`),
    "quota test cannot pass because of an unrelated authentication, media, or parser denial");
}

async function main(): Promise<void> {
  await check("ordinary bounded board creation still succeeds", async () => {
    const response = await boards.POST(jsonRequest("/api/boards", { title: "Fractions practice" }));
    assert.equal(response.status, 200);
    assert.equal(writes, 1);
  });
  await check("ordinary bounded preview update still succeeds", async () => {
    const response = await ownedBoard.PATCH(jsonRequest(`/api/boards/${boardId}`, { preview: "What is one half plus one quarter?" }, "PATCH"), context);
    assert.equal(response.status, 200);
    assert.equal(writes, 1);
  });
  await check("ordinary audio save settles its pending count and keeps its stored byte charge", async () => {
    const response = await turns.POST(lessonRequest(), context);
    assert.equal(response.status, 200);
    assert.equal(uploads, 1);
    assert.equal(pendingTurns, 0);
    assert(ledgerBytes > 48n, "persistent audio and metadata must remain charged after save");
  });
  await check("a save and its cleanup transaction failing together preserve the pre-upload recovery intent", async () => {
    scenario = "save-and-cleanup-failure";
    await assert.rejects(turns.POST(lessonRequest(), context), /fake transient database outage/);
    assert.equal(createdTurns, 0);
    assert.equal(uploads, 1);
    assert.equal(pendingTurns, 1);
    assert.equal(deletionJobs.size, 1);
    const intent = [...deletionJobs.values()][0]!;
    assert.equal(intent.pendingTurns, 1);
    assert.equal(BigInt(String(intent.bytes)), ledgerBytes);
    assert((intent.nextAttemptAt as Date) > new Date(), "crash recovery stays scheduled without another successful DB write");
  });
  await check("canceling an in-flight upload leaves recoverable cleanup and restores capacity once", async () => {
    scenario = "cancel-upload";
    const controller = new AbortController();
    const started = new Promise<void>(resolve => { uploadStarted = resolve; });
    const saving = turns.POST(lessonRequest(undefined, controller.signal), context);
    await started;
    assert.equal(deletionJobs.size, 1, "cleanup must exist while the upload is in flight");
    assert.equal(pendingTurns, 1);
    controller.abort();
    const response = await saving;
    assert.equal(response.status, 409);
    assert.equal(createdTurns, 0);
    assert.equal(pendingTurns, 0);
    assert(ledgerBytes > 0n, "cancelled audio stays charged until confirmed deletion");
    assert.equal((await runObjectDeletionBatch({ now: new Date(Date.now() + 1000), limit: 1 })).completed, 1);
    assert.equal(ledgerBytes, 0n);
    assert.equal(pendingTurns, 0);
    assert.equal(deletionJobs.size, 0);
    assert.equal((await runObjectDeletionBatch({ limit: 1 })).completed, 0, "cancellation cleanup cannot refund twice");
  });
  await check("production saves without a server-issued lesson trace are denied before upload", async () => {
    const response = await turns.POST(lessonRequest(null), context);
    assert.equal(response.status, 403);
    deniedWithoutWrite(response);
  });
  await check("another user's trace cannot authorize persistence", async () => {
    scenario = "foreign-trace";
    const response = await turns.POST(lessonRequest(), context);
    assert.equal(response.status, 403);
    deniedWithoutWrite(response);
  });
  await check("one durable lesson save allowance returns the existing turn on replay without another upload", async () => {
    const traceId = crypto.randomUUID();
    const first = await turns.POST(lessonRequest(traceId), context);
    const bytesAfterFirst = ledgerBytes;
    const firstBody = await first.json() as { turn: { id: string } };
    const second = await turns.POST(lessonRequest(traceId), context);
    const secondBody = await second.json() as { turn: { id: string } };
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(firstBody.turn.id, secondBody.turn.id);
    assert.equal(createdTurns, 1);
    assert.equal(uploads, 1);
    assert.equal(ledgerBytes, bytesAfterFirst);
  });
  await check("parallel saves claim one trace allowance and durably queue any losing upload", async () => {
    const traceId = crypto.randomUUID();
    const responses = await Promise.all([turns.POST(lessonRequest(traceId), context), turns.POST(lessonRequest(traceId), context)]);
    assert(responses.every((response) => response.status === 200));
    const results = await Promise.all(responses.map((response) => response.json())) as Array<{ turn: { id: string } }>;
    assert.equal(results[0]!.turn.id, results[1]!.turn.id);
    assert.equal(createdTurns, 1);
    assert.equal(pendingTurns, 0);
    const stored = committedTurns.get(results[0]!.turn.id)!;
    const queuedBytes = [...deletionJobs.values()].reduce((total, job) => total + BigInt(String(job.bytes)), 0n);
    assert.equal(ledgerBytes, BigInt(String(stored.storageBytes)) + queuedBytes,
      "losing audio must remain charged until its durable cleanup is confirmed");
    if (uploads > 1) assert(queuedBytes > 0n, "losing upload must have a durable deletion receipt");
  });
  await check("a later invalid audio part cannot leave earlier uploads or refunded orphan bytes", async () => {
    const form = await lessonRequest().formData();
    const metadata = JSON.parse(String(form.get("metadata"))) as { segments: Array<{ orderIndex: number }> };
    metadata.segments.push({ ...metadata.segments[0]!, orderIndex: 1 });
    form.set("metadata", JSON.stringify(metadata));
    form.set("audio-1", new Blob(["arbitrary storage bytes"], { type: "audio/mpeg" }), "invalid.mp3");
    const response = await turns.POST(new Request(`https://example.test/api/boards/${boardId}/turns`, {
      method: "POST", body: form,
    }), context);
    assert.equal(response.status, 415);
    deniedWithoutWrite(response);
    assert.equal(ledgerBytes, 0n);
    assert.equal(pendingTurns, 0);
  });
  await check("oversized preview is rejected before persistence", async () => {
    const response = await ownedBoard.PATCH(jsonRequest(`/api/boards/${boardId}`, { preview: "x".repeat(512 * 1024) }, "PATCH"), context);
    deniedWithoutWrite(response);
  });
  await check("oversized board title is rejected before creation", async () => {
    const response = await boards.POST(jsonRequest("/api/boards", { title: "x".repeat(256 * 1024) }));
    deniedWithoutWrite(response);
  });
  await check("persistent board count cannot exceed account quota", async () => {
    scenario = "board-limit";
    const response = await boards.POST(jsonRequest("/api/boards", { title: "one board too many" }));
    await deniedByQuota(response);
  });
  await check("a board ID waiting for durable deletion cannot be reused", async () => {
    const reusedId = crypto.randomUUID();
    deletionJobs.set(`lectures/${reusedId}/`, { prefix: `lectures/${reusedId}/` });
    const response = await boards.POST(jsonRequest("/api/boards", { id: reusedId }));
    assert.equal(response.status, 409);
    deniedWithoutWrite(response);
  });
  await check("owning a recreated board ID does not expose orphan lecture objects", async () => {
    const key = `lectures/${boardId}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/0.mp3`;
    const response = await serveUserObject(userId, key);
    assert.equal(response.status, 404);
    assert.equal(mediaReads, 0, "orphan object must be denied before storage contact");
  });
  await check("media requires the turn's owner as well as the board's owner", async () => {
    const turnId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    committedTurns.set(turnId, { id: turnId, boardId, userId: "another-user" });
    const response = await serveUserObject(userId, `lectures/${boardId}/${turnId}/0.mp3`);
    assert.equal(response.status, 404);
    assert.equal(mediaReads, 0);
    committedTurns.set(turnId, { id: turnId, boardId, userId });
    const owned = await serveUserObject(userId, `lectures/${boardId}/${turnId}/0.mp3`);
    assert.equal(owned.status, 200);
    assert.equal(mediaReads, 1);
  });
  await check("persistent turn count is checked before uploading audio", async () => {
    scenario = "turn-limit";
    const response = await turns.POST(lessonRequest(), context);
    await deniedByQuota(response);
  });
  await check("persistent byte quota is checked before uploading audio", async () => {
    scenario = "storage-limit";
    const response = await turns.POST(lessonRequest(), context);
    await deniedByQuota(response);
  });
  await check("board listing has a bounded default page", async () => {
    scenario = "list";
    const get = boards.GET as (request: Request) => Promise<Response>;
    const response = await get(new Request("https://example.test/api/boards"));
    assert.equal(response.status, 200);
    const body = await response.json() as { boards: unknown[] };
    assert(body.boards.length <= 100, `one listing returned ${body.boards.length} boards`);
  });
  await check("every export data section is paginated", async () => {
    scenario = "list";
    for (const section of ["boards", "turns", "notes"]) {
      const response = await accountExport.GET(new Request(`https://example.test/api/account/export?section=${section}`));
      assert.equal(response.status, 200);
      const body = await response.json() as { items: unknown[]; nextPage: number | null };
      assert.equal(body.items.length, 25);
      assert.equal(body.nextPage, 1);
    }
  });
  await check("parallel byte reservations cannot overdraw the account quota", async () => {
    ledgerBytes = BigInt(quota.MAX_ACCOUNT_STORAGE_BYTES) - 64n;
    const results = await Promise.allSettled([quota.reserveStorageBytes(userId, 50), quota.reserveStorageBytes(userId, 50)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(ledgerBytes, BigInt(quota.MAX_ACCOUNT_STORAGE_BYTES) - 14n);
    const denied = results.find((result) => result.status === "rejected");
    assert(denied?.status === "rejected" && denied.reason instanceof quota.StorageQuotaError);
  });
  await check("parallel pending saves consume the final board turn allowance before upload", async () => {
    scenario = "near-turn-limit";
    const responses = await Promise.all([turns.POST(lessonRequest(), context), turns.POST(lessonRequest(), context)]);
    assert.equal(responses.filter((response) => response.status === 200).length, 1);
    assert.equal(responses.filter((response) => response.status === 429).length, 1);
    assert.equal(uploads, 1);
    assert.equal(pendingTurns, 0);
  });
  await check("undeclared oversized multipart is stopped before formData parsing", async () => {
    const chunk = new Uint8Array(64 * 1024);
    let remaining = MAX_TURN_UPLOAD_BYTES + 1;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (remaining <= 0) { controller.close(); return; }
        const length = Math.min(remaining, chunk.length);
        controller.enqueue(chunk.subarray(0, length));
        remaining -= length;
      },
    });
    const request = new Request(`https://example.test/api/boards/${boardId}/turns`, {
      method: "POST", headers: { "content-type": "multipart/form-data; boundary=resource-check", origin: "https://example.test" },
      body, duplex: "half",
    } as RequestInit & { duplex: "half" });
    Object.defineProperty(request, "formData", { value: async () => { parses++; throw new Error("multipart parser reached before byte admission"); } });
    const response = await turns.POST(request, context);
    assert.equal(response.status, 413, "undeclared over-limit body must be rejected by streaming byte count");
    assert.equal(parses, 0, "original multipart parser must not read an unbounded body");
    assert.equal(writes, 0);
    assert.equal(uploads, 0);
  });
  await check("custom server configures a protocol-sized WebSocket transport cap", async () => {
    // Keep startup mocks isolated from Next/server's cached dependencies.
    execFileSync(process.execPath, ["--experimental-test-module-mocks", "--import", "tsx",
      modulePath("scripts/verify/verify-resource-ws-transport.ts")], { cwd: root, stdio: "pipe" });
  });
  if (failures.length) throw new Error(`${failures.length} resource abuse regression(s) failed: ${failures.join("; ")}`);
  console.log("Resource abuse verification passed");
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => {
  globalThis.fetch = originalFetch;
  mock.restoreAll();
});
