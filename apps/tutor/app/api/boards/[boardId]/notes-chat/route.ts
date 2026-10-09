import { NextResponse } from "next/server";
import {
  NOTES_CHAT_SYSTEM_PROMPT,
  getMockNotesChatResponse,
  stripNotesChatProtocol,
  tutorDebug,
} from "@heytutor/tutor-core";
import { requireNotesAccess, isSpendActor, requireSpendActor } from "@/lib/billing/gate";
import { reservePaidUsage, holdPaidUsage, maximumLlmCost, actualLlmCost, type PaidUsageReservation } from "@/lib/billing/paidUsage";
import { readBoundedJson, RequestBodyError } from "@/lib/http/requestBody";
import { reserveStorageBytes, releaseStorageBytes, StorageQuotaError, withUserStorageLock } from "@/lib/boards/storageQuota";
import { recordLlmSpend, recordNotesMessage } from "@/lib/billing/track";
import type { SpendActor } from "@/lib/billing/actor";
import { holdNotesReservation } from "@/lib/billing/notesReservation";
import { prisma } from "@/lib/db/prisma";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import {
  assembleLessonNotes,
  notesFromStoredTurn,
  parseLiveTurnNotes,
} from "@/features/tutor-session/lib/notes/lessonNotes";
import {
  formatNotesChatTagPrompt,
  formatTaggedUserMessage,
  parseNotesChatTag,
} from "@/features/tutor-session/lib/notes/notesChatTag";
import {
  endLlmGeneration,
  flushInBackground,
  genTraceId,
  startTurnTrace,
} from "@/lib/obs/langfuse";
import { fetchTeachingCompletion } from "@/lib/llm/teachingTransport";
import { completionTokenCap, providerChatBody, resolveLlmEndpoint } from "@/lib/llm/llmProvider";
import { prepareNotesChat } from "@/lib/llm/notesChatPolicy";
import { parseProviderUsage, usageDetailsFromParsed } from "@/lib/obs/providerUsage";
import { registerWsConnectionRevocation } from "@/lib/tts/wsTicket";

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
  tag: unknown;
}

function serializeMessage(row: ChatRow) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt.getTime(),
    tag: parseNotesChatTag(row.tag),
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

export async function GET(request: Request, context: RouteContext) {
  const actor = await requireSpendActor(request);
  if (!isSpendActor(actor)) return actor;
  const userId = actor.userId;

  const { boardId } = await context.params;

  const board = await getOwnedBoard(boardId, userId);
  if (!board) {
    // Home drafts mint a client UUID and open notes before any row exists.
    // An empty thread is honest there; a row owned by someone else stays 404.
    const foreign = await prisma.board.findFirst({
      where: { id: boardId },
      select: { id: true },
    });
    if (foreign) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ messages: [] });
  }

  const rows = await prisma.boardChatMessage.findMany({
    where: { boardId, userId },
    orderBy: { createdAt: "desc" },
    take: NOTES_CHAT_UI_LIMIT,
    select: { id: true, role: true, content: true, createdAt: true, tag: true },
  });

  return NextResponse.json({
    messages: rows.reverse().map(serializeMessage),
  });
}

export async function POST(request: Request, context: RouteContext) {
  const gated = await requireNotesAccess(request);
  if (gated instanceof Response) return gated;
  try {
    const response = await postNotesChat(request, context, gated.actor);
    if (!response.ok) await gated.release?.();
    return response.ok ? holdNotesReservation(response, gated.release) : response;
  } catch (error) {
    await gated.release?.();
    throw error;
  }
}

async function postNotesChat(request: Request, context: RouteContext, actor: SpendActor) {
  const userId = actor.userId;

  const { boardId } = await context.params;

  const board = await getOwnedBoard(boardId, userId);
  if (!board) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await readBoundedJson(request, 512 * 1024);
  } catch (error) {
    return NextResponse.json({ error: "invalid json" }, { status: error instanceof RequestBodyError ? error.status : 400 });
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
  if (request.signal.aborted) {
    return NextResponse.json({ error: "request canceled" }, { status: 499 });
  }

  const lectureInProgress = body.lectureInProgress === true;
  const live = parseLiveTurnNotes(body.liveNotes);
  const persisted = await loadPersistedTurns(boardId);
  const notes = assembleLessonNotes(persisted, live, lectureInProgress);

  const historyRows = await prisma.boardChatMessage.findMany({
    where: { boardId, userId },
    orderBy: { createdAt: "desc" },
    take: NOTES_CHAT_HISTORY_LIMIT,
    select: { role: true, content: true, tag: true },
  });
  const history = historyRows.reverse().flatMap((row) => {
    if (row.role !== "user" && row.role !== "assistant") return [];
    const tag = parseNotesChatTag(row.tag);
    return [{
      role: row.role as "user" | "assistant",
      content: row.role === "user" ? formatTaggedUserMessage(row.content, tag) : row.content,
    }];
  });

  const tag = parseNotesChatTag(body.tag);
  const userContent = formatTaggedUserMessage(message, tag);

  const messageBytes = Buffer.byteLength(message) + Buffer.byteLength(JSON.stringify(tag)) + 256;
  const replyBudgetBytes = 64 * 1024;
  let replyBytes = 0;
  let storageReleased = false;
  let initialStorageReserved = false;
  let savingReply: Promise<void> | undefined;
  let storageRelease: Promise<void> | undefined;
  let unregisterAccount = () => {};
  try {
    await reserveStorageBytes(userId, messageBytes + replyBudgetBytes);
    initialStorageReserved = true;
    await withUserStorageLock(userId, async tx => {
      if (await tx.boardChatMessage.count({ where: { boardId, userId } }) >= 2000) throw new StorageQuotaError("notes history is full", 429);
      if (!await tx.board.findFirst({ where: { id: boardId, userId } })) throw new StorageQuotaError("board not found", 404);
      await tx.boardChatMessage.create({ data: {
        boardId, userId, role: "user", content: message, storageBytes: BigInt(messageBytes),
        tag: tag ? { kind: tag.kind, text: tag.text, turnIndex: tag.turnIndex } : undefined,
      } });
    });
  } catch (error) {
    if (initialStorageReserved) await releaseStorageBytes(userId, messageBytes + replyBudgetBytes).catch(() => {});
    return NextResponse.json({ error: error instanceof StorageQuotaError ? error.message : "Could not save message." }, { status: error instanceof StorageQuotaError ? error.status : 503 });
  }
  const releaseReplyStorage = () => {
    storageRelease ??= (async () => {
      storageReleased = true;
      unregisterAccount();
      // Cancellation can arrive while TransformStream.flush is committing its
      // reply. Settle that transaction before calculating the unused capacity.
      await savingReply?.catch(() => {});
      await releaseStorageBytes(userId, replyBudgetBytes - replyBytes).catch(error => {
        if (!(error instanceof StorageQuotaError && error.status === 404)) console.error("[notes] storage settlement failed", error);
      });
    })();
    return storageRelease;
  };
  const saveReply = async (reply: string) => {
    if (storageReleased) return;
    const bytes = Buffer.byteLength(reply) + 256;
    if (bytes > replyBudgetBytes) throw new Error("notes reply too large");
    savingReply = withUserStorageLock(userId, async tx => {
      if (!await tx.board.findFirst({ where: { id: boardId, userId } })) throw new StorageQuotaError("board not found", 404);
      if (await tx.boardChatMessage.count({ where: { boardId, userId } }) >= 2000) throw new StorageQuotaError("notes history is full", 429);
      await tx.boardChatMessage.create({ data: { boardId, userId, role: "assistant", content: reply, storageBytes: BigInt(bytes) } });
    }).then(() => { replyBytes = bytes; });
    await savingReply;
  };
  const holdStorage = (body: ReadableStream<Uint8Array>) => {
    const reader = body.getReader();
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try { const item = await reader.read(); if (item.done) { await releaseReplyStorage(); controller.close(); } else controller.enqueue(item.value); }
        catch (error) { await releaseReplyStorage(); controller.error(error); }
      },
      async cancel(reason) { try { await reader.cancel(reason); } finally { await releaseReplyStorage(); } },
    });
  };
  let paid: PaidUsageReservation | undefined;
  let policy: PaidUsageReservation | undefined;
  let policyDispatched = false;
  let storageHandedOff = false;
  try {
  const accountCanceled = new AbortController();
  const requestSignal = AbortSignal.any([request.signal, accountCanceled.signal, AbortSignal.timeout(120_000)]);
  // Account deletion also cancels HTTP notes generation. Register before any
  // asynchronous provider admission; late registration after deletion aborts.
  unregisterAccount = registerWsConnectionRevocation(userId, () => accountCanceled.abort());
  const dispatchAccessError = async () => {
    if (requestSignal.aborted) return NextResponse.json({ error: "request canceled" }, { status: 499 });
    const activeUser = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!activeUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!await getOwnedBoard(boardId, userId)) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (requestSignal.aborted) return NextResponse.json({ error: "request canceled" }, { status: 499 });
    return null;
  };
  const initialDispatchError = await dispatchAccessError();
  if (initialDispatchError) return initialDispatchError;
  const llm = resolveLlmEndpoint();
  const apiKey = llm.apiKey;
  const mock = !apiKey;
  const traceId = genTraceId();
  const turnTrace = startTurnTrace({
    sessionId: boardId,
    userId,
    input: userContent,
    traceId,
    mock,
    name: "notes-chat",
    generationName: "notes-chat-llm",
  });

  if (mock) {
    const reply = stripNotesChatProtocol(getMockNotesChatResponse(userContent));
    await saveReply(reply);
    await releaseReplyStorage();
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

  const mode = process.env.TUTOR_NOTES_EVALUATION_MODE?.trim().toLowerCase();
  if ((mode === "shadow" || mode === "jev") && process.env.AI_GATEWAY_API_KEY?.trim()) {
    const reservation = await reservePaidUsage({ actor, kind: "policy", traceId, usd: 0.03 });
    if (reservation instanceof Response) return reservation;
    policy = reservation;
  }
  const policyDispatchError = await dispatchAccessError();
  if (policyDispatchError) { await policy?.cancelBeforeDispatch(); policy = undefined; return policyDispatchError; }
  let prepared: Awaited<ReturnType<typeof prepareNotesChat>>;
  policyDispatched = policy !== undefined;
  try { prepared = await prepareNotesChat({
    notes,
    tag,
    userMessage: message,
    signal: requestSignal,
    network: true,
  }); } catch (error) { await policy?.finish(); throw error; }
  await policy?.settle(prepared.evaluation?.status === "assessed" && prepared.evaluation.usage.inputTokens > 0 ? prepared.evaluation.usage.estimatedUsd : undefined);
  const model = prepared.model;
  const taggedPrompt = tag ? `\n\n${formatNotesChatTagPrompt(tag)}` : "";
  const systemPrompt = `${NOTES_CHAT_SYSTEM_PROMPT}\n\nlesson notes:\n${prepared.notesText}${taggedPrompt}`;
  const evaluation = prepared.evaluation;
  if (evaluation?.status === "assessed" && evaluation.usage.inputTokens > 0) {
    recordLlmSpend({
      actor,
      accounted: true,
      model: evaluation.provenance.model,
      usage: {
        input: evaluation.usage.inputTokens,
        output: evaluation.usage.outputTokens,
      },
    });
  }
  const providerBody = providerChatBody({
    model,
    max_tokens: NOTES_CHAT_MAX_TOKENS,
    temperature: 0.3,
    stream: true,
    stream_options: { include_usage: true },
    reasoning_effort: "none",
    messages: [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: userContent },
    ],
  }, llm);

  const reservation = await reservePaidUsage({ actor, kind: "notes", traceId,
    usd: maximumLlmCost(providerBody.messages, completionTokenCap(providerBody), [model]) });
  if (reservation instanceof Response) return reservation;
  paid = reservation;
  const dispatchError = await dispatchAccessError();
  if (dispatchError) {
    await reservation.cancelBeforeDispatch();
    paid = undefined;
    return dispatchError;
  }
  let upstream: Response;
  try {
    upstream = await fetchTeachingCompletion({
      url: llm.url,
      signal: requestSignal,
      init: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(providerBody),
      },
    });
  } catch (error: unknown) {
    const err = error instanceof Error ? error.message : "notes-chat fetch failed";
    endLlmGeneration(turnTrace, { output: err, metadata: { error: true } });
    flushInBackground();
    return NextResponse.json({ error: "Could not generate an answer. Please retry." }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const errorBody = await upstream.text().catch(() => "");
    endLlmGeneration(turnTrace, {
      output: errorBody,
      metadata: { error: true, status: upstream.status },
    });
    flushInBackground();
    return NextResponse.json(
      { error: "Could not generate an answer. Please retry." },
      { status: upstream.status || 502 },
    );
  }

  const decoder = new TextDecoder();
  let buffered = "";
  let accumulated = "";
  let latestUsage: unknown;

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffered += decoder.decode(chunk, { stream: true });
      if (buffered.length > 128 * 1024 || accumulated.length > 60 * 1024) throw new Error("notes stream limit exceeded");
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        const usage = readNotesChatUsage(line);
        if (usage) latestUsage = usage;
        const encoded = encodeNotesChatDelta(line);
        if (encoded.delta) {
          accumulated += encoded.delta;
          controller.enqueue(encodeSse({ delta: encoded.delta }));
        }
      }
    },
    async flush(controller) {
      if (buffered.length > 0) {
        const usage = readNotesChatUsage(buffered);
        if (usage) latestUsage = usage;
        const encoded = encodeNotesChatDelta(buffered);
        if (encoded.delta) {
          accumulated += encoded.delta;
          controller.enqueue(encodeSse({ delta: encoded.delta }));
        }
      }
      const reply = stripNotesChatProtocol(accumulated);
      if (reply) {
        await saveReply(reply);
      }
      const parsedUsage = parseProviderUsage(latestUsage);
      await reservation.settle(parsedUsage.known ? actualLlmCost(usageDetailsFromParsed(parsedUsage), model) : undefined);
      endLlmGeneration(turnTrace, {
        output: reply,
        usageDetails: usageDetailsFromParsed(parsedUsage),
        metadata: {
          content_chars: reply.length,
          notes_policy: prepared.mode,
          notes_context: prepared.context,
          notes_truncated: prepared.truncated,
          notes_model: model,
          usage_status: parsedUsage.known ? "known" : "unknown",
          cached_input_tokens: parsedUsage.cachedInput ?? 0,
          jev_status: evaluation?.status ?? "skipped",
          jev_decision: evaluation?.status === "assessed" ? evaluation.decision : null,
          jev_reason: evaluation?.status === "unavailable" ? evaluation.reason : null,
          jev_input_tokens: evaluation?.status === "assessed" ? evaluation.usage.inputTokens : 0,
          jev_estimated_usd: evaluation?.status === "assessed" ? evaluation.usage.estimatedUsd : 0,
        },
        model,
      });
      if (parsedUsage.known) {
        recordLlmSpend({ actor, model, usage: usageDetailsFromParsed(parsedUsage), accounted: true });
      }
      if (reply) {
        recordNotesMessage(actor);
      }
      flushInBackground();
      controller.enqueue(encodeSse({ done: true }));
    },
  });

  tutorDebug("notes-chat", "streaming", { board_id: boardId, trace_id: traceId });

  const streamBody = holdStorage(holdPaidUsage(upstream.body.pipeThrough(transform), reservation));
  paid = undefined;
  storageHandedOff = true;
  return new Response(streamBody, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "x-heytutor-trace-id": traceId,
    },
  });
  } finally {
    // Each cleanup is independent: a billing write failure must not strand a
    // storage allowance or an undispatched policy admission.
    try {
      if (policy) await (policyDispatched ? policy.finish() : policy.cancelBeforeDispatch());
    } finally {
      try { if (paid) await paid.finish(); }
      finally { if (!storageHandedOff) await releaseReplyStorage(); }
    }
  }
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

function readNotesChatUsage(line: string): unknown {
  if (!line.startsWith("data: ")) return undefined;
  const jsonString = line.slice(6).trim();
  if (!jsonString || jsonString === "[DONE]") return undefined;
  try {
    const parsed: unknown = JSON.parse(jsonString);
    if (!isRecord(parsed) || !isRecord(parsed.usage)) return undefined;
    return parsed.usage;
  } catch {
    return undefined;
  }
}
