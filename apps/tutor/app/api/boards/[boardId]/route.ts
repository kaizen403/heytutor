import { NextResponse } from "next/server";
import { ensureUser, getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

interface RouteContext {
  params: Promise<{ boardId: string }>;
}

async function getOwnedBoard(boardId: string, userId: string) {
  return prisma.board.findFirst({
    where: { id: boardId, userId },
  });
}

export async function GET(_request: Request, context: RouteContext) {
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

  const turnRows = await prisma.turn.findMany({
    where: { boardId },
    orderBy: { orderIndex: "asc" },
  });

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
      createdAt: turn.createdAt.getTime(),
      segments: (segmentsByTurn.get(turn.id) ?? []).map((segment) => ({
        id: segment.id,
        orderIndex: segment.orderIndex,
        narration: segment.narration,
        spokenText: segment.spokenText,
        command: segment.command,
        audioUrl: segment.audioUrl,
        audioFormat: segment.audioFormat,
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
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
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
    data.title = body.title.trim().slice(0, 200);
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

export async function DELETE(_request: Request, context: RouteContext) {
  try {
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

    // Collect R2 audio keys before the cascade removes the segments.
    const turns = await prisma.turn.findMany({
      where: { boardId },
      select: {
        id: true,
        segments: {
          select: { orderIndex: true, audioUrl: true },
        },
      },
    });

    // DB cascade removes turns/segments.
    await prisma.board.delete({
      where: { id: boardId },
    });

    // Best-effort R2 audio cleanup in the background. Dynamic import keeps
    // child_process out of the route's webpack bundle at build time.
    const { lectureAudioKey } = await import("@/lib/r2/r2Keys");
    const audioKeys = turns
      .flatMap((turn) =>
        turn.segments
          .filter((segment) => Boolean(segment.audioUrl))
          .map((segment) => lectureAudioKey(boardId, turn.id, segment.orderIndex)),
      );

    if (audioKeys.length > 0) {
      void (async () => {
        try {
          const { deleteAudioBulk } = await import("@/lib/r2/r2");
          await deleteAudioBulk(audioKeys);
        } catch {
          // best-effort — R2 may not be configured or wrangler unavailable
        }
      })();
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[boards] DELETE failed:", error);
    return NextResponse.json({ error: "failed to delete board" }, { status: 500 });
  }
}
