import { NextResponse } from "next/server";
import {
  NOTES_CHAT_SYSTEM_PROMPT,
  getMockNotesChatResponse,
  stripNotesChatProtocol,
  tutorDebug,
} from "@heytutor/tutor-core";
import { ensureUser, getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import {
  assembleLessonNotes,
  formatLessonNotesForPrompt,
  notesFromStoredTurn,
  parseLiveTurnNotes,
} from "@/features/tutor-session/lib/lessonNotes";
import {
  endLlmGeneration,
  flushInBackground,
  genTraceId,
  startTurnTrace,
} from "@/lib/obs/langfuse";
import { resolveTeachingModel, fetchTeachingCompletion } from "@/lib/llm/teachingTransport";

const FIREWORKS_CHAT_URL = "https://api.fireworks.ai/inference/v1/chat/completions";
const NOTES_CHAT_MAX_MESSAGE_CHARS = 2000;
const NOTES_CHAT_HISTORY_LIMIT = 12;
const NOTES_CHAT_UI_LIMIT = 50;
const NOTES_CHAT_MAX_TOKENS = 1200;

interface RouteContext {
  params: Promise<{ boardId: string }>;
}

interface ChatRow {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
}

function serializeMessage(row: ChatRow) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt.getTime(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function getOwnedBoard(boardId: string, userId: string) {
  return prisma.board.findFirst({
    where: { id: boardId, userId },
    select: { id: true },
  });
}

async function loadPersistedTurns(boardId: string) {
  const turnRows = await prisma.turn.findMany({
    where: { boardId },
    orderBy: { orderIndex: "asc" },
    include: { segments: { orderBy: { orderIndex: "asc" } } },
  });
  return turnRows.map((turn) =>
    notesFromStoredTurn({
      id: turn.id,
      orderIndex: turn.orderIndex,
      question: turn.question,
      rawResponse: turn.rawResponse,
      speedMultiplier: turn.speedMultiplier,
      traceId: turn.traceId,
      sceneDocument: turn.sceneDocument,
      sceneEngineVersion: turn.sceneEngineVersion,
      validationReport: turn.validationReport,
      visualStatus: turn.visualStatus as
        | "validated"
        | "text_only"
        | "legacy"
        | "retry_required"
        | null,
      sceneArtifacts: turn.sceneArtifacts,
      segments: turn.segments.map((segment) => ({
        id: segment.id,
        orderIndex: segment.orderIndex,
        narration: segment.narration,
        spokenText: segment.spokenText,
        command: segment.command as StoredTurn["segments"][number]["command"],
        audioUrl: segment.audioUrl,
        durationMs: segment.durationMs,
        timings: null,
      })),
    }),
  );
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

  const rows = await prisma.boardChatMessage.findMany({
    where: { boardId, userId },
    orderBy: { createdAt: "desc" },
    take: NOTES_CHAT_UI_LIMIT,
    select: { id: true, role: true, content: true, createdAt: true },
  });

  return NextResponse.json({
    messages: rows.reverse().map(serializeMessage),
  });
}

export async function POST(request: Request, context: RouteContext) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!isRecord(body) || typeof body.message !== "string") {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  const message = body.message.trim();
  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }
  if (message.length > NOTES_CHAT_MAX_MESSAGE_CHARS) {
    return NextResponse.json({ error: "message too long" }, { status: 400 });
  }

  const lectureInProgress = body.lectureInProgress === true;
  const live = parseLiveTurnNotes(body.liveNotes);
  const persisted = await loadPersistedTurns(boardId);
  const notes = assembleLessonNotes(persisted, live, lectureInProgress);
  const notesPrompt = formatLessonNotesForPrompt(notes);

  const historyRows = await prisma.boardChatMessage.findMany({
    where: { boardId, userId },
    orderBy: { createdAt: "desc" },
    take: NOTES_CHAT_HISTORY_LIMIT,
    select: { role: true, content: true },
  });
  const history = historyRows.reverse().flatMap((row) => {
    if (row.role !== "user" && row.role !== "assistant") return [];
    return [{ role: row.role as "user" | "assistant", content: row.content }];
  });

  await prisma.boardChatMessage.create({
    data: { boardId, userId, role: "user", content: message },
  });

  const apiKey = process.env.FIREWORKS_API_KEY?.trim();
  const mock = !apiKey;
  const traceId = genTraceId();
  const turnTrace = startTurnTrace({
    sessionId: boardId,
    input: message,
    traceId,
    mock,
    name: "notes-chat",
    generationName: "notes-chat-llm",
  });

  const systemPrompt = `${NOTES_CHAT_SYSTEM_PROMPT}\n\nlesson notes:\n${notesPrompt}`;

  if (mock) {
    const reply = stripNotesChatProtocol(getMockNotesChatResponse(message));
    await prisma.boardChatMessage.create({
      data: { boardId, userId, role: "assistant", content: reply },
    });
    endLlmGeneration(turnTrace, {
      output: reply,
      usageDetails: { input: 0, output: 0, total: 0 },
      metadata: { mock: true },
      mock: true,
    });
    flushInBackground();
    const payload = JSON.stringify({ delta: reply });
    return new Response(`data: ${payload}\n\ndata: ${JSON.stringify({ done: true })}\n\n`, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "x-heytutor-trace-id": traceId,
      },
    });
  }

  const model = resolveTeachingModel(process.env, { fastMode: true });
  const fireworksBody = JSON.stringify({
    model,
    max_tokens: NOTES_CHAT_MAX_TOKENS,
    temperature: 0.3,
    stream: true,
    reasoning_effort: "none",
    messages: [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: message },
    ],
  });

  let upstream: Response;
  try {
    upstream = await fetchTeachingCompletion({
      url: FIREWORKS_CHAT_URL,
      signal: request.signal,
      init: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: fireworksBody,
      },
    });
  } catch (error: unknown) {
    const err = error instanceof Error ? error.message : "notes-chat fetch failed";
    endLlmGeneration(turnTrace, { output: err, metadata: { error: true } });
    flushInBackground();
    return NextResponse.json({ error: err }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const errorBody = await upstream.text().catch(() => "");
    endLlmGeneration(turnTrace, {
      output: errorBody,
      metadata: { error: true, status: upstream.status },
    });
    flushInBackground();
    return NextResponse.json(
      { error: errorBody || "notes-chat upstream error" },
      { status: upstream.status || 502 },
    );
  }

  const decoder = new TextDecoder();
  let buffered = "";
  let accumulated = "";

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffered += decoder.decode(chunk, { stream: true });
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        const encoded = encodeNotesChatDelta(line);
        if (encoded.delta) {
          accumulated += encoded.delta;
          controller.enqueue(encodeSse({ delta: encoded.delta }));
        }
      }
    },
    async flush(controller) {
      if (buffered.length > 0) {
        const encoded = encodeNotesChatDelta(buffered);
        if (encoded.delta) {
          accumulated += encoded.delta;
          controller.enqueue(encodeSse({ delta: encoded.delta }));
        }
      }
      const reply = stripNotesChatProtocol(accumulated);
      if (reply) {
        await prisma.boardChatMessage.create({
          data: { boardId, userId, role: "assistant", content: reply },
        });
      }
      endLlmGeneration(turnTrace, {
        output: reply,
        metadata: { content_chars: reply.length },
      });
      flushInBackground();
      controller.enqueue(encodeSse({ done: true }));
    },
  });

  tutorDebug("notes-chat", "streaming", { board_id: boardId, trace_id: traceId });

  return new Response(upstream.body.pipeThrough(transform), {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "x-heytutor-trace-id": traceId,
    },
  });
}

function encodeSse(payload: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function encodeNotesChatDelta(line: string): { delta: string } {
  if (!line.startsWith("data: ")) return { delta: "" };
  const jsonString = line.slice(6).trim();
  if (!jsonString || jsonString === "[DONE]") return { delta: "" };
  try {
    const parsed: unknown = JSON.parse(jsonString);
    if (!isRecord(parsed)) return { delta: "" };
    const choices = parsed.choices;
    if (!Array.isArray(choices) || !isRecord(choices[0])) return { delta: "" };
    const delta = isRecord(choices[0].delta) ? choices[0].delta.content : null;
    return { delta: typeof delta === "string" ? delta : "" };
  } catch {
    return { delta: "" };
  }
}
