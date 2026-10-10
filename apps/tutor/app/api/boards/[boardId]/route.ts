import { NextResponse } from "next/server";
import { ensureUser, getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { readBoundedJson, RequestBodyError } from "@/lib/http/requestBody";
import { MAX_BOARD_TITLE_CHARS, MAX_BOARD_PREVIEW_CHARS, boardStorageBytes, ensureStorageAccounting, withUserStorageLock } from "@/lib/boards/storageQuota";
import { boardAudioPrefix } from "@/lib/object-store/keys";
import { effectiveTurnStatus, isTurnKind, isTurnStatus } from "@/lib/boards/turnStatus";

interface RouteContext {
  params: Promise<{ boardId: string }>;
}

async function getOwnedBoard(boardId: string, userId: string) {
  return prisma.board.findFirst({
    where: { id: boardId, userId },
  });
}

export async function GET(request: Request, context: RouteContext) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { boardId } = await context.params;
  await ensureUser(userId);

  const board = await getOwnedBoard(boardId, userId);
  if (!board) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const page = Number(new URL(request.url).searchParams.get("page") ?? "0");
  if (!Number.isSafeInteger(page) || page < 0 || page > 10_000) {
    return NextResponse.json({ error: "invalid page" }, { status: 400 });
  }
  const pageSize = 10;
  const fetchedTurns = await prisma.turn.findMany({
    where: { boardId },
    orderBy: { orderIndex: "asc" },
    skip: page * pageSize,
    take: pageSize + 1,
    // The pre-canonical rows exist only to grow a live turn; never sent out.
    omit: { submittedSegments: true },
  });
  const now = Date.now();
  const turnRows = fetchedTurns.slice(0, pageSize);

  const turnIds = turnRows.map((t) => t.id);
  const segmentRows =
    turnIds.length > 0
      ? await prisma.segment.findMany({
          where: { turnId: { in: turnIds } },
          orderBy: { orderIndex: "asc" },
        })
      : [];

  const segmentsByTurn = new Map<string, typeof segmentRows>();
  for (const segment of segmentRows) {
    const list = segmentsByTurn.get(segment.turnId) ?? [];
    list.push(segment);
    segmentsByTurn.set(segment.turnId, list);
  }

  return NextResponse.json({
    nextPage: fetchedTurns.length > pageSize ? page + 1 : null,
    board: {
      id: board.id,
      title: board.title,
      preview: board.preview,
      createdAt: board.createdAt.getTime(),
    },
    turns: turnRows.map((turn) => ({
      id: turn.id,
      orderIndex: turn.orderIndex,
      question: turn.question,
      rawResponse: turn.rawResponse,
      speedMultiplier: turn.speedMultiplier,
      traceId: turn.traceId,
      sceneDocument: turn.sceneDocument,
      sceneEngineVersion: turn.sceneEngineVersion,
      validationReport: turn.validationReport,
      visualStatus: turn.visualStatus,
      sceneArtifacts: turn.sceneArtifacts,
      // A live turn whose tab stopped checkpointing reads as stopped.
      status: effectiveTurnStatus(turn.status, turn.updatedAt, now),
      persistedStatus: isTurnStatus(turn.status) ? turn.status : "complete",
      kind: isTurnKind(turn.kind) ? turn.kind : "lesson",
      resumeState: turn.resumeState ?? null,
      createdAt: turn.createdAt.getTime(),
      updatedAt: turn.updatedAt.getTime(),
      segments: (segmentsByTurn.get(turn.id) ?? []).map((segment) => ({
        id: segment.id,
        orderIndex: segment.orderIndex,
        narration: segment.narration,
        spokenText: segment.spokenText,
        command: segment.command,
        audioUrl: segment.audioUrl,
        audioFormat: segment.audioFormat,
        audioRef: segment.audioRef,
        durationMs: segment.durationMs,
        timings: segment.timings,
      })),
    })),
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { boardId } = await context.params;
  await ensureUser(userId);

  const board = await getOwnedBoard(boardId, userId);
  if (!board) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: {
    title?: string;
    preview?: string;
    pinned?: boolean;
    archived?: boolean;
  } = {};
  try {
    body = await readBoundedJson(request, 16 * 1024);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid json" },
      { status: error instanceof RequestBodyError ? error.status : 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    (body.title !== undefined && (typeof body.title !== "string" || body.title.length > MAX_BOARD_TITLE_CHARS)) ||
    (body.preview !== undefined && (typeof body.preview !== "string" || body.preview.length > MAX_BOARD_PREVIEW_CHARS))) {
    return NextResponse.json({ error: "board title or preview exceeds its field limit" }, { status: 400 });
  }

  const data: {
    title?: string;
    preview?: string;
    pinnedAt?: Date | null;
    archivedAt?: Date | null;
    updatedAt: Date;
  } = {
    updatedAt: new Date(),
  };

  if (typeof body.title === "string" && body.title.trim()) {
    data.title = body.title.trim();
  }

  if (typeof body.preview === "string") {
    data.preview = body.preview;
  }

  // Stamped rather than flagged: the pin order is "most recently pinned first",
  // which a boolean cannot express. Re-pinning an already-pinned board keeps
  // its original stamp so the list does not reshuffle under the student.
  if (typeof body.pinned === "boolean") {
    data.pinnedAt = body.pinned ? (board.pinnedAt ?? new Date()) : null;
  }

  if (typeof body.archived === "boolean") {
    data.archivedAt = body.archived ? (board.archivedAt ?? new Date()) : null;
  }

  const updated = await prisma.board.update({
    where: { id: boardId },
    data,
  });

  return NextResponse.json({
    board: {
      id: updated.id,
      title: updated.title,
      preview: updated.preview,
      createdAt: updated.createdAt.getTime(),
      pinnedAt: updated.pinnedAt?.getTime() ?? null,
      archivedAt: updated.archivedAt?.getTime() ?? null,
    },
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { boardId } = await context.params;
    await ensureUser(userId);

    const guard = new URL(request.url).searchParams;
    if (guard.has("ifEmpty")) {
      if (guard.get("ifEmpty") !== "1") {
        return NextResponse.json({ error: "invalid ifEmpty" }, { status: 400 });
      }
      const outcome = await withUserStorageLock(userId, async (tx) => {
        // A turn insert needs an FK key-share lock on this board. Locking the
        // row first serializes that insert against the emptiness check and
        // cascade delete; a GET followed by DELETE cannot do this safely.
        const rows = await tx.$queryRaw<Array<{ id: string; preview: string }>>`
          SELECT id, preview FROM boards
          WHERE id = ${boardId} AND user_id = ${userId}
          FOR UPDATE
        `;
        if (!rows.length) return "not-found";
        if (rows[0]!.preview.trim()) return "not-empty";
        const turn = await tx.turn.findFirst({ where: { boardId }, select: { id: true } });
        if (turn) return "not-empty";
        const message = await tx.boardChatMessage.findFirst({ where: { boardId }, select: { id: true } });
        if (message) return "not-empty";
        await tx.objectDeletionJob.create({ data: { id: crypto.randomUUID(), prefix: boardAudioPrefix(boardId), userId, bytes: 0n } });
        await tx.board.delete({ where: { id: boardId } });
        return "deleted";
      });
      if (outcome === "not-found") {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
      if (outcome === "not-empty") {
        return NextResponse.json({ error: "board is not empty" }, { status: 409 });
      }
    } else {
      // Explicit user deletion retains its existing unconditional semantics.
      const deleted = await withUserStorageLock(userId, async (tx) => {
        const board = await tx.board.findFirst({ where: { id: boardId, userId } });
        if (!board) return false;
        await ensureStorageAccounting(tx, userId);
        const bytes = await boardStorageBytes(tx, boardId);
        await tx.objectDeletionJob.create({ data: { id: crypto.randomUUID(), prefix: boardAudioPrefix(boardId), userId, bytes } });
        await tx.board.delete({ where: { id: boardId } });
        return true;
      });
      if (!deleted) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[boards] DELETE failed:", error);
    return NextResponse.json({ error: "failed to delete board" }, { status: 500 });
  }
}
