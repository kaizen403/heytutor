import { sourceCheckedStoredTurn } from "@/lib/scene/storedSceneSource";
import { speechAudioMimeType } from "@heytutor/tutor-core";
import { resolveApiUrl, type AudioTimings } from "@heytutor/tutor-core";
import type { DrawCommand, StoredCommandEnvelope } from "@heytutor/drawing";
import type { BoardEntry } from "@/lib/boards/types";
import { finalizeBoardTitle } from "@/lib/boards/boardTitle";
import { effectiveTurnStatus, type TurnKind, type TurnStatus } from "@/lib/boards/turnStatus";

export type { TurnKind, TurnStatus } from "@/lib/boards/turnStatus";

export interface StoredSegment {
  id: string;
  orderIndex: number;
  narration: string;
  spokenText: string;
  command: DrawCommand | StoredCommandEnvelope | null;
  audioUrl: string | null;
  /** Submitted recording index; null denotes server-generated ink with no clip. */
  audioRef?: number | null;
  durationMs: number | null;
  timings: AudioTimings | null;
}

export interface StoredTurn {
  id: string;
  orderIndex: number;
  question: string;
  rawResponse: string;
  speedMultiplier: number;
  traceId: string | null;
  sceneDocument: unknown | null;
  sceneEngineVersion: string | null;
  validationReport: unknown | null;
  visualStatus: SceneVisualStatus | null;
  sceneArtifacts: unknown | null;
  segments: StoredSegment[];
  /**
   * live, stopped or complete. Absent on turns built in this tab before a
   * server answer and on legacy fixtures: read it with `storedTurnStatus`.
   * The board GET already reports a live turn idle for over 120 s as stopped.
   */
  status?: TurnStatus;
  /** Raw persisted value, distinct from the idle reader projection. */
  persistedStatus?: TurnStatus;
  /** lesson, doubt or resume. Absent means lesson. */
  kind?: TurnKind;
  /** Last checkpoint time, ms since epoch. */
  updatedAt?: number;
  /** What a later Continue needs (opaque to the server), or null. */
  resumeState?: unknown | null;
}

/** A turn's status, treating unknown or missing as complete (legacy rows). */
export function storedTurnStatus(turn: Pick<StoredTurn, "status" | "updatedAt">, now: number = Date.now()): TurnStatus {
  if (turn.status === undefined) return "complete";
  return effectiveTurnStatus(turn.status, turn.updatedAt ?? null, now);
}

export function storedTurnKind(turn: Pick<StoredTurn, "kind">): TurnKind {
  return turn.kind ?? "lesson";
}

export type SceneVisualStatus = "validated" | "text_only" | "legacy" | "retry_required";

export interface BoardDetail {
  board: BoardEntry;
  turns: StoredTurn[];
}

export async function fetchBoards(): Promise<BoardEntry[]> {
  const boards: BoardEntry[] = [];
  let page = 0;
  // Each response is bounded. The server caps accounts at 200 boards; the
  // extra iteration accommodates pre-migration accounts without an open loop.
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(resolveApiUrl(`/api/boards?page=${page}`));
    if (!res.ok) return boards;
    const data = await res.json() as { boards?: BoardEntry[]; nextPage?: number | null };
    boards.push(...(data.boards ?? []));
    if (typeof data.nextPage !== "number" || data.nextPage <= page) break;
    page = data.nextPage;
  }
  return boards;
}

export async function createBoard(id?: string): Promise<BoardEntry | null> {
  let res: Response;
  try {
    res = await fetch(resolveApiUrl("/api/boards"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(id ? { id } : {}),
      signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(12_000) : undefined,
    });
  } catch {
    return null;
  }

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as { board?: BoardEntry };
  return data.board ?? null;
}

export async function createBoardWithTitle(title: string): Promise<BoardEntry | null> {
  const res = await fetch(resolveApiUrl("/api/boards"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as { board?: BoardEntry };
  return data.board ?? null;
}

/** Same naming path the dashboard uses when a student asks the first question. */
export async function requestBoardTitle(question: string): Promise<string> {
  const fallback = finalizeBoardTitle(question);
  try {
    const response = await fetch(resolveApiUrl("/api/board-name"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!response.ok) {
      return fallback;
    }
    const data = (await response.json()) as { title?: unknown };
    return typeof data.title === "string" && data.title.trim() ? data.title.trim() : fallback;
  } catch {
    return fallback;
  }
}

export async function fetchBoardDetail(boardId: string): Promise<BoardDetail | null> {
  let result: BoardDetail | null = null;
  let page = 0;
  for (let attempt = 0; attempt < 200; attempt++) {
    const res = await fetch(resolveApiUrl(`/api/boards/${boardId}?page=${page}`));
    if (!res.ok) return null;
    const data = await res.json() as BoardDetail & { nextPage?: number | null };
    if (!result) result = { board: data.board, turns: [] };
    result.turns.push(...data.turns.map(sourceCheckedStoredTurn));
    if (typeof data.nextPage !== "number" || data.nextPage <= page) break;
    page = data.nextPage;
  }
  return result;
}

export async function updateBoard(
  boardId: string,
  patch: { title?: string; preview?: string; pinned?: boolean; archived?: boolean },
): Promise<BoardEntry | null> {
  const res = await fetch(resolveApiUrl(`/api/boards/${boardId}`), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as { board?: BoardEntry };
  return data.board ?? null;
}

export async function deleteBoardApi(boardId: string): Promise<boolean> {
  const res = await fetch(resolveApiUrl(`/api/boards/${boardId}`), { method: "DELETE" });
  return res.ok;
}

export interface RecordedSegmentPayload {
  orderIndex: number;
  narration: string;
  spokenText: string;
  command: DrawCommand | StoredCommandEnvelope | null;
  audioBytes: Uint8Array | null;
  durationMs: number | null;
  timings: AudioTimings | null;
}

/** Persist the runtime-owned page transition so restore and replay match live ink. */
export function withBoardEpochSegment(
  segments: RecordedSegmentPayload[],
): RecordedSegmentPayload[] {
  const clearCommand: DrawCommand = {
    type: "CLEAR",
    params: [],
    charPosition: 0,
    narrationBefore: "",
  };
  return [
    {
      orderIndex: 0,
      narration: "",
      spokenText: "",
      command: clearCommand,
      audioBytes: null,
      durationMs: 50,
      timings: null,
    },
    ...segments,
  ].map((segment, orderIndex) => ({ ...segment, orderIndex }));
}

export interface SaveTurnPayload {
  question: string;
  rawResponse: string;
  speedMultiplier: number;
  traceId?: string | null;
  sceneDocument?: unknown | null;
  sceneEngineVersion?: string | null;
  validationReport?: unknown | null;
  visualStatus?: SceneVisualStatus | null;
  sceneArtifacts?: unknown | null;
  segments: RecordedSegmentPayload[];
}

/** Why a save did not land, so the caller can say so instead of failing silently. */
export type SaveFailureReason =
  | "network"
  | "server"
  | "rate_limited"
  | "conflict"
  | "trace_saved"
  | "quota"
  | "too_large"
  | "signed_out"
  | "forbidden"
  | "not_found"
  | "refused"
  | "bad_audio";

export interface SaveFailure {
  ok: false;
  /** HTTP status, or 0 when the request never got an answer. */
  status: number;
  error: string;
  reason: SaveFailureReason;
  /** True when the same request may succeed later (network, 5xx, rate limit, 409 resend). */
  retryable: boolean;
}

export type SaveTurnResult = { ok: true; turn: StoredTurn } | SaveFailure;

export function classifySaveFailure(status: number, body: Record<string, unknown> | null): SaveFailure {
  const error = typeof body?.error === "string" ? body.error : status === 0 ? "network error" : `HTTP ${status}`;
  const fail = (reason: SaveFailureReason, retryable: boolean): SaveFailure => ({ ok: false, status, error, reason, retryable });
  if (status === 0) return fail("network", true);
  if (status >= 500) return fail("server", true);
  if (status === 401) return fail("signed_out", false);
  if (status === 403) return fail("forbidden", false);
  if (status === 404) return fail("not_found", false);
  if (status === 415) return fail("bad_audio", false);
  if (status === 429) return /quota/i.test(error) ? fail("quota", false) : fail("rate_limited", true);
  if (status === 413) return /quota/i.test(error) ? fail("quota", false) : fail("too_large", false);
  if (status === 409) {
    if (body?.code === "trace_saved") return fail("trace_saved", false);
    if (typeof body?.serverCount === "number") return fail("conflict", true);
    if (/expired|canceled/i.test(error)) return fail("server", true);
    return fail("refused", false);
  }
  return fail("refused", false);
}

async function readJsonBody(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = await res.json();
    return typeof data === "object" && data !== null && !Array.isArray(data) ? data as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** One-shot save of a whole turn (legacy `POST /turns`), with a typed outcome. */
export async function saveTurnResult(boardId: string, payload: SaveTurnPayload): Promise<SaveTurnResult> {
  const formData = new FormData();
  formData.append(
    "metadata",
    JSON.stringify({
      question: payload.question,
      rawResponse: payload.rawResponse,
      speedMultiplier: payload.speedMultiplier,
      traceId: payload.traceId ?? undefined,
      sceneDocument: payload.sceneDocument ?? undefined,
      sceneEngineVersion: payload.sceneEngineVersion ?? undefined,
      validationReport: payload.validationReport ?? undefined,
      visualStatus: payload.visualStatus ?? undefined,
      sceneArtifacts: payload.sceneArtifacts ?? undefined,
      segments: payload.segments.map((segment) => ({
        orderIndex: segment.orderIndex,
        narration: segment.narration,
        spokenText: segment.spokenText,
        command: segment.command,
        durationMs: segment.durationMs ?? undefined,
        timings: segment.timings ?? undefined,
      })),
    }),
  );

  for (const segment of payload.segments) {
    if (segment.audioBytes && segment.audioBytes.length > 0) {
      formData.append(
        `audio-${segment.orderIndex}`,
        new Blob([new Uint8Array(segment.audioBytes)], { type: speechAudioMimeType(segment.audioBytes) }),
      );
    }
  }

  const url = resolveApiUrl(`/api/boards/${boardId}/turns`);
  // Keep the logical save's key across retries when a committed response is lost.
  const idempotencyKey = crypto.randomUUID();
  const MAX_SAVE_ATTEMPTS = 3;
  let failure: SaveFailure = classifySaveFailure(0, null);
  for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: formData,
      });
      if (res.ok) {
        const data = (await res.json()) as { turn?: StoredTurn };
        if (data.turn) return { ok: true, turn: data.turn };
        return { ok: false, status: res.status, error: "the server returned no turn", reason: "server", retryable: true };
      }
      const errorText = await res.text().catch(() => "");
      let body: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = JSON.parse(errorText);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
      } catch { /* not JSON */ }
      failure = classifySaveFailure(res.status, body ?? { error: errorText.slice(0, 300) });
      console.error("saveTurn failed", {
        boardId,
        status: res.status,
        attempt,
        error: errorText.slice(0, 300),
      });
      if (res.status < 500 && res.status !== 429) {
        return failure;
      }
    } catch (error) {
      failure = { ...classifySaveFailure(0, null), error: error instanceof Error ? error.message : String(error) };
      console.error("saveTurn network error", {
        boardId,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (attempt < MAX_SAVE_ATTEMPTS) {
      await new Promise((resolve) => {
        setTimeout(resolve, 400 * attempt);
      });
    }
  }
  return failure;
}

/**
 * Backwards compatible wrapper: the saved turn, or null on any failure.
 * Prefer `saveTurnResult`, which says why a save failed.
 */
export async function saveTurn(boardId: string, payload: SaveTurnPayload): Promise<StoredTurn | null> {
  const result = await saveTurnResult(boardId, payload);
  return result.ok ? result.turn : null;
}

// ---------------------------------------------------------------------------
// Progressive save: PUT checkpoints and the keepalive close
// ---------------------------------------------------------------------------

/** The scene a checkpoint states for the rows so far (`PersistedTurnScene` fields). */
export interface CheckpointSceneFields {
  sceneDocument?: unknown | null;
  sceneEngineVersion?: string | null;
  validationReport?: unknown | null;
  visualStatus?: SceneVisualStatus | null;
  sceneArtifacts?: unknown | null;
}

export interface TurnCheckpointInput {
  /** Strictly increasing per turn, starting at 1. A replayed seq returns the stored turn. */
  seq: number;
  status: TurnStatus;
  /** Used when the checkpoint creates the turn. Default lesson. */
  kind?: TurnKind;
  /** Submitted rows the client believes the server holds. */
  baseCount: number;
  /** What the turn is saved as; required on create, omitted for a scene-only update. */
  question?: string;
  /** The page's lesson question, shown in the board list. Used on create. */
  preview?: string;
  /** Narration taught so far; omit to preserve an existing newer header. */
  rawResponse?: string;
  speedMultiplier?: number;
  traceId?: string | null;
  scene: CheckpointSceneFields;
  /** Rows recorded since `baseCount`. Their orderIndex is rewritten to baseCount + k. */
  segments: RecordedSegmentPayload[];
  /** Audio for rows the server already holds without a clip (sent earlier by the keepalive close). */
  lateAudio?: Array<{ orderIndex: number; audioBytes: Uint8Array }>;
  /** Omit to keep the stored state; null clears it. At most 128 KB of JSON. */
  resumeState?: Record<string, unknown> | null;
  /** First creation only: acknowledged same-board chronology anchors. */
  orderBeforeTurnId?: string;
  orderAfterTurnId?: string;
  signal?: AbortSignal;
}

export type TurnCheckpointResult =
  | {
      ok: true;
      turn: StoredTurn;
      /** Submitted rows the server holds; null once the turn is complete. */
      serverCount: number | null;
      serverSeq: number;
      /** Independent scene revision; a metadata-only close does not own it. */
      serverSceneSeq?: number;
      /** The submitted full scene passed canonicalization and was committed. */
      sceneAccepted?: boolean;
      /** The seq was already applied (or the turn is complete): nothing changed. */
      stale: boolean;
      /** The turn is complete; send nothing more for it. */
      final: boolean;
    }
  | (SaveFailure & {
      /** On a 409 conflict: resend rows from here. */
      serverCount?: number | null;
      serverSeq?: number;
      /** On a 409 trace_saved: the turn this lesson is already saved as. */
      turn?: StoredTurn;
    });

function checkpointOutcome(status: number, body: Record<string, unknown> | null): TurnCheckpointResult {
  if (status >= 200 && status < 300 && body && typeof body.turn === "object" && body.turn !== null) {
    return {
      ok: true,
      turn: sourceCheckedStoredTurn(body.turn as StoredTurn),
      serverCount: typeof body.serverCount === "number" ? body.serverCount : null,
      serverSeq: typeof body.serverSeq === "number" ? body.serverSeq : 0,
      ...(typeof body.serverSceneSeq === "number" ? { serverSceneSeq: body.serverSceneSeq } : {}),
      ...(typeof body.sceneAccepted === "boolean" ? { sceneAccepted: body.sceneAccepted } : {}),
      stale: body.stale === true,
      final: body.final === true || (body.turn as StoredTurn).status === "complete",
    };
  }
  const failure = classifySaveFailure(status >= 200 && status < 300 ? 500 : status, body);
  return {
    ...failure,
    ...(typeof body?.serverCount === "number" || body?.serverCount === null ? { serverCount: body.serverCount as number | null } : {}),
    ...(typeof body?.serverSeq === "number" ? { serverSeq: body.serverSeq } : {}),
    ...(typeof body?.turn === "object" && body.turn !== null ? { turn: body.turn as StoredTurn } : {}),
  };
}

function checkpointRows(baseCount: number, segments: RecordedSegmentPayload[]) {
  return segments.map((segment, k) => ({
    orderIndex: baseCount + k,
    narration: segment.narration,
    spokenText: segment.spokenText,
    command: segment.command,
    durationMs: segment.durationMs ?? undefined,
    timings: segment.timings ?? undefined,
  }));
}

/**
 * `PUT /api/boards/{boardId}/turns/{turnId}`. One attempt: the caller owns
 * retries and backoff (see `retryable`). Never throws.
 */
export async function checkpointTurn(
  boardId: string,
  turnId: string,
  input: TurnCheckpointInput,
): Promise<TurnCheckpointResult> {
  const formData = new FormData();
  formData.append("metadata", JSON.stringify({
    seq: input.seq,
    orderBeforeTurnId: input.orderBeforeTurnId,
    orderAfterTurnId: input.orderAfterTurnId,
    status: input.status,
    kind: input.kind ?? "lesson",
    baseCount: input.baseCount,
    question: input.question,
    preview: input.preview,
    rawResponse: input.rawResponse,
    speedMultiplier: input.speedMultiplier,
    traceId: input.traceId ?? undefined,
    sceneDocument: input.scene.sceneDocument ?? undefined,
    sceneEngineVersion: input.scene.sceneEngineVersion ?? undefined,
    validationReport: input.scene.validationReport ?? undefined,
    visualStatus: input.scene.visualStatus ?? undefined,
    sceneArtifacts: input.scene.sceneArtifacts ?? undefined,
    appendSegments: checkpointRows(input.baseCount, input.segments),
    ...(input.resumeState !== undefined ? { resumeState: input.resumeState } : {}),
  }));
  const appendAudio = (index: number, bytes: Uint8Array | null) => {
    if (!bytes || bytes.length === 0) return;
    formData.append(`audio-${index}`, new Blob([new Uint8Array(bytes)], { type: speechAudioMimeType(bytes) }));
  };
  input.segments.forEach((segment, k) => appendAudio(input.baseCount + k, segment.audioBytes));
  for (const late of input.lateAudio ?? []) {
    if (late.orderIndex < input.baseCount) appendAudio(late.orderIndex, late.audioBytes);
  }
  try {
    const res = await fetch(resolveApiUrl(`/api/boards/${boardId}/turns/${turnId}`), {
      method: "PUT",
      body: formData,
      signal: input.signal,
    });
    return checkpointOutcome(res.status, await readJsonBody(res));
  } catch (error) {
    return { ...classifySaveFailure(0, null), error: error instanceof Error ? error.message : String(error) };
  }
}

export interface TurnCloseInput {
  seq: number;
  /** Default stopped. */
  status?: "stopped" | "live";
  traceId?: string | null;
  /** Submitted rows the server is known to hold (acked), so overlap is skipped server side. */
  baseCount: number;
  /** The unsent tail: words and ink only, audio is never sent here. */
  segments?: RecordedSegmentPayload[];
  rawResponse?: string;
  /** Needed when the close creates the turn (it stopped before its first checkpoint). */
  question?: string;
  preview?: string;
  kind?: TurnKind;
  speedMultiplier?: number;
  /** On create only: the plan and the page continuation marker. The turn is saved as text. */
  sceneArtifacts?: unknown | null;
  resumeState?: Record<string, unknown> | null;
  /** First creation only: acknowledged same-board chronology anchors. */
  orderBeforeTurnId?: string;
  orderAfterTurnId?: string;
}

/** Keepalive bodies share a 64 KiB budget with telemetry; the close stays well under it. */
export const KEEPALIVE_CLOSE_MAX_BYTES = 12_000;

/**
 * The close body, shrunk to fit: the full tail first, then without the scene
 * artifacts and resume state, then status only (still with the question, so a
 * turn that never checkpointed is created), then the bare minimum.
 */
export function buildTurnCloseBody(input: TurnCloseInput, maxBytes = KEEPALIVE_CLOSE_MAX_BYTES): string {
  const base = {
    seq: input.seq,
    orderBeforeTurnId: input.orderBeforeTurnId,
    orderAfterTurnId: input.orderAfterTurnId,
    status: input.status ?? "stopped",
    traceId: input.traceId ?? undefined,
    kind: input.kind,
    speedMultiplier: input.speedMultiplier,
  };
  const question = input.question?.slice(0, 2_000);
  const preview = input.preview?.slice(0, 200);
  const rows = input.segments && input.segments.length > 0 ? checkpointRows(input.baseCount, input.segments) : undefined;
  const candidates = [
    { ...base, baseCount: input.baseCount, question, preview, rawResponse: input.rawResponse, appendSegments: rows,
      sceneArtifacts: input.sceneArtifacts ?? undefined, resumeState: input.resumeState },
    { ...base, baseCount: input.baseCount, question, preview, rawResponse: input.rawResponse, appendSegments: rows, resumeState: input.resumeState },
    { ...base, baseCount: input.baseCount, question, preview, rawResponse: input.rawResponse, appendSegments: rows },
    { ...base, baseCount: input.baseCount, question, preview, resumeState: input.resumeState },
    { ...base, baseCount: input.baseCount, question, preview },
    { seq: input.seq, status: base.status, traceId: base.traceId, baseCount: input.baseCount, question: question?.slice(0, 300) },
  ];
  for (const candidate of candidates) {
    const body = JSON.stringify(candidate);
    if (new TextEncoder().encode(body).byteLength <= maxBytes) return body;
  }
  return JSON.stringify(candidates[candidates.length - 1]);
}

/**
 * `PATCH /api/boards/{boardId}/turns/{turnId}` with `keepalive`, for
 * `pagehide`. Send it before the telemetry flush. Resolves with the outcome if
 * the page lives long enough to read it; never throws.
 */
export async function closeTurnKeepalive(
  boardId: string,
  turnId: string,
  input: TurnCloseInput,
  options: { maxBytes?: number } = {},
): Promise<TurnCheckpointResult> {
  try {
    const res = await fetch(resolveApiUrl(`/api/boards/${boardId}/turns/${turnId}`), {
      method: "PATCH",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: buildTurnCloseBody(input, options.maxBytes),
    });
    return checkpointOutcome(res.status, await readJsonBody(res));
  } catch (error) {
    return { ...classifySaveFailure(0, null), error: error instanceof Error ? error.message : String(error) };
  }
}
