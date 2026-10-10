/** Real cleanup worker + real S3 deletion boundary; only SQL/AWS ports are faked. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { checkpointAttemptPrefix, checkpointAudioKey } from "../../lib/object-store/keys";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const NOW = new Date("2026-10-10T00:00:00Z");
const PREFIX = checkpointAttemptPrefix("board-one", "turn-one", "abc123def456");
const FAILED_CLIP = checkpointAudioKey("board-one", "turn-one", "abc123def456", 2);
const FAILED_WAV = checkpointAudioKey("board-one", "turn-one", "abc123def456", 3, "audio/wav");
const PRIOR_CLIP = "lectures/board-one/turn-one/0.mp3";
const RETRY_CLIP = checkpointAudioKey("board-one", "turn-one", "xyz123xyz456", 2);
const OTHER_TURN = "lectures/board-one/turn-two/0.mp3";

function load(file: string, overrides: Record<string, unknown>) {
  const filename = path.join(app, file);
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} as Record<string, unknown> };
  const localRequire = (specifier: string) => overrides[specifier] ?? requireApp(
    specifier.startsWith(".") ? path.resolve(path.dirname(filename), specifier) : specifier);
  new Function("require", "module", "exports", compiled)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}

interface Job {
  id: string; prefix: string; userId: string | null; bytes: bigint; pendingTurns: number;
  attempts: number; nextAttemptAt: Date; createdAt: Date;
}
type Where = Pick<Job, "id" | "attempts" | "nextAttemptAt">;

function fixture(keys: readonly string[] = [FAILED_CLIP, FAILED_WAV, PRIOR_CLIP, RETRY_CLIP, OTHER_TURN]) {
  const objects = new Set(keys);
  const jobs = new Map<string, Job>();
  const requests: Array<{ operation: "list" | "delete"; prefix?: string; keys?: string[] }> = [];
  let reservedBytes = 600n;
  let refunds = 0;
  let rejectDelete = false;
  let escapedKey: string | null = null;
  let onDelete: (() => void) | null = null;
  const listed = new Map<string, string[]>();
  class AwsCommand { constructor(readonly input: Record<string, unknown>) {} }
  class ListObjectsV2Command extends AwsCommand {}
  class DeleteObjectsCommand extends AwsCommand {}
  class S3Client {
    async send(command: AwsCommand) {
      if (command instanceof ListObjectsV2Command) {
        const prefix = String(command.input.Prefix);
        requests.push({ operation: "list", prefix });
        if (escapedKey) return { Contents: [{ Key: escapedKey }] };
        const start = command.input.ContinuationToken === "page-two" ? 1 : 0;
        if (!start) listed.set(prefix, [...objects].filter((key) => key.startsWith(prefix)).sort());
        const matches = listed.get(prefix) ?? [];
        return { Contents: matches.slice(start, start + 1).map((Key) => ({ Key })),
          IsTruncated: start === 0 && matches.length > 1,
          ...(start === 0 && matches.length > 1 ? { NextContinuationToken: "page-two" } : {}) };
      }
      assert(command instanceof DeleteObjectsCommand, "no network operation other than List/Delete is allowed");
      const deletion = command.input.Delete as { Objects: Array<{ Key: string }> };
      requests.push({ operation: "delete", keys: deletion.Objects.map(({ Key }) => Key) });
      if (rejectDelete) return { Errors: [{ Code: "AccessDenied" }] };
      for (const { Key } of deletion.Objects) objects.delete(Key);
      onDelete?.(); onDelete = null;
      return {};
    }
  }
  const s3 = load("lib/object-store/s3.ts", {
    "@aws-sdk/client-s3": { S3Client, ListObjectsV2Command, DeleteObjectsCommand,
      GetObjectCommand: AwsCommand, PutObjectCommand: AwsCommand },
    "./config": { getObjectStoreConfig: () => ({ bucket: "fixture-only", region: "fixture-only", publicBaseUrl: null }) },
  }) as typeof import("../../lib/object-store/s3");
  const matches = (job: Job, where: Where) => job.id === where.id && job.attempts === where.attempts &&
    job.nextAttemptAt.getTime() === where.nextAttemptAt.getTime();
  const prisma = {
    objectDeletionJob: {
      createMany: async ({ data }: { data: Array<{ id: string; prefix: string; userId: string | null; bytes: bigint }> }) => {
        for (const input of data) if (![...jobs.values()].some((job) => job.prefix === input.prefix)) {
          jobs.set(input.id, { ...input, pendingTurns: 0, attempts: 0, nextAttemptAt: NOW, createdAt: NOW });
        }
      },
      findUnique: async ({ where }: { where: { id: string } }) => jobs.get(where.id) ?? null,
      delete: async ({ where }: { where: { id: string } }) => { assert(jobs.delete(where.id)); },
      updateMany: async ({ where, data }: { where: Where; data: { nextAttemptAt: Date } }) => {
        const job = jobs.get(where.id); if (!job || !matches(job, where)) return { count: 0 };
        job.nextAttemptAt = data.nextAttemptAt; return { count: 1 };
      },
    },
    userStorage: {
      findUnique: async () => ({ reservedBytes, pendingTurns: 0 }),
      update: async ({ data }: { data: { reservedBytes: bigint } }) => { reservedBytes = data.reservedBytes; refunds++; },
    },
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      if (sql.join("").includes("WITH due AS")) {
        const [now, leaseUntil] = values as [Date, Date];
        const job = [...jobs.values()].find((held) => held.nextAttemptAt <= now);
        if (!job) return [];
        job.attempts++; job.nextAttemptAt = leaseUntil;
        return [{ ...job }];
      }
      if (sql.join("").includes("FROM users")) return [{ id: "fixture-user" }];
      assert(sql.join("").includes("FROM object_deletion_jobs"), "only cleanup claim/account/receipt SQL is allowed");
      return [];
    },
    $transaction: async <T,>(body: (tx: unknown) => Promise<T>): Promise<T> => body(prisma),
  };
  const worker = load("lib/object-store/deletionJobs.ts", { "../db/prisma": { prisma }, "./s3": s3 }) as typeof import("../../lib/object-store/deletionJobs");
  return { s3, worker, objects, jobs, requests,
    balance: () => reservedBytes, refunds: () => refunds,
    reject: (value: boolean) => { rejectDelete = value; }, escape: (value: string) => { escapedKey = value; },
    afterDelete: (callback: () => void) => { onDelete = callback; },
    queue: (prefix = PREFIX) => worker.enqueueObjectDeletion({ prefix, userId: "fixture-user", bytes: 100n }),
  };
}

async function main() {
  {
    const f = fixture(); await f.queue();
    const result = await f.worker.runObjectDeletionBatch({ now: NOW, limit: 1 });
    console.log(JSON.stringify({ boundary: "failed-upload cleanup", result, reservedBytes: String(f.balance()),
      queuedReceipts: f.jobs.size, failedClipRetained: f.objects.has(FAILED_CLIP), storageRequests: f.requests.length }));
    assert.equal(result.completed, 1, "failed checkpoint attempt must pass the real deletePrefix boundary and settle its cleanup receipt");
    assert.equal(result.failed, 0); assert.equal(f.jobs.size, 0);
    assert(!f.objects.has(FAILED_CLIP) && !f.objects.has(FAILED_WAV), "MP3 and WAV files from this attempt are deleted across list pages");
    for (const key of [PRIOR_CLIP, RETRY_CLIP, OTHER_TURN]) assert(f.objects.has(key), `unrelated clip survives: ${key}`);
    assert.equal(f.balance(), 500n, "only the abandoned attempt's reserved bytes are refunded");
    assert.equal(f.refunds(), 1);
    assert.deepEqual(await f.worker.runObjectDeletionBatch({ now: NOW, limit: 1 }), { completed: 0, failed: 0, stale: 0 });
    assert.equal(f.refunds(), 1, "repeating the worker cannot double-refund");
    assert(f.requests.filter((request) => request.operation === "list").every((request) => request.prefix === PREFIX));
  }
  {
    const f = fixture(); await f.queue(); f.reject(true);
    assert.deepEqual(await f.worker.runObjectDeletionBatch({ now: NOW, limit: 1 }), { completed: 0, failed: 1, stale: 0 });
    assert.equal(f.balance(), 600n); assert.equal(f.refunds(), 0); assert.equal(f.jobs.size, 1);
    assert(f.objects.has(FAILED_CLIP));
    f.reject(false);
    assert.equal((await f.worker.runObjectDeletionBatch({ now: new Date(NOW.getTime() + 30_001), limit: 1 })).completed, 1);
    assert.equal(f.balance(), 500n); assert.equal(f.refunds(), 1);
  }
  {
    const f = fixture(); await f.queue();
    f.afterDelete(() => { const job = [...f.jobs.values()][0]!; job.attempts++; job.nextAttemptAt = new Date(NOW.getTime() + 300_001); });
    assert.deepEqual(await f.worker.runObjectDeletionBatch({ now: NOW, limit: 1 }), { completed: 0, failed: 0, stale: 1 });
    assert.equal(f.balance(), 600n); assert.equal(f.refunds(), 0, "a superseded lease never refunds");
    assert.equal((await f.worker.runObjectDeletionBatch({ now: new Date(NOW.getTime() + 300_002), limit: 1 })).completed, 1);
    assert.equal(f.balance(), 500n); assert.equal(f.refunds(), 1);
  }
  // The pre-existing board/turn/image deletion authorities remain intact.
  for (const prefix of ["lectures/board-one/", "lectures/board-one/turn-one/", "images/user-one/", "images/user-one/image-one.png"]) {
    const files = ["lectures/board-one/turn-one/0.mp3", "images/user-one/image-one.png", "lectures/other-board/turn-one/0.mp3", "images/other-user/image-one.png"];
    const f = fixture(files); await f.s3.deletePrefix(prefix);
    const expected = files.filter((key) => prefix.endsWith("/") ? !key.startsWith(prefix) : key !== prefix);
    assert.deepEqual([...f.objects], expected, `legacy bounded authority preserved: ${prefix}`);
  }
  for (const prefix of ["lectures/", "images/", "lectures/board-one/turn-one/abc123def45/", "lectures/board-one/turn-one/abc123def4567/",
    "lectures/board-one/turn-one/ABC123def456/", "lectures/board-one/turn-one/abc123def45./", "lectures/board-one/turn-one/abc123def456/nested/",
    "lectures/board-one/turn-one/abc123def456", "lectures/board-one/turn-one/0.mp3", "lectures/../turn-one/abc123def456/",
    "lectures//turn-one/abc123def456/", "/lectures/board-one/turn-one/abc123def456/", "lectures/board-one/turn-one/abc123def456/../",
    "lectures/board-one/turn-one/%61bc123def456/", "lectures/board-one\\other/turn-one/abc123def456/", "images/user-one/image-one.html"]) {
    const f = fixture(); await assert.rejects(f.s3.deletePrefix(prefix), /invalid object deletion prefix/, prefix);
    assert.equal(f.requests.length, 0, "invalid authority never reaches storage");
  }
  {
    const f = fixture(); await f.queue(); f.escape(PRIOR_CLIP);
    assert.deepEqual(await f.worker.runObjectDeletionBatch({ now: NOW, limit: 1 }), { completed: 0, failed: 1, stale: 0 });
    assert.equal(f.balance(), 600n); assert.equal(f.refunds(), 0);
    assert(f.objects.has(PRIOR_CLIP)); assert(!f.requests.some((request) => request.operation === "delete"));
  }
  console.log("verify-object-cleanup-attempt: actual worker/S3 boundary deletes only bounded attempt, refunds once after success, retains retry/lease fences and legacy/invalid-prefix controls");
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
