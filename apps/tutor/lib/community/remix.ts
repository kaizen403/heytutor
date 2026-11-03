/**
 * Remix: copy a Community board into the viewer's own account, where they can
 * ask doubts on it or Continue it like any board of theirs.
 *
 * The copy owns its clips. They are copied in storage before any row is
 * written, so the remix keeps playing if the author deletes the original, and
 * the bytes are charged to the person remixing in the same locked
 * transaction that writes the rows.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { historicalTurnStorageCharge } from "@/lib/boards/storageAccounting";
import { MAX_ACCOUNT_BOARDS, MAX_ACCOUNT_STORAGE_BYTES, MAX_ACCOUNT_TURNS, StorageQuotaError, withAdmittedStorageBytes } from "@/lib/boards/storageQuota";
import { boardAudioPrefix, parseStoredObjectKey } from "@/lib/object-store/keys";
import { mediaKeyFromUrl, mediaProxyUrl } from "@/lib/object-store/mediaUrl";
import { copyLectureObject, deletePrefix } from "@/lib/object-store/s3";
import { communityBoardWhere } from "./queries";
import { communitySceneArtifacts, isCommunityTurnShown } from "./publicBoard";

/** Clips copied at once. Bounded so one remix cannot saturate the store. */
const COPY_CONCURRENCY = 6;
/**
 * The cleanup receipt written before the first copy waits this long before
 * the deletion worker may act on it, so it never deletes a copy still in
 * flight. A successful remix removes the receipt in its own transaction.
 */
const COPY_RECEIPT_GRACE_MS = 15 * 60_000;

export class RemixError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function json(value: Prisma.JsonValue | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

export async function remixCommunityBoard(sourceBoardId: string, userId: string): Promise<{ boardId: string }> {
  const source = await prisma.board.findFirst({
    where: communityBoardWhere({ id: sourceBoardId }),
    select: { id: true, title: true, preview: true, userId: true },
  });
  if (!source) throw new RemixError("not found", 404);

  const turns = (await prisma.turn.findMany({
    where: { boardId: source.id },
    orderBy: { orderIndex: "asc" },
    include: { segments: { orderBy: { orderIndex: "asc" } } },
  })).filter((turn) => isCommunityTurnShown({ status: turn.status, segmentCount: turn.segments.length }));
  if (turns.length === 0) throw new RemixError("not found", 404);

  const boardId = crypto.randomUUID();
  const turnIds = new Map(turns.map((turn) => [turn.id, crypto.randomUUID()]));

  // Every distinct clip once: checkpoint rows can share one recording.
  const copies = new Map<string, string>();
  const newAudioUrl = (audioUrl: string | null): string | null => {
    if (!audioUrl) return null;
    const key = mediaKeyFromUrl(audioUrl);
    const parsed = key ? parseStoredObjectKey(key) : null;
    // A clip that is not this board's own lecture object is not copied, and
    // the copy is never pointed at the author's storage.
    if (!key || parsed?.kind !== "lecture" || parsed.boardId !== source.id) return null;
    const turnId = turnIds.get(parsed.turnId);
    if (!turnId) return null;
    const target = `lectures/${boardId}/${turnId}/${parsed.attemptDir ? `${parsed.attemptDir}/` : ""}${parsed.segmentIndex}.${parsed.ext}`;
    copies.set(key, target);
    return mediaProxyUrl(target);
  };
  const rows = turns.map((turn, index) => ({
    turn,
    id: turnIds.get(turn.id)!,
    orderIndex: index,
    segments: turn.segments.map((segment) => ({ segment, audioUrl: newAudioUrl(segment.audioUrl) })),
  }));

  const bytes = turns.reduce((sum, turn) => sum + historicalTurnStorageCharge({
    storageBytes: turn.storageBytes,
    audioReferences: turn.segments.filter((segment) => segment.audioUrl).length,
  }), 0n);

  // Refuse early, before any copy, when the account plainly cannot take it.
  // The locked transaction below checks again; this only stops a full
  // account from paying for copies that are thrown away.
  const [boardCount, turnCount, storage] = await Promise.all([
    prisma.board.count({ where: { userId } }),
    prisma.turn.count({ where: { userId } }),
    prisma.userStorage.findUnique({ where: { userId }, select: { reservedBytes: true } }),
  ]);
  if (boardCount >= MAX_ACCOUNT_BOARDS) throw new RemixError("board storage quota exceeded", 429);
  if (turnCount + rows.length > MAX_ACCOUNT_TURNS) throw new RemixError("turn storage quota exceeded", 429);
  if (storage && storage.reservedBytes + bytes > BigInt(MAX_ACCOUNT_STORAGE_BYTES)) throw new RemixError("account storage quota exceeded", 429);

  // A durable receipt for the copies exists before the first one lands, so a
  // crash or deploy mid remix still leaves the worker a way to delete them.
  const prefix = boardAudioPrefix(boardId);
  if (copies.size > 0) {
    await prisma.objectDeletionJob.create({
      data: { id: crypto.randomUUID(), prefix, userId, bytes: 0n, nextAttemptAt: new Date(Date.now() + COPY_RECEIPT_GRACE_MS) },
    });
  }
  const cleanup = async () => {
    if (copies.size === 0) return;
    try {
      await deletePrefix(prefix);
      await prisma.objectDeletionJob.deleteMany({ where: { prefix } });
    } catch {
      // The receipt stays; the worker deletes the copies once its grace ends.
    }
  };

  const signal = AbortSignal.timeout(120_000);
  const pending = [...copies];
  let copyFailed = false;
  await Promise.all(Array.from({ length: Math.min(COPY_CONCURRENCY, pending.length) }, async () => {
    while (!copyFailed) {
      const next = pending.shift();
      if (!next) return;
      if (!(await copyLectureObject(next[0], next[1], signal))) copyFailed = true;
    }
  }));
  if (copyFailed) {
    await cleanup();
    throw new RemixError("could not copy the lesson audio", 503);
  }

  try {
    await withAdmittedStorageBytes(userId, Number(bytes), async (tx) => {
      // The copies are owned by the board row now; their receipt goes with the commit.
      if (copies.size > 0) await tx.objectDeletionJob.deleteMany({ where: { prefix } });
      if (await tx.board.count({ where: { userId } }) >= MAX_ACCOUNT_BOARDS) {
        throw new StorageQuotaError("board storage quota exceeded", 429);
      }
      if (await tx.turn.count({ where: { userId } }) + rows.length > MAX_ACCOUNT_TURNS) {
        throw new StorageQuotaError("turn storage quota exceeded", 429);
      }
      await tx.board.create({
        data: {
          id: boardId,
          userId,
          title: source.title,
          // From the copied turns, never the source's preview: a live turn the
          // copy leaves out may already have written its question there.
          preview: rows[rows.length - 1]!.turn.question.slice(0, 2000),
          // A copy stays off Community until its owner shares it, so the
          // gallery does not fill with duplicates of one lesson.
          visibility: "private",
          remixedFromBoardId: source.id,
        },
      });
      for (const row of rows) {
        const { turn } = row;
        await tx.turn.create({
          data: {
            id: row.id,
            boardId,
            userId,
            orderIndex: row.orderIndex,
            question: turn.question,
            rawResponse: turn.rawResponse,
            speedMultiplier: turn.speedMultiplier,
            sceneDocument: json(turn.sceneDocument),
            sceneEngineVersion: turn.sceneEngineVersion,
            validationReport: json(turn.validationReport),
            visualStatus: turn.visualStatus,
            sceneArtifacts: json(communitySceneArtifacts(turn.sceneArtifacts) as Prisma.JsonValue | null),
            status: turn.status === "stopped" ? "stopped" : "complete",
            kind: turn.kind,
            // The author's Continue state stays theirs. A stopped lesson in a
            // remix starts its Continue from the board, not their solver state.
            resumeState: Prisma.DbNull,
            storageBytes: historicalTurnStorageCharge({
              storageBytes: turn.storageBytes,
              audioReferences: turn.segments.filter((segment) => segment.audioUrl).length,
            }),
            metadataBytes: turn.metadataBytes,
            lessonMs: turn.lessonMs,
          },
        });
        await tx.segment.createMany({
          data: row.segments.map(({ segment, audioUrl }) => ({
            turnId: row.id,
            orderIndex: segment.orderIndex,
            narration: segment.narration,
            spokenText: segment.spokenText,
            command: json(segment.command),
            audioUrl,
            audioFormat: segment.audioFormat,
            durationMs: segment.durationMs,
            timings: json(segment.timings),
            audioRef: segment.audioRef,
          })),
        });
      }
      await tx.board.update({ where: { id: source.id }, data: { remixCount: { increment: 1 } } });
    });
  } catch (error) {
    await cleanup();
    if (error instanceof StorageQuotaError) throw new RemixError(error.message, error.status);
    throw error;
  }

  return { boardId };
}
