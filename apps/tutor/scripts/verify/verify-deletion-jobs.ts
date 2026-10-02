import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";

const load = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
const now = new Date("2026-10-02T00:00:00Z");
type Job = { id: string; prefix: string; userId: string | null; bytes: bigint; attempts: number; nextAttemptAt: Date; createdAt: Date };
const jobs = new Map<string, Job>();
const users = new Set<string>();
let reservedBytes = 1000n;
let deletionCalls = 0;
let failDeletion = false;
let failEnqueue = false;
let failFinish = false;
let replaceLeaseDuringDeletion = false;
let retained = false;
let grantRevoked = false;
let ticketRevoked = false;
let maintenanceCalls = 0;
const findJob = ({ where }: { where: { id?: string; prefix?: string } }) => [...jobs.values()].find(job => where.id ? job.id === where.id : job.prefix === where.prefix) ?? null;
const matchesLease = (job: Job, where: { id?: string; attempts?: number; nextAttemptAt?: Date }) =>
  job.id === where.id && (where.attempts === undefined || job.attempts === where.attempts) &&
  (!where.nextAttemptAt || job.nextAttemptAt.getTime() === where.nextAttemptAt.getTime());
const db = {
  $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    if (/WITH\s+due/i.test(sql)) {
      assert(/FOR UPDATE SKIP LOCKED/i.test(sql), "claim must atomically lock a due row without blocking other workers");
      const dueAt = values[0] as Date;
      const leaseUntil = values[1] as Date;
      const job = [...jobs.values()].filter(job => job.nextAttemptAt <= dueAt).sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())[0];
      if (!job) return [];
      job.attempts++;
      job.nextAttemptAt = leaseUntil;
      return [{ ...job }];
    }
    if (/FROM\s+users/i.test(sql)) return users.has(String(values[0])) ? [{ id: values[0] }] : [];
    return jobs.has(String(values[0])) ? [{ id: values[0] }] : [];
  },
  user: {
    findUnique: async ({ where }: { where: { id: string } }) => users.has(where.id) ? { id: where.id, email: "fake@example.test", emailVerified: now } : null,
    delete: async ({ where }: { where: { id: string } }) => {
      assert([...jobs.values()].some(job => job.prefix === `images/${where.id}/`), "image cleanup must be queued before account cascade");
      for (const id of ["board-a", "board-b"]) assert([...jobs.values()].some(job => job.prefix === `lectures/${id}/`), "every board cleanup must precede account cascade");
      assert(retained, "free allowance retention must precede account deletion");
      users.delete(where.id);
    },
  },
  board: { findMany: async () => [{ id: "board-a" }, { id: "board-b" }] },
  userStorage: {
    findUnique: async () => ({ reservedBytes }),
    update: async ({ data }: { data: { reservedBytes: bigint } }) => { reservedBytes = data.reservedBytes; },
  },
  objectDeletionJob: {
    findUnique: async (query: Parameters<typeof findJob>[0]) => findJob(query),
    create: async ({ data }: { data: Partial<Job> & Pick<Job, "id" | "prefix"> }) => {
      if (failEnqueue) throw new Error("fake enqueue unavailable");
      const job = { userId: null, bytes: 0n, attempts: 0, nextAttemptAt: now, createdAt: now, ...data };
      jobs.set(job.id, job);
      return job;
    },
    createMany: async ({ data }: { data: Array<Partial<Job> & Pick<Job, "id" | "prefix">> }) => {
      if (failEnqueue) throw new Error("fake enqueue unavailable");
      for (const item of data) {
        if ([...jobs.values()].some(job => job.prefix === item.prefix)) continue;
        jobs.set(item.id, { userId: null, bytes: 0n, attempts: 0, nextAttemptAt: now, createdAt: now, ...item });
      }
      return { count: data.length };
    },
    upsert: async ({ where, create }: { where: { prefix: string }; create: Partial<Job> & Pick<Job, "id" | "prefix"> }) => {
      const existing = [...jobs.values()].find(job => job.prefix === where.prefix);
      if (existing) return existing;
      if (failEnqueue) throw new Error("fake enqueue unavailable");
      const job = { userId: null, bytes: 0n, attempts: 0, nextAttemptAt: now, createdAt: now, ...create };
      jobs.set(job.id, job);
      return job;
    },
    updateMany: async ({ where, data }: { where: { id?: string; attempts?: number; nextAttemptAt?: Date }; data: { nextAttemptAt: Date } }) => {
      const job = [...jobs.values()].find(job => matchesLease(job, where));
      if (!job) return { count: 0 };
      job.nextAttemptAt = data.nextAttemptAt;
      return { count: 1 };
    },
    delete: async ({ where }: { where: { id: string } }) => {
      if (failFinish) throw new Error("fake cleanup receipt failure");
      jobs.delete(where.id);
    },
  },
  abuseIdentity: { deleteMany: async ({ where }: { where: { expiresAt: { lte: Date } } }) => {
    assert.equal(where.expiresAt.lte.getTime(), now.getTime()); maintenanceCalls++; return { count: 2 };
  } },
  ownedTrace: { deleteMany: async ({ where }: { where: { expiresAt: { lte: Date } } }) => {
    assert.equal(where.expiresAt.lte.getTime(), now.getTime()); maintenanceCalls++; return { count: 3 };
  } },
};
const prisma = { ...db, $transaction: async <T>(run: (tx: typeof db) => Promise<T>) => {
  const savedJobs = new Map([...jobs.entries()].map(([id, job]) => [id, { ...job }]));
  const savedUsers = new Set(users);
  const savedBytes = reservedBytes;
  try { return await run(db); }
  catch (error) {
    jobs.clear(); for (const [id, job] of savedJobs) jobs.set(id, job);
    users.clear(); for (const id of savedUsers) users.add(id);
    reservedBytes = savedBytes;
    throw error;
  }
} };
mock.module(resolve(root, "lib/db/prisma.ts"), { namedExports: { prisma } });
mock.module(resolve(root, "lib/object-store/s3.ts"), { namedExports: { deletePrefix: async (prefix: string) => {
  deletionCalls++;
  if (failDeletion) throw new Error("fake S3 delete failure");
  if (replaceLeaseDuringDeletion) {
    const job = [...jobs.values()].find(job => job.prefix === prefix)!;
    job.attempts++;
    job.nextAttemptAt = new Date(now.getTime() + 600_000);
  }
} } });
mock.module(resolve(root, "lib/auth/abuseIdentity.ts"), { namedExports: { retainIdentityUsage: async () => { retained = true; } } });
mock.module(resolve(root, "lib/billing/grant.ts"), { namedExports: { releaseTurnGrant: () => { grantRevoked = true; } } });
mock.module(resolve(root, "lib/tts/wsTicket.ts"), { namedExports: { revokeWsTickets: () => { ticketRevoked = true; } } });
globalThis.fetch = async () => { throw new Error("No network in deletion job verification"); };
const { deleteAuthenticatedAccount } = load(resolve(root, "lib/auth/deleteAccount.ts")) as typeof import("../../lib/auth/deleteAccount");
const failures: string[] = [];
async function check(name: string, run: () => Promise<void>) {
  jobs.clear(); users.clear(); users.add("active-user"); reservedBytes = 1000n; deletionCalls = 0;
  failDeletion = false; failEnqueue = false; failFinish = false; replaceLeaseDuringDeletion = false;
  retained = false; grantRevoked = false; ticketRevoked = false;
  try { await run(); console.log(`PASS: ${name}`); } catch (error) { failures.push(name); console.error(`FAIL: ${name}`, error); }
}
function seed(bytes = 200n, userId: string | null = "active-user") {
  const job: Job = { id: crypto.randomUUID(), prefix: "lectures/job-board/", userId, bytes, attempts: 0, nextAttemptAt: now, createdAt: now };
  jobs.set(job.id, job);
  return job;
}
async function main() {
  await check("account deletion preserves retention and atomically enqueues every private object scope", async () => {
    await deleteAuthenticatedAccount("active-user");
    assert(!users.has("active-user"));
    assert.equal(jobs.size, 3);
    assert(grantRevoked && ticketRevoked);
    assert.equal(deletionCalls, 0, "deletion must not rely on a detached best-effort provider call");
  });
  await check("failed cleanup enqueue rolls back account deletion", async () => {
    failEnqueue = true;
    await assert.rejects(() => deleteAuthenticatedAccount("active-user"));
    assert(users.has("active-user"));
    assert.equal(jobs.size, 0);
  });
  let worker: typeof import("../../lib/object-store/deletionJobs");
  try { worker = load(resolve(root, "lib/object-store/deletionJobs.ts")); }
  catch (error) { failures.push("durable cleanup worker exists"); console.error("FAIL: durable cleanup worker exists", error); throw new Error(failures.join("; ")); }
  await check("repeated enqueue preserves the original byte charge and active lease", async () => {
    const job = seed();
    job.attempts = 1;
    job.nextAttemptAt = new Date(now.getTime() + 300_000);
    await Promise.all([
      worker.enqueueObjectDeletion({ prefix: job.prefix, userId: job.userId, bytes: 999n }),
      worker.enqueueObjectDeletion({ prefix: job.prefix, userId: job.userId, bytes: 999n }),
    ]);
    assert.equal(jobs.size, 1);
    assert.equal(jobs.get(job.id)!.bytes, 200n);
    assert.equal(jobs.get(job.id)!.attempts, 1);
    assert.equal(jobs.get(job.id)!.nextAttemptAt.getTime(), now.getTime() + 300_000);
  });
  await check("failed storage deletion retains charge and retries with backoff", async () => {
    const job = seed();
    failDeletion = true;
    const failed = await worker.runObjectDeletionBatch({ limit: 1, now });
    assert.equal(failed.failed, 1);
    assert.equal(reservedBytes, 1000n);
    assert(jobs.get(job.id)!.nextAttemptAt > now);
    failDeletion = false;
    const completed = await worker.runObjectDeletionBatch({ limit: 1, now: new Date(now.getTime() + 60_000) });
    assert.equal(completed.completed, 1);
    assert.equal(reservedBytes, 800n);
    assert.equal(jobs.size, 0);
  });
  await check("simultaneous workers lease a cleanup once and refund once", async () => {
    seed();
    const results = await Promise.all([worker.runObjectDeletionBatch({ limit: 1, now }), worker.runObjectDeletionBatch({ limit: 1, now })]);
    assert.equal(results.reduce((count, result) => count + result.completed, 0), 1);
    assert.equal(deletionCalls, 1);
    assert.equal(reservedBytes, 800n);
  });
  await check("a stale worker cannot refund or remove a newer cleanup lease", async () => {
    seed();
    replaceLeaseDuringDeletion = true;
    const result = await worker.runObjectDeletionBatch({ limit: 1, now });
    assert.equal(result.stale, 1);
    assert.equal(reservedBytes, 1000n);
    assert.equal(jobs.size, 1);
  });
  await check("a crashed worker's expired lease is recovered", async () => {
    const job = seed();
    job.attempts = 1;
    job.nextAttemptAt = new Date(now.getTime() - 1);
    const result = await worker.runObjectDeletionBatch({ limit: 1, now });
    assert.equal(result.completed, 1);
    assert.equal(deletionCalls, 1);
    assert.equal(reservedBytes, 800n);
  });
  await check("failed database confirmation rolls back the refund and leaves a retry receipt", async () => {
    const job = seed();
    failFinish = true;
    const result = await worker.runObjectDeletionBatch({ limit: 1, now });
    assert.equal(result.failed, 1);
    assert.equal(reservedBytes, 1000n);
    assert.equal(jobs.size, 1);
    assert(jobs.get(job.id)!.nextAttemptAt > now);
  });
  await check("cleanup survives deletion of its former account", async () => {
    seed(200n, "already-deleted-user");
    const result = await worker.runObjectDeletionBatch({ limit: 1, now });
    assert.equal(result.completed, 1);
    assert.equal(reservedBytes, 1000n);
    assert.equal(jobs.size, 0);
  });
  await check("expired identity and trace retention is physically cleaned", async () => {
    maintenanceCalls = 0;
    await worker.runExpiredRetentionCleanup(now);
    assert.equal(maintenanceCalls, 2);
  });
  if (failures.length) throw new Error(`${failures.length} deletion checks failed: ${failures.join("; ")}`);
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
