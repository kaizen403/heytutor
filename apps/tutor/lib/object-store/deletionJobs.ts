import { randomUUID } from "node:crypto";
import type { ObjectDeletionJob, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { deletePrefix } from "./s3";

const LEASE_MS = 5 * 60 * 1000;
const POLL_MS = 30_000;
const MAINTENANCE_MS = 60 * 60 * 1000;

/** Queue inside the caller's transaction when removing the owning database row. */
export async function enqueueObjectDeletion(
  input: { prefix: string; userId?: string | null; bytes?: bigint },
  tx?: Prisma.TransactionClient,
): Promise<void> {
  if (input.bytes !== undefined && input.bytes < 0n) throw new Error("invalid cleanup byte charge");
  await (tx ?? prisma).objectDeletionJob.createMany({
    data: [{ id: randomUUID(), prefix: input.prefix, userId: input.userId ?? null, bytes: input.bytes ?? 0n }],
    // A retry must preserve the original charge and any active worker lease.
    skipDuplicates: true,
  });
}

async function claimDeletion(now: Date): Promise<ObjectDeletionJob | null> {
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const jobs = await prisma.$queryRaw<ObjectDeletionJob[]>`
    WITH due AS (
      SELECT id FROM object_deletion_jobs
      WHERE next_attempt_at <= ${now}
      ORDER BY next_attempt_at, id
      LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    UPDATE object_deletion_jobs AS job
    SET attempts = job.attempts + 1, next_attempt_at = ${leaseUntil}
    FROM due WHERE job.id = due.id
    RETURNING job.id, job.prefix, job.user_id AS "userId", job.bytes,
      job.attempts, job.next_attempt_at AS "nextAttemptAt", job.created_at AS "createdAt"
  `;
  return jobs[0] ?? null;
}

async function finishDeletion(job: ObjectDeletionJob): Promise<boolean> {
  return prisma.$transaction(async tx => {
    // Match admission/deletion lock order: account first, then cleanup receipt.
    const users = job.userId
      ? await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE id = ${job.userId} FOR UPDATE`
      : [];
    await tx.$queryRaw`SELECT id FROM object_deletion_jobs WHERE id = ${job.id}::uuid FOR UPDATE`;
    const current = await tx.objectDeletionJob.findUnique({ where: { id: job.id } });
    if (!current || current.attempts !== job.attempts || current.nextAttemptAt.getTime() !== job.nextAttemptAt.getTime()) return false;
    if (users.length && job.userId && job.bytes > 0n) {
      const storage = await tx.userStorage.findUnique({ where: { userId: job.userId } });
      if (storage) {
        await tx.userStorage.update({
          where: { userId: job.userId },
          data: { reservedBytes: storage.reservedBytes > job.bytes ? storage.reservedBytes - job.bytes : 0n },
        });
      }
    }
    await tx.objectDeletionJob.delete({ where: { id: job.id } });
    return true;
  });
}

/** Fenced leases let multiple processes recover crashed workers without double refunds. */
export async function runObjectDeletionBatch(
  options: { limit?: number; now?: Date } = {},
): Promise<{ completed: number; failed: number; stale: number }> {
  const limit = Math.max(1, Math.min(16, Math.trunc(options.limit ?? 4)));
  const now = options.now ?? new Date();
  const result = { completed: 0, failed: 0, stale: 0 };
  for (let index = 0; index < limit; index++) {
    const job = await claimDeletion(now);
    if (!job) break;
    try {
      await deletePrefix(job.prefix);
      if (await finishDeletion(job)) result.completed++;
      else result.stale++;
    } catch {
      // Provider rejection, timeout, or DB failure never confirms deletion or
      // releases capacity. A crashed transaction leaves this receipt retryable.
      const backoff = Math.min(6 * 60 * 60 * 1000, 30_000 * 2 ** Math.min(job.attempts - 1, 10));
      const rescheduled = await prisma.objectDeletionJob.updateMany({
        where: { id: job.id, attempts: job.attempts, nextAttemptAt: job.nextAttemptAt },
        data: { nextAttemptAt: new Date(now.getTime() + backoff) },
      });
      if (rescheduled.count) result.failed++;
      else result.stale++;
    }
  }
  return result;
}

/** Logical expiry is enforced by readers; maintenance also removes expired data. */
export async function runExpiredRetentionCleanup(now = new Date()): Promise<void> {
  await Promise.all([
    prisma.abuseIdentity.deleteMany({ where: { expiresAt: { lte: now } } }),
    prisma.ownedTrace.deleteMany({ where: { expiresAt: { lte: now } } }),
  ]);
}

export function startObjectDeletionWorker(): () => void {
  let running = false;
  let stopped = false;
  let lastMaintenance = 0;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await runObjectDeletionBatch();
      const now = Date.now();
      if (now - lastMaintenance >= MAINTENANCE_MS) {
        await runExpiredRetentionCleanup(new Date(now));
        lastMaintenance = now;
      }
    } catch {
      console.error("[objects] cleanup worker failed; durable jobs remain queued");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, POLL_MS);
  timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
