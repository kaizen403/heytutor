/** Real PostgreSQL admission with latency at each awaited database call. No provider/production access. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";
import { PrismaClient } from "@prisma/client";

async function main() {
  const input = process.env.SECURITY_TEST_DATABASE_URL;
  assert(input, "explicit local disposable security database required");
  const url = new URL(input);
  assert(["localhost", "127.0.0.1"].includes(url.hostname) && /^\/heytutor_security_[a-zA-Z0-9_]+$/.test(url.pathname));
  for (const [key, value] of Object.entries(process.env)) {
    if (/API_KEY|API_TOKEN|AZURE_TOKEN|AWS_ACCESS_KEY|AWS_SECRET|AWS_SESSION_TOKEN|AI_GATEWAY/i.test(key)) assert(!value, "provider credentials must be absent");
  }
  process.env.DATABASE_URL = input;
  const prisma = new PrismaClient({ log: [] });
  const app = resolve(import.meta.dirname, "../..");
  const load = createRequire(import.meta.url);
  let delayMs = 100, receiptCalls = 0, databaseCalls = 0;
  const delayed = (target: object, label = ""): object => new Proxy(target, {
    get(object, key) {
      const value: unknown = Reflect.get(object, key);
      if (typeof value === "function") return async (...args: unknown[]) => {
        databaseCalls++;
        if ((label === "turn" || label === "boardChatMessage") && key === "update") receiptCalls++;
        if (key === "$executeRaw") {
          const sql = (args[0] as TemplateStringsArray).join("?");
          if (/UPDATE\s+(?:"?turns"?|"?board_chat_messages"?)/i.test(sql)) receiptCalls++;
        }
        await new Promise<void>(done => setTimeout(done, delayMs));
        return value.apply(object, args);
      };
      return value && typeof value === "object" ? delayed(value, String(key)) : value;
    },
  });
  const admissionDb = new Proxy(prisma, {
    get(target, key) {
      if (key === "$transaction") return (run: (tx: object) => unknown, options?: object) =>
        target.$transaction(async tx => run(delayed(tx)), options);
      return Reflect.get(delayed(target), key);
    },
  });
  mock.module(resolve(app, "lib/db/prisma.ts"), { namedExports: { prisma: admissionDb } });
  mock.module(resolve(app, "lib/object-store/s3.ts"), { namedExports: {
    headObjectSize: async () => ({ status: "missing" }), listObjectSizes: async () => [],
  } });
  globalThis.fetch = async () => { throw new Error("external network prohibited"); };
  const quota = load(resolve(app, "lib/boards/storageQuota.ts")) as typeof import("../../lib/boards/storageQuota");
  const failures: string[] = [];
  try {
    for (const count of [300, 999]) {
      const userId = randomUUID(), targetBoard = randomUUID();
      const oldTime = new Date("2026-09-01T00:00:00.000Z");
      const boards = Array.from({ length: Math.ceil(count / 100) }, () => randomUUID());
      await prisma.user.create({ data: { id: userId } });
      await prisma.board.createMany({ data: [...boards, targetBoard].map(id => ({ id, userId })) });
      await prisma.turn.createMany({ data: Array.from({ length: count }, (_, index) => ({
        id: randomUUID(), userId, boardId: boards[Math.floor(index / 100)]!, orderIndex: index % 100,
        question: "Legacy scale fixture", rawResponse: "Retained lesson", updatedAt: oldTime,
      })) });
      await prisma.boardChatMessage.createMany({ data: Array.from({ length: 120 }, () => ({
        id: randomUUID(), userId, boardId: targetBoard, role: "user", content: "Legacy note", storageBytes: 0n,
      })) });
      await prisma.objectDeletionJob.createMany({ data: [
        { id: randomUUID(), userId, prefix: `images/${userId}/held.png`, bytes: 192n, attempts: 1 },
      ] });
      await prisma.userStorage.create({ data: { userId, reservedBytes: BigInt(count) * 262144n + 192n } });
      receiptCalls = 0; databaseCalls = 0; delayMs = 100;
      const started = performance.now();
      try {
        const reservation = await quota.reserveTurnStorage({ userId, boardId: targetBoard, turnId: randomUUID(), bytes: 2048 });
        const elapsedMs = performance.now() - started;
        assert(receiptCalls <= 2, `${count}: receipt writes must be batched, got ${receiptCalls}`);
        assert(databaseCalls < 40, `${count}: awaited database calls must not grow per receipt, got ${databaseCalls}`);
        const turns = await prisma.turn.findMany({ where: { userId } });
        const notes = await prisma.boardChatMessage.findMany({ where: { userId } });
        assert.equal(turns.length, count);
        assert(turns.every(turn => turn.storageBytes > 0n && turn.metadataBytes === turn.storageBytes), "all no-audio legacy receipts are measured");
        assert(turns.every(turn => turn.updatedAt.getTime() === oldTime.getTime()), "receipt migration never revives lesson activity");
        assert(notes.every(note => note.storageBytes === 11n), "all legacy notes get exact UTF-8 receipts");
        const balance = await prisma.userStorage.findUniqueOrThrow({ where: { userId } });
        assert.equal(balance.reservedBytes, turns.reduce((sum, turn) => sum + turn.storageBytes, 0n) + 120n * 11n + 192n + 2048n);
        assert.equal(balance.pendingTurns, 1);
        assert.equal(await prisma.objectDeletionJob.count({ where: { userId } }), 2, "claimed cleanup and new upload receipt stay charged");
        assert(reservation.cleanupId);
        console.log(JSON.stringify({ count, delayMs, receiptCalls, databaseCalls, elapsedMs: Math.round(elapsedMs), admitted: true }));
      } catch (error) {
        failures.push(String(count));
        console.error(`${count} legacy receipt admission failed`, error);
      } finally {
        await prisma.objectDeletionJob.deleteMany({ where: { userId } });
        await prisma.user.delete({ where: { id: userId } });
      }
    }
    assert.deepEqual(failures, [], "large accounts must admit their first affordable save under injected DB latency");
    console.log("verify-storage-admission-scale-db: 2 real DB groups passed at 100ms/database call (300/999 legacy turns +120 notes)");
  } finally { await prisma.$disconnect(); }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
