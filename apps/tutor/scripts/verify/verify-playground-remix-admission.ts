/** Actual Community copy consumer; offline database, storage and object ports. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";
import { Prisma } from "@prisma/client";

const app = resolve(import.meta.dirname, "../..");
const load = createRequire(import.meta.url);
const sourceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sourceTurnId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let ordinary = 0, lockedOrdinary = 0, recordings = 200;
let copies = 0, cleanups = 0, creates = 0, admitted = false;
class StorageQuotaError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
type CountQuery = { where: { userId: string; playground?: { equals: unknown } } };
const count = (query: CountQuery, underLock: boolean) => {
  assert.equal(query.where.userId, "viewer");
  const normal = underLock ? lockedOrdinary : ordinary;
  return normal + (query.where.playground?.equals === Prisma.DbNull ? 0 : recordings);
};
const tx = {
  board: {
    count: async (query: CountQuery) => { assert(admitted); return count(query, true); },
    create: async ({ data }: { data: { visibility: string; playground?: unknown } }) => {
      assert(admitted); assert.equal(data.visibility, "private"); assert.equal(data.playground, undefined); creates++;
      return {};
    },
    update: async () => ({}),
  },
  turn: { count: async () => 0, create: async () => ({}) },
  segment: { createMany: async () => ({ count: 1 }) },
  objectDeletionJob: { deleteMany: async () => ({ count: 1 }) },
};
const prisma = {
  board: {
    findFirst: async () => ({ id: sourceId, userId: "author", title: "Work", preview: "Work" }),
    count: async (query: CountQuery) => count(query, false),
  },
  turn: {
    count: async () => 0,
    findMany: async () => [{
      id: sourceTurnId, status: "complete", kind: "lesson", question: "Explain work", rawResponse: "Work is force times distance.",
      speedMultiplier: 1, storageBytes: 1024n, metadataBytes: 0n, lessonMs: 60000, sceneDocument: null,
      sceneEngineVersion: null, validationReport: null, visualStatus: "text_only", sceneArtifacts: null,
      segments: [{ orderIndex: 0, narration: "Work is force times distance.", spokenText: "Work is force times distance.",
        command: null, audioUrl: `/api/media?key=lectures/${sourceId}/${sourceTurnId}/0.mp3`, audioFormat: "mp3",
        durationMs: 60000, timings: null, audioRef: 0 }],
    }],
  },
  userStorage: { findUnique: async () => ({ reservedBytes: 0n }) },
  objectDeletionJob: { create: async () => ({}), deleteMany: async () => ({ count: 1 }) },
};
globalThis.fetch = async () => { throw new Error("External network prohibited in remix admission verification"); };
mock.module(resolve(app, "lib/db/prisma.ts"), { namedExports: { prisma } });
mock.module(resolve(app, "lib/boards/storageQuota.ts"), { namedExports: {
  MAX_ACCOUNT_BOARDS: 200, MAX_ACCOUNT_STORAGE_BYTES: 1024 * 1024 * 1024, MAX_ACCOUNT_TURNS: 1000, StorageQuotaError,
  withAdmittedStorageBytes: async (userId: string, bytes: number, run: (tx: unknown) => Promise<void>) => {
    assert.equal(userId, "viewer"); assert.equal(bytes, 1024); admitted = true;
    try { await run(tx); } finally { admitted = false; }
  },
} });
mock.module(resolve(app, "lib/object-store/s3.ts"), { namedExports: {
  copyLectureObject: async () => { copies++; return true; }, deletePrefix: async () => { cleanups++; },
} });
const { remixCommunityBoard, RemixError } = load(resolve(app, "lib/community/remix.ts")) as typeof import("../../lib/community/remix");
const reset = () => { ordinary = 0; lockedOrdinary = 0; recordings = 200; copies = 0; cleanups = 0; creates = 0; admitted = false; };

async function main() {
  let failures = 0;
  const check = async (name: string, run: () => Promise<void>) => {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failures++; console.error(`FAIL ${name}`, error); }
  };
  await check("recordings do not consume Community copy slots in either check", async () => {
    reset();
    const result = await remixCommunityBoard(sourceId, "viewer");
    assert(result.boardId); assert.equal(creates, 1); assert.equal(copies, 1); assert.equal(cleanups, 0);
  });
  await check("a full ordinary account is refused before copying objects", async () => {
    reset(); ordinary = 200; lockedOrdinary = 200; recordings = 0;
    await assert.rejects(remixCommunityBoard(sourceId, "viewer"), error => error instanceof RemixError && error.status === 429);
    assert.equal(copies, 0); assert.equal(creates, 0);
  });
  await check("a concurrently filled ordinary limit still blocks the locked write and cleans copied objects", async () => {
    reset(); lockedOrdinary = 200;
    await assert.rejects(remixCommunityBoard(sourceId, "viewer"), error => error instanceof RemixError && error.status === 429);
    assert.equal(copies, 1); assert.equal(creates, 0); assert.equal(cleanups, 1);
  });
  assert.equal(failures, 0, `playground remix admission: ${failures} groups failed`);
  console.log("verify-playground-remix-admission: three actual copy consumer groups; no external services");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
