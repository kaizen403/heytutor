import type { Prisma, Turn, Segment, BoardChatMessage, ObjectDeletionJob } from "@prisma/client";
import { createHash } from "node:crypto";
import { parseStoredObjectKey, isSafeObjectDeletionPrefix } from "@/lib/object-store/keys";
import { mediaKeyFromUrl } from "@/lib/object-store/mediaUrl";
import { headObjectSize, listObjectSizes } from "@/lib/object-store/s3";

type StoredTurn = Turn & { segments: Segment[] };
export interface StorageAccountingSnapshot {
  userId: string;
  storage: { reservedBytes: bigint; pendingTurns: number } | null;
  turns: StoredTurn[];
  notes: BoardChatMessage[];
  jobs: ObjectDeletionJob[];
  boards: Array<{ id: string }>;
}
export interface StorageAccountingPlan {
  beforeBytes: bigint;
  afterBytes: bigint;
  releasedBytes: bigint;
  turnUpdates: Array<{ id: string; storageBytes: bigint; metadataBytes: bigint }>;
  noteUpdates: Array<{ id: string; storageBytes: bigint }>;
  expiredEmptyJobs: string[];
  pendingTurnsAfter: number;
  measuredAudioBytes: bigint;
  orphanAudioBytes: bigint;
  orphanObjects: number;
  legacyTurns: number;
  missingObjects: number;
  unresolvedReferences: number;
}
export class StorageVerificationError extends Error {
  readonly status = 503;
  readonly code = "storage_verification_failed";
  constructor() {
    super("We could not verify your saved storage. Your lesson has not been saved. Please try saving again.");
    this.name = "StorageVerificationError";
  }
}

/** Logical UTF-8 bytes of retained lesson fields; excludes database/index overhead. */
export function turnMetadataStorageBytes(turn: Record<string, unknown>): number {
  const segments = Array.isArray(turn.segments) ? turn.segments : [];
  const value = {
    question: turn.question ?? "", rawResponse: turn.rawResponse ?? "", speedMultiplier: turn.speedMultiplier ?? 1,
    sceneDocument: turn.sceneDocument ?? null, sceneEngineVersion: turn.sceneEngineVersion ?? null,
    validationReport: turn.validationReport ?? null, visualStatus: turn.visualStatus ?? null,
    sceneArtifacts: turn.sceneArtifacts ?? null, status: turn.status ?? "complete", kind: turn.kind ?? "lesson",
    submittedSegments: turn.submittedSegments ?? null, resumeState: turn.resumeState ?? null,
    segments: segments.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        orderIndex: row.orderIndex, narration: row.narration ?? "", spokenText: row.spokenText ?? "",
        command: row.command ?? null, audioUrl: row.audioUrl ?? null, audioFormat: row.audioFormat ?? "audio/mpeg",
        audioRef: row.audioRef ?? null, durationMs: row.durationMs ?? null, timings: row.timings ?? null,
      };
    }),
  };
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export async function readStorageAccountingSnapshot(tx: Prisma.TransactionClient, userId: string): Promise<StorageAccountingSnapshot> {
  const [storage, turns, notes, jobs, boards] = await Promise.all([
    tx.userStorage.findUnique({ where: { userId }, select: { reservedBytes: true, pendingTurns: true } }),
    tx.turn.findMany({ where: { userId }, include: { segments: { orderBy: { orderIndex: "asc" } } }, orderBy: { id: "asc" } }),
    tx.boardChatMessage.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    tx.objectDeletionJob.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    tx.board.findMany({ where: { userId }, select: { id: true }, orderBy: { id: "asc" } }),
  ]);
  return { userId, storage, turns, notes, jobs, boards };
}

export function storageAccountingFingerprint(snapshot: StorageAccountingSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value)).digest("hex");
}

/** This is a migration baseline only, never a new admission or deletion charge. */
function priorTurnCharge(turn: StoredTurn): bigint {
  if (turn.storageBytes > 0n) return turn.storageBytes;
  return 262144n + BigInt(turn.segments.filter(segment => segment.audioUrl !== null).length) * 8388608n;
}

function retainedAudioUrls(turn: StoredTurn): string[] {
  const submitted = turn.submittedSegments;
  const held = Array.isArray(submitted) ? submitted : submitted && typeof submitted === "object" &&
    "rows" in submitted && Array.isArray(submitted.rows) ? submitted.rows : [];
  return [...turn.segments, ...held].flatMap(row => typeof row === "object" && row !== null &&
    "audioUrl" in row && typeof row.audioUrl === "string" && row.audioUrl ? [row.audioUrl] : []);
}

export async function measureStorageAccounting(snapshot: StorageAccountingSnapshot, options: { signal?: AbortSignal } = {}): Promise<StorageAccountingPlan> {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000), ...(options.signal ? [options.signal] : [])]);
  try {
    const objects = new Map<string, { turnId: string; bytes: bigint }>();
    const references = new Map<string, string>();
    const missing = new Set<string>();
    const ownedBoards = new Set(snapshot.boards.map(board => board.id));
    for (const turn of snapshot.turns) {
      for (const url of retainedAudioUrls(turn)) {
        const key = mediaKeyFromUrl(url);
        const ref = key ? parseStoredObjectKey(key) : null;
        if (!key || ref?.kind !== "lecture" || ref.boardId !== turn.boardId || ref.turnId !== turn.id ||
          !ownedBoards.has(turn.boardId) || turn.userId !== snapshot.userId) throw new StorageVerificationError();
        references.set(key, turn.id);
      }
    }
    // Limit provider concurrency and total references; a failed read never means zero.
    if (references.size > 256_000) throw new StorageVerificationError();
    const isReservedObject = (key: string) => snapshot.jobs.some(job => key.startsWith(job.prefix));
    // Canonicalization can discard a voiced row while its clip remains stored.
    // Inventory the entire owned turn, including those unreferenced clips;
    // active attempt folders remain charged by their durable reservation only.
    let nextTurn = 0;
    await Promise.all(Array.from({ length: Math.min(8, snapshot.turns.length) }, async () => {
      while (nextTurn < snapshot.turns.length) {
        signal.throwIfAborted();
        const turn = snapshot.turns[nextTurn++];
        const prefix = `lectures/${turn.boardId}/${turn.id}/`;
        if (!ownedBoards.has(turn.boardId) || turn.userId !== snapshot.userId || !isSafeObjectDeletionPrefix(prefix)) throw new StorageVerificationError();
        for (const object of await listObjectSizes(prefix, signal)) {
          const ref = parseStoredObjectKey(object.key);
          if (ref?.kind !== "lecture" || ref.boardId !== turn.boardId || ref.turnId !== turn.id ||
            !Number.isSafeInteger(object.bytes) || object.bytes < 0) throw new StorageVerificationError();
          if (!isReservedObject(object.key)) objects.set(object.key, { turnId: turn.id, bytes: BigInt(object.bytes) });
        }
      }
    }));
    const queue = [...references].filter(([key]) => !objects.has(key) && !isReservedObject(key));
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, queue.length) }, async () => {
      while (next < queue.length) {
        signal.throwIfAborted();
        const [key, turnId] = queue[next++];
        const size = await headObjectSize(key, signal);
        if (size.status === "missing") missing.add(key);
        else {
          if (!Number.isSafeInteger(size.bytes) || size.bytes < 0) throw new StorageVerificationError();
          objects.set(key, { turnId, bytes: BigInt(size.bytes) });
        }
      }
    }));
    const audioTotals = new Map<string, bigint>();
    for (const object of objects.values()) audioTotals.set(object.turnId, (audioTotals.get(object.turnId) ?? 0n) + object.bytes);
    const measuredTurns = snapshot.turns.map(turn => {
      const metadataBytes = BigInt(turnMetadataStorageBytes(turn as unknown as Record<string, unknown>));
      const audioBytes = audioTotals.get(turn.id) ?? 0n;
      return { id: turn.id, metadataBytes, storageBytes: metadataBytes + audioBytes };
    });
    const turnUpdates = measuredTurns.filter((turn, index) => turn.storageBytes !== snapshot.turns[index].storageBytes ||
      turn.metadataBytes !== snapshot.turns[index].metadataBytes);
    const expiredEmptyJobs: string[] = [];
    const now = Date.now();
    for (const job of snapshot.jobs) {
      signal.throwIfAborted();
      // A claim, live upload, or retry lease stays charged. No age-only release.
      if (job.attempts !== 0 || job.nextAttemptAt.getTime() > now || job.createdAt.getTime() > now - 30 * 60_000) continue;
      if (job.userId !== snapshot.userId || !isSafeObjectDeletionPrefix(job.prefix) ||
        [...references.keys()].some(key => key.startsWith(job.prefix))) continue;
      if (job.prefix.startsWith("images/") && !job.prefix.startsWith(`images/${snapshot.userId}/`)) continue;
      if (job.prefix.startsWith("lectures/") && !ownedBoards.has(job.prefix.split("/")[1])) continue;
      if (job.prefix.endsWith("/")) {
        if ((await listObjectSizes(job.prefix, signal)).length === 0) expiredEmptyJobs.push(job.id);
      } else {
        if ((await headObjectSize(job.prefix, signal)).status === "missing") expiredEmptyJobs.push(job.id);
      }
    }
    const previousTurns = snapshot.turns.reduce((sum, turn) => sum + priorTurnCharge(turn), 0n);
    const notes = snapshot.notes.reduce((sum, note) => sum + note.storageBytes, 0n);
    const noteUpdates = snapshot.notes.filter(note => note.storageBytes === 0n).map(note => ({ id: note.id,
      storageBytes: BigInt(Buffer.byteLength(note.content, "utf8") + (note.tag == null ? 0 : Buffer.byteLength(JSON.stringify(note.tag), "utf8")))
    })).filter(note => note.storageBytes > 0n);
    const measuredNotes = notes + noteUpdates.reduce((sum, note) => sum + note.storageBytes, 0n);
    const jobs = snapshot.jobs.reduce((sum, job) => sum + job.bytes, 0n);
    const beforeBytes = snapshot.storage?.reservedBytes ?? previousTurns + notes + jobs;
    const recorded = snapshot.turns.reduce((sum, turn) => sum + turn.storageBytes, 0n) + notes + jobs;
    const priorKnown = previousTurns + notes + jobs;
    // A cache below the former ceiling cannot prove its image/reply residual
    // absent. Preserve its unexplained recorded component rather than erase it.
    const residualFloor = beforeBytes >= priorKnown ? priorKnown : recorded;
    const residual = beforeBytes > residualFloor ? beforeBytes - residualFloor : 0n;
    const keptJobs = snapshot.jobs.filter(job => !expiredEmptyJobs.includes(job.id));
    const afterBytes = measuredTurns.reduce((sum, turn) => sum + turn.storageBytes, 0n) + measuredNotes +
      keptJobs.reduce((sum, job) => sum + job.bytes, 0n) + residual;
    return {
      beforeBytes, afterBytes, releasedBytes: beforeBytes > afterBytes ? beforeBytes - afterBytes : 0n,
      turnUpdates, noteUpdates, expiredEmptyJobs,
      pendingTurnsAfter: Math.max(keptJobs.reduce((sum, job) => sum + job.pendingTurns, 0),
        (snapshot.storage?.pendingTurns ?? 0) - snapshot.jobs.filter(job => expiredEmptyJobs.includes(job.id)).reduce((sum, job) => sum + job.pendingTurns, 0)),
      measuredAudioBytes: [...objects.values()].reduce((sum, object) => sum + object.bytes, 0n),
      orphanAudioBytes: [...objects].filter(([key]) => !references.has(key)).reduce((sum, [, object]) => sum + object.bytes, 0n),
      orphanObjects: [...objects.keys()].filter(key => !references.has(key)).length,
      legacyTurns: snapshot.turns.filter(turn => turn.storageBytes === 0n).length,
      missingObjects: missing.size, unresolvedReferences: 0,
    };
  } catch {
    controller.abort();
    throw new StorageVerificationError();
  }
}

/** Caller holds the account lock. The job locks fence independent worker claims. */
export async function applyStorageAccountingPlan(tx: Prisma.TransactionClient, snapshot: StorageAccountingSnapshot, plan: StorageAccountingPlan): Promise<boolean> {
  await tx.$queryRaw`SELECT id FROM object_deletion_jobs WHERE user_id = ${snapshot.userId} FOR UPDATE`;
  const current = await readStorageAccountingSnapshot(tx, snapshot.userId);
  if (storageAccountingFingerprint(current) !== storageAccountingFingerprint(snapshot)) return false;
  for (const update of plan.turnUpdates) {
    await tx.turn.update({ where: { id: update.id }, data: { storageBytes: update.storageBytes, metadataBytes: update.metadataBytes,
      updatedAt: snapshot.turns.find(turn => turn.id === update.id)!.updatedAt } });
  }
  for (const update of plan.noteUpdates) await tx.boardChatMessage.update({ where: { id: update.id }, data: { storageBytes: update.storageBytes } });
  if (plan.expiredEmptyJobs.length) await tx.objectDeletionJob.deleteMany({ where: { userId: snapshot.userId, id: { in: plan.expiredEmptyJobs } } });
  const data = { reservedBytes: plan.afterBytes, pendingTurns: plan.pendingTurnsAfter };
  if (current.storage) await tx.userStorage.update({ where: { userId: snapshot.userId }, data });
  else await tx.userStorage.create({ data: { userId: snapshot.userId, ...data } });
  return true;
}
