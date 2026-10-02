import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";

async function main() {
  const input = process.env.SECURITY_TEST_DATABASE_URL;
  assert(input, "explicit disposable security database required");
  const url = new URL(input);
  assert(["localhost", "127.0.0.1"].includes(url.hostname) && /^\/heytutor_security_[a-zA-Z0-9_]+$/.test(url.pathname));
  process.env.DATABASE_URL = input;
  const load = createRequire(import.meta.url);
  const root = resolve(import.meta.dirname, "../..");
  const deleted: string[] = [];
  mock.module(resolve(root, "lib/object-store/s3.ts"), { namedExports: { deletePrefix: async (prefix: string) => { deleted.push(prefix); } } });
  const { prisma } = load(resolve(root, "lib/db/prisma.ts")) as typeof import("../../lib/db/prisma");
  const storage = load(resolve(root, "lib/boards/storageQuota.ts")) as typeof import("../../lib/boards/storageQuota");
  const { runObjectDeletionBatch } = load(resolve(root, "lib/object-store/deletionJobs.ts")) as typeof import("../../lib/object-store/deletionJobs");
  const userId = randomUUID(), boardId = randomUUID();
  await prisma.user.create({ data: { id: userId } });
  await prisma.board.create({ data: { id: boardId, userId } });
  const reserve = (bytes: number) => storage.reserveTurnStorage({ userId, boardId, bytes, turnId: randomUUID() });
  try {
    // Neither an in-memory catch nor another DB write runs: model a process
    // crash or a database outage after admission and an unsuccessful save.
    await reserve(800);
    const intent = await prisma.objectDeletionJob.findFirst({ where: { userId } });
    assert(intent, "admission must durably record cleanup before any upload");
    assert.equal(intent.pendingTurns, 1);
    assert.equal((await prisma.userStorage.findUniqueOrThrow({ where: { userId } })).pendingTurns, 1);
    const expired = new Date(Date.now() + 31 * 60_000);
    assert.equal((await runObjectDeletionBatch({ now: expired })).completed, 1);
    assert.equal(deleted.length, 1);
    let balance = await prisma.userStorage.findUniqueOrThrow({ where: { userId } });
    assert.equal(balance.reservedBytes, 0n);
    assert.equal(balance.pendingTurns, 0);
    assert.equal((await runObjectDeletionBatch({ now: expired })).completed, 0, "replay cannot refund twice");

    const kept = await reserve(500);
    await storage.withUserStorageLock(userId, tx => storage.settleTurnStorage(kept, false, tx));
    assert.equal(await prisma.objectDeletionJob.count({ where: { userId } }), 0, "successful save removes its cleanup intent atomically");
    balance = await prisma.userStorage.findUniqueOrThrow({ where: { userId } });
    assert.equal(balance.reservedBytes, 500n);
    assert.equal(balance.pendingTurns, 0);

    const abandoned = await reserve(300);
    await storage.withUserStorageLock(userId, tx => storage.abandonTurnStorage(abandoned, tx));
    await storage.withUserStorageLock(userId, tx => storage.abandonTurnStorage(abandoned, tx));
    balance = await prisma.userStorage.findUniqueOrThrow({ where: { userId } });
    assert.equal(balance.reservedBytes, 800n, "abandoned audio stays charged until deletion succeeds");
    assert.equal(balance.pendingTurns, 0);
    await runObjectDeletionBatch({ now: expired });
    assert.equal((await prisma.userStorage.findUniqueOrThrow({ where: { userId } })).reservedBytes, 500n);

    const fenced = await reserve(200);
    await prisma.objectDeletionJob.update({ where: { id: fenced.cleanupId }, data: { attempts: 1 } });
    await assert.rejects(storage.withUserStorageLock(userId, tx => storage.settleTurnStorage(fenced, false, tx)), /expired/);
    await runObjectDeletionBatch({ now: expired });
    balance = await prisma.userStorage.findUniqueOrThrow({ where: { userId } });
    assert.equal(balance.pendingTurns, 0);
    assert.equal(balance.reservedBytes, 500n, "a claimed recovery cannot race a late save or erase earlier stored bytes");
    console.log("PASS durable upload intents recover bytes and pending turns after crashes/outages; completion and replay are fenced");
  } finally {
    await prisma.objectDeletionJob.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
