import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ensureUser, getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { uploadAudio, lectureAudioKey } from "@/lib/r2";

interface RouteContext {
  params: Promise<{ boardId: string }>;
}

interface TurnSegmentMeta {
  orderIndex: number;
  narration: string;
  spokenText: string;
  command: unknown;
  durationMs?: number;
  timings?: unknown;
}

interface TurnMetadata {
  question: string;
  rawResponse: string;
  speedMultiplier?: number;
  traceId?: string;
  segments: TurnSegmentMeta[];
}

export async function POST(request: Request, context: RouteContext) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { boardId } = await context.params;
  await ensureUser(userId);

  const board = await prisma.board.findFirst({
    where: { id: boardId, userId },
  });

  if (!board) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const metadataRaw = formData.get("metadata");

  if (typeof metadataRaw !== "string") {
    return NextResponse.json({ error: "metadata required" }, { status: 400 });
  }

  let metadata: TurnMetadata;
  try {
    metadata = JSON.parse(metadataRaw) as TurnMetadata;
  } catch {
    return NextResponse.json({ error: "invalid metadata json" }, { status: 400 });
  }

  if (!metadata.question?.trim() || !metadata.rawResponse?.trim()) {
    return NextResponse.json({ error: "question and rawResponse required" }, { status: 400 });
  }

  const turnCount = await prisma.turn.count({
    where: { boardId },
  });

  const orderIndex = turnCount;
  const turnId = crypto.randomUUID();
  const segmentMeta = metadata.segments ?? [];

  const audioUrls: (string | null)[] = [];
  for (const segment of segmentMeta) {
    const file = formData.get(`audio-${segment.orderIndex}`);
    if (file instanceof File && file.size > 0) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const key = lectureAudioKey(boardId, turnId, segment.orderIndex);
      audioUrls[segment.orderIndex] = await uploadAudio(key, bytes);
    } else {
      audioUrls[segment.orderIndex] = null;
    }
  }

  const saved = await prisma.$transaction(async (tx) => {
    const turn = await tx.turn.create({
      data: {
        id: turnId,
        boardId,
        userId,
        orderIndex,
        question: metadata.question,
        rawResponse: metadata.rawResponse,
        speedMultiplier: metadata.speedMultiplier ?? 1,
        traceId: metadata.traceId ?? null,
      },
    });

    const segmentValues = segmentMeta.map((segment) => ({
      turnId,
      orderIndex: segment.orderIndex,
      narration: segment.narration ?? "",
      spokenText: segment.spokenText ?? "",
      command: segment.command === undefined ? undefined : (segment.command as Prisma.InputJsonValue),
      audioUrl: audioUrls[segment.orderIndex] ?? null,
      audioFormat: "audio/mpeg",
      durationMs: segment.durationMs ?? null,
      timings: segment.timings === undefined ? undefined : (segment.timings as Prisma.InputJsonValue),
    }));

    const insertedSegments =
      segmentValues.length > 0
        ? await tx.segment.createManyAndReturn({ data: segmentValues })
        : [];

    await tx.board.update({
      where: { id: boardId },
      data: {
        preview: metadata.question.slice(0, 60),
        updatedAt: new Date(),
      },
    });

    return { turn, insertedSegments };
  });

  return NextResponse.json({
    turn: {
      id: saved.turn.id,
      orderIndex: saved.turn.orderIndex,
      question: saved.turn.question,
      rawResponse: saved.turn.rawResponse,
      speedMultiplier: saved.turn.speedMultiplier,
      traceId: saved.turn.traceId,
      createdAt: saved.turn.createdAt.getTime(),
      segments: saved.insertedSegments
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((segment) => ({
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
    },
  });
}
