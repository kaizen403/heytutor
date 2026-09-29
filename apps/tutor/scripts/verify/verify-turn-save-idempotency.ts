import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = resolve(__dirname, "../..");
// The in-memory Prisma stub intentionally accepts arbitrary query and row shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const turns: Row[] = [];
const segments: Row[] = [];
const boards = [
  { id: "board-a", userId: "alice" },
  { id: "board-b", userId: "alice" },
  { id: "board-c", userId: "bob" },
];
let userId = "alice";
let uploads = 0;
const uploadedAudio: number[][] = [];
let transactionTail = Promise.resolve();

const findTurn = ({ where }: Row) => {
  const found = turns.find((turn) => Object.entries(where).every(([key, value]) => turn[key] === value));
  return found ? { ...found, segments: segments.filter((segment) => segment.turnId === found.id) } : null;
};
const prisma = {
  board: { findFirst: async ({ where }: Row) => boards.find((board) => board.id === where.id && board.userId === where.userId) ?? null },
  turn: { findFirst: async (query: Row) => findTurn(query) },
  $transaction: async (callback: (tx: Row) => Promise<Row>) => {
    // Emulate the board FOR UPDATE lock: queries and writes in a transaction cannot interleave.
    const previous = transactionTail;
    let release!: () => void;
    transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const tx = {
        $queryRaw: async () => [],
        turn: {
          findFirst: async ({ where }: Row) => {
            const found = turns.find((turn) => Object.entries(where).every(([key, value]) => turn[key] === value));
            return found ? { ...found, segments: segments.filter((segment) => segment.turnId === found.id) } : null;
          },
          count: async ({ where }: Row) => turns.filter((turn) => turn.boardId === where.boardId).length,
          create: async ({ data }: Row) => {
            if (turns.some((turn) => turn.boardId === data.boardId && turn.orderIndex === data.orderIndex)) throw new Error("duplicate order index");
            if (data.idempotencyKey && turns.some((turn) => turn.boardId === data.boardId && turn.userId === data.userId && turn.idempotencyKey === data.idempotencyKey)) throw new Error("duplicate idempotency key");
            const turn = { ...data, createdAt: new Date() };
            turns.push(turn);
            return turn;
          },
        },
        segment: { createManyAndReturn: async ({ data }: Row) => {
          const inserted = data.map((segment: Row) => ({ ...segment, id: crypto.randomUUID() }));
          segments.push(...inserted);
          return inserted;
        } },
        board: { update: async () => ({}) },
      };
      return await callback(tx);
    } finally { release(); }
  },
};

function load(relativePath: string, dependencies: Record<string, unknown>): Row {
  const code = ts.transpileModule(readFileSync(resolve(root, relativePath), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Row = {};
  const compiledModule = { exports };
  vm.runInNewContext(code, {
    module: compiledModule, exports, require: (name: string) => {
      if (!(name in dependencies)) throw new Error(`Missing stub: ${name}`);
      return dependencies[name];
    },
    FormData, Blob, File, Request, Response, Headers, Uint8Array, crypto,
    console, setTimeout, fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
  }, { filename: relativePath });
  return compiledModule.exports;
}

const { POST } = load("app/api/boards/[boardId]/turns/route.ts", {
  "@prisma/client": { Prisma: { DbNull: null, PrismaClientKnownRequestError: class extends Error {} } },
  "next/server": { NextResponse: { json: (body: unknown, options?: ResponseInit) => Response.json(body, options) } },
  "@/lib/auth": { getUserId: async () => userId, ensureUser: async () => {} },
  "@/lib/db/prisma": { prisma },
  "@/lib/object-store/keys": { lectureAudioKey: () => "key" },
  "@/lib/object-store/s3": { uploadAudio: async (_key: string, bytes: Uint8Array) => {
    uploads++;
    uploadedAudio.push(Array.from(bytes));
    return "https://example.test/audio";
  } },
  "@/lib/scene/turnPersistencePolicy": { isTurnMetadataPersistable: () => true },
  "@/lib/scene/turnScenePersistence": { canonicalizeTurnSceneMetadata: async (metadata: Row) => ({
    ok: true,
    value: metadata.rawResponse === "remap"
      ? { segments: metadata.segments.map((segment: Row) => ({
        ...segment, sourceOrderIndex: segment.orderIndex, orderIndex: 0,
      })) }
      : {},
  }) },
  "@/lib/scene/turnUploadLimits": { validateTurnUploadHeaders: () => ({ ok: true }), validateTurnUploadParts: () => ({ ok: true }) },
});
const { saveTurn } = load("lib/boards/boardsClient.ts", {
  "@heytutor/tutor-core": { speechAudioMimeType: () => "audio/mpeg", resolveApiUrl: (url: string) => `https://example.test${url}` },
  "@/lib/boards/boardTitle": { finalizeBoardTitle: () => "title" },
});

async function main() {
  const fetchOriginal = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    requests++;
    const response = await POST(new Request(input, init), { params: Promise.resolve({ boardId: "board-a" }) });
    if (requests === 1) throw new TypeError("response lost after commit");
    return response;
  };
  try {
    const saved = await saveTurn("board-a", {
      question: "Lecture", rawResponse: "answer", speedMultiplier: 1,
      segments: [{ orderIndex: 0, narration: "hi", spokenText: "hi", command: null,
        audioBytes: new Uint8Array([1, 2, 3]), durationMs: 100, timings: null }],
    });
    assert.equal(requests, 2, "lost response triggers a retry");
    assert.equal(turns.length, 1, "lost response followed by retry cannot insert a duplicate turn");
    assert.equal(segments.length, 1, "retry cannot insert duplicate segments");
    assert.equal(uploads, 1, "retry should not upload audio again");
    assert.equal(saved?.id, turns[0]?.id, "retry returns the original persisted turn");
    assert.equal(saved?.segments[0]?.id, segments[0]?.id, "retry returns the persisted segment, not a rebuilt copy");
    assert.equal(saved?.segments[0]?.audioUrl, "https://example.test/audio", "retry retains its stored audio URL");
    assert.match(turns[0]?.idempotencyKey, /^[0-9a-f-]{36}$/, "save sends a stable UUID idempotency key");

    requests = 0;
    globalThis.fetch = async (input, init) => {
      requests++;
      const response = await POST(new Request(input, init), { params: Promise.resolve({ boardId: "board-a" }) });
      if (requests === 1) return Response.json({ error: "response unavailable" }, { status: 503 });
      return response;
    };
    const beforeServerError = turns.length;
    const recovered = await saveTurn("board-a", {
      question: "Another lecture", rawResponse: "answer", speedMultiplier: 1, segments: [],
    });
    assert.equal(requests, 2, "a 5xx response is retried");
    assert.equal(turns.length, beforeServerError + 1, "5xx after commit cannot duplicate the turn");
    assert.equal(recovered?.id, turns.at(-1)?.id, "5xx replay returns the committed turn");

    const post = (boardId: string, key?: string) => {
      const form = new FormData();
      form.append("metadata", JSON.stringify({ question: "Q", rawResponse: "A", segments: [] }));
      return POST(new Request(`https://example.test/api/boards/${boardId}/turns`, {
        method: "POST", headers: key !== undefined ? { "Idempotency-Key": key } : undefined, body: form,
      }), { params: Promise.resolve({ boardId }) });
    };
    const concurrentKey = crypto.randomUUID();
    const beforeConcurrent = turns.length;
    const [first, second] = await Promise.all([post("board-a", concurrentKey), post("board-a", concurrentKey)]);
    const firstResult = await first.json();
    const secondResult = await second.json();
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(turns.length, beforeConcurrent + 1, "concurrent requests for one key commit one turn");
    assert.equal(firstResult.turn.id, secondResult.turn.id, "both concurrent callers receive the same turn");
    assert.equal(turns.at(-1)?.orderIndex, beforeConcurrent, "concurrent retry retains the original order index");

    userId = "bob";
    const forbidden = await post("board-a", concurrentKey);
    assert.equal(forbidden.status, 404, "a different user cannot retrieve another user's keyed turn");
    userId = "alice";
    const onOtherBoard = await post("board-b", concurrentKey);
    assert.equal(onOtherBoard.status, 200, "the key is scoped to the board");
    assert.notEqual((await onOtherBoard.json()).turn.id, firstResult.turn.id);

    const [legacyFirst, legacySecond] = [await post("board-a"), await post("board-a")];
    assert.notEqual((await legacyFirst.json()).turn.id, (await legacySecond.json()).turn.id,
      "unkeyed student saves retain their prior create-new-turn behavior");
    const invalid = await post("board-a", "not-a-uuid");
    assert.equal(invalid.status, 400, "a malformed key is rejected");
    const empty = await post("board-a", "");
    assert.equal(empty.status, 400, "an empty supplied key is rejected rather than inserted as a UUID");
    const remapped = new FormData();
    remapped.append("metadata", JSON.stringify({ question: "Q", rawResponse: "remap", segments: [
      { orderIndex: 7, narration: "spoken", spokenText: "spoken", command: null },
    ] }));
    remapped.append("audio-7", new Blob([new Uint8Array([7, 8, 9])], { type: "audio/mpeg" }));
    const remapResponse = await POST(new Request("https://example.test/api/boards/board-a/turns", {
      method: "POST", body: remapped,
    }), { params: Promise.resolve({ boardId: "board-a" }) });
    assert.equal(remapResponse.status, 200);
    assert.equal((await remapResponse.json()).turn.segments[0].orderIndex, 0,
      "canonicalization may reindex the stored segment");
    assert.deepEqual(uploadedAudio.at(-1), [7, 8, 9],
      "audio lookup must use sourceOrderIndex, not the reindexed segment's orderIndex");
    const migration = readFileSync(resolve(root, "prisma/migrations/19_turn_save_idempotency/migration.sql"), "utf8");
    assert.match(migration, /ADD COLUMN "idempotency_key" UUID\s*;/,
      "legacy turns must keep a nullable key");
    assert.match(migration, /CREATE UNIQUE INDEX "turns_board_id_user_id_idempotency_key_key"\s+ON "turns"\("board_id", "user_id", "idempotency_key"\)/,
      "concurrent duplicates need a database-enforced board/user/key constraint");
    console.log("turn save idempotency and data-integrity verification passed");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
