/**
 * Progressive turn save. A lesson is saved while it is taught: the browser
 * mints the turn id, the first checkpoint creates the row, and every later one
 * appends the rows recorded since, with their audio, and states the turn's
 * current scene and status.
 *
 * The server keeps the submitted (pre-canonical) rows on the turn and runs the
 * one-shot canonicalizer over all of them on every checkpoint, so each saved
 * state is exactly what the legacy `POST /turns` would store for that row list:
 * same trust rules, same figure intro merge, same CLEAR rule.
 *
 * Order and idempotency: `seq` strictly owns newer headers. A stale live
 * replay returns the stored turn before upload. After Stop, an older request
 * may recover missing rows/audio under the stored header; complete is final.
 * `baseCount` must equal the submitted rows the server holds, else 409 with
 * the server's count so the client resends from there.
 *
 * Audio: each request attempt uploads under its own folder
 * (`lectures/{board}/{turn}/{attempt}/{submittedIndex}.mp3`), and its cleanup
 * intent covers that folder only, so abandoning a retry never deletes a clip
 * an earlier checkpoint committed.
 */
import { Prisma, type Segment, type Turn } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  isStoredCommandTrustedGeometry,
  parseStoredSegmentCommands,
  serializeSegmentCommands,
  type DrawCommand,
} from "@heytutor/drawing";
import { buildSolverAuthorityProjection } from "@heytutor/scene-engine";
import { ensureUser, getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { checkpointAttemptPrefix, checkpointAudioKey } from "@/lib/object-store/keys";
import { uploadAudio } from "@/lib/object-store/s3";
import { readBoundedFormData, readBoundedJson, RequestBodyError } from "@/lib/http/requestBody";
import {
  abandonTurnStorage,
  reserveTurnGrowthStorage,
  reserveTurnStorage,
  settleTurnStorage,
  StorageQuotaError,
  withUserStorageLock,
  type TurnStorageReservation,
} from "@/lib/boards/storageQuota";
import { assertOwnedTrace } from "@/lib/obs/traceOwnership";
import { canonicalizeTurnSceneMetadata, type CanonicalTurnSceneMetadata } from "@/lib/scene/turnScenePersistence";
import {
  audioPrefixMatchesType,
  validateCheckpointUploadParts,
  validateTurnUploadHeaders,
  MAX_TURN_AUDIO_TOTAL_BYTES,
  MAX_TURN_MERGED_METADATA_BYTES,
  MAX_TURN_SEGMENTS,
  MAX_TURN_UPLOAD_BYTES,
} from "@/lib/scene/turnUploadLimits";
import {
  isTurnKind,
  isTurnStatus,
  nextTurnStatus,
  type TurnKind,
  type TurnStatus,
} from "@/lib/boards/turnStatus";

/** The keepalive close carries words and ink only; browsers cap keepalive bodies at 64 KiB in total. */
export const MAX_CLOSE_BODY_BYTES = 16 * 1024;
export const MAX_RESUME_STATE_BYTES = 128 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Allowance for the audio URL each new clip adds to the stored JSON. */
const AUDIO_REF_BYTES = 256;
const VISUAL_STATUSES = new Set(["validated", "text_only", "legacy", "retry_required"]);
/** Pointing that names parts of a scene; a text only save has no scene to name. */
const SCENE_POINTING = new Set<DrawCommand["type"]>(["POINT", "FOCUS", "FRAME", "ANNOTATE"]);

type VisualStatus = "validated" | "text_only" | "legacy" | "retry_required";

export interface CheckpointRow {
  orderIndex: number;
  narration: string;
  spokenText: string;
  command: unknown;
  durationMs?: number;
  timings?: unknown;
}

/** A submitted row as the server keeps it: the row plus the clip it owns. */
interface HeldRow extends CheckpointRow {
  audioUrl?: string | null;
  audioFormat?: string | null;
}

interface CheckpointScene {
  sceneDocument?: unknown;
  sceneEngineVersion?: string | null;
  validationReport?: unknown;
  visualStatus?: VisualStatus | null;
  sceneArtifacts?: unknown;
}

interface CheckpointInput {
  seq: number;
  status: TurnStatus;
  kind: TurnKind;
  baseCount: number;
  question?: string;
  preview?: string;
  rawResponse?: string;
  speedMultiplier?: number;
  traceId?: string;
  orderBeforeTurnId?: string;
  orderAfterTurnId?: string;
  /** "stored": re-canonicalize under the turn's stored scene (keepalive close). */
  scene: CheckpointScene | "stored";
  appendSegments: CheckpointRow[];
  /** undefined keeps the stored state, null clears it. */
  resumeState: Prisma.InputJsonValue | null | undefined;
  /** The keepalive close skips rows the server already holds instead of refusing. */
  tolerateOverlap: boolean;
}

interface RouteParams {
  boardId: string;
  turnId: string;
}

type TurnWithSegments = Turn & { segments: Segment[] };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableJson(value: unknown): Prisma.InputJsonValue | Prisma.NullTypes.DbNull {
  return value == null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength;
}

function attemptDirName(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

/** Private checkpoint state; board readers omit this JSON column. */
function heldRows(turn: Pick<Turn, "submittedSegments"> | null): HeldRow[] {
  const stored = turn?.submittedSegments;
  if (Array.isArray(stored)) return stored as unknown as HeldRow[];
  return isRecord(stored) && stored.v === 1 && Array.isArray(stored.rows) ? stored.rows as unknown as HeldRow[] : [];
}

function heldSceneSeq(turn: Pick<Turn, "submittedSegments" | "checkpointSeq"> | null): number {
  const stored = turn?.submittedSegments;
  if (isRecord(stored) && stored.v === 1 && Number.isSafeInteger(stored.sceneSeq) &&
    (stored.sceneSeq as number) >= 0 && (stored.sceneSeq as number) <= turn!.checkpointSeq) return stored.sceneSeq as number;
  // Legacy rows do not say whether the last write carried a scene. Never
  // infer permission to replace their scene from an older request.
  return turn?.checkpointSeq ?? 0;
}

function heldCheckpoint(rows: HeldRow[], sceneSeq: number) {
  return { v: 1, sceneSeq, rows };
}

function hasNewerCheckpointScene(turn: Turn, input: CheckpointInput): boolean {
  return !input.tolerateOverlap && input.scene !== "stored" && input.seq > heldSceneSeq(turn);
}

function stableJson(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, nested: unknown) => isRecord(nested)
    ? Object.fromEntries(Object.keys(nested).sort().map(key => [key, nested[key]])) : nested);
}

/** A delayed scene cannot be paired with a different, newer solver binding. */
function sceneMatchesResumeAuthority(scene: CanonicalTurnSceneMetadata, resumeState: unknown): boolean {
  const projection = isRecord(resumeState) && resumeState.v === 1 ? resumeState.solverProjection : null;
  if (projection == null || scene.visualStatus !== "validated") return true;
  const artifacts = scene.sceneArtifacts;
  if (!artifacts?.problemIR || !artifacts.solverResult || !artifacts.solverAuthority) return false;
  const canonicalProjection = buildSolverAuthorityProjection(artifacts.problemIR, artifacts.solverResult, artifacts.solverAuthority);
  return stableJson(projection) === stableJson(canonicalProjection);
}

function hasMissingCheckpointPayload(turn: Turn, input: CheckpointInput, files: Map<number, File>): boolean {
  const held = heldRows(turn);
  return input.appendSegments.some((row) => row.orderIndex >= held.length) ||
    [...files].some(([index, file]) => file.size > 0 && index < held.length && !held[index]?.audioUrl);
}

/** Serialized like the board GET turn, plus the checkpoint bookkeeping. */
export function checkpointTurnJson(turn: Turn, segments: Segment[]) {
  return {
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
    status: isTurnStatus(turn.status) ? turn.status : "complete",
    persistedStatus: isTurnStatus(turn.status) ? turn.status : "complete",
    kind: isTurnKind(turn.kind) ? turn.kind : "lesson",
    resumeState: turn.resumeState ?? null,
    createdAt: turn.createdAt.getTime(),
    updatedAt: (turn.updatedAt ?? turn.createdAt).getTime(),
    segments: [...segments]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((segment) => ({
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
  };
}

function turnBody(turn: TurnWithSegments, extra: Record<string, unknown> = {}) {
  return {
    turn: checkpointTurnJson(turn, turn.segments),
    serverCount: turn.submittedSegments == null ? null : heldRows(turn).length,
    serverSeq: turn.checkpointSeq,
    serverSceneSeq: heldSceneSeq(turn),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function parseRows(value: unknown, baseCount: number): Parsed<CheckpointRow[]> {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, error: "appendSegments must be an array" };
  if (value.length > MAX_TURN_SEGMENTS) return { ok: false, error: "turn has too many segments" };
  const rows: CheckpointRow[] = [];
  for (const [k, raw] of value.entries()) {
    if (!isRecord(raw)) return { ok: false, error: "each appended segment must be an object" };
    if (raw.orderIndex !== baseCount + k) {
      return { ok: false, error: "appended segment order indexes must continue from baseCount" };
    }
    const narration = raw.narration ?? "";
    const spokenText = raw.spokenText ?? "";
    if (typeof narration !== "string" || narration.length > 12_000 ||
      typeof spokenText !== "string" || spokenText.length > 12_000 ||
      (raw.durationMs != null && (typeof raw.durationMs !== "number" || !Number.isFinite(raw.durationMs) ||
        raw.durationMs < 0 || raw.durationMs > 600_000))) {
      return { ok: false, error: "invalid or oversized segment fields" };
    }
    rows.push({
      orderIndex: baseCount + k,
      narration,
      spokenText,
      command: raw.command ?? null,
      ...(raw.durationMs != null ? { durationMs: raw.durationMs as number } : {}),
      ...(raw.timings != null ? { timings: raw.timings } : {}),
    });
  }
  return { ok: true, value: rows };
}

function parseCommon(raw: Record<string, unknown>, mode: "put" | "patch"): Parsed<Omit<CheckpointInput, "scene" | "tolerateOverlap">> {
  const seq = raw.seq;
  if (!Number.isSafeInteger(seq) || (seq as number) < 1 || (seq as number) > 1_000_000) {
    return { ok: false, error: "seq must be a positive integer" };
  }
  const status = raw.status;
  if (!isTurnStatus(status) || (mode === "patch" && status === "complete")) {
    return { ok: false, error: mode === "patch" ? "status must be live or stopped" : "status must be live, stopped or complete" };
  }
  if (raw.kind !== undefined && !isTurnKind(raw.kind)) return { ok: false, error: "kind must be lesson, doubt or resume" };
  for (const name of ["orderBeforeTurnId", "orderAfterTurnId"] as const) {
    if (raw[name] !== undefined && (typeof raw[name] !== "string" || !UUID.test(raw[name]))) return { ok: false, error: "invalid ordering anchor" };
  }
  const rowsPresent = Array.isArray(raw.appendSegments) && raw.appendSegments.length > 0;
  const baseCount = raw.baseCount === undefined && mode === "patch" && !rowsPresent ? 0 : raw.baseCount;
  if (!Number.isSafeInteger(baseCount) || (baseCount as number) < 0 || (baseCount as number) > MAX_TURN_SEGMENTS) {
    return { ok: false, error: "baseCount must be a non-negative integer" };
  }
  if ((raw.question !== undefined && (typeof raw.question !== "string" || raw.question.length > 12_000)) ||
    (raw.preview !== undefined && (typeof raw.preview !== "string" || raw.preview.length > 2_000)) ||
    (raw.rawResponse !== undefined && (typeof raw.rawResponse !== "string" || raw.rawResponse.length > 100_000)) ||
    (raw.traceId !== undefined && (typeof raw.traceId !== "string" || raw.traceId.length > 128)) ||
    (raw.speedMultiplier !== undefined && (typeof raw.speedMultiplier !== "number" ||
      !Number.isFinite(raw.speedMultiplier) || raw.speedMultiplier < 0.25 || raw.speedMultiplier > 4))) {
    return { ok: false, error: "invalid or oversized turn fields" };
  }
  let resumeState: Prisma.InputJsonValue | null | undefined;
  if (raw.resumeState === null) resumeState = null;
  else if (raw.resumeState !== undefined) {
    if (!isRecord(raw.resumeState)) return { ok: false, error: "resumeState must be an object" };
    if (utf8Bytes(raw.resumeState) > MAX_RESUME_STATE_BYTES) return { ok: false, error: "resumeState exceeds its size limit" };
    resumeState = raw.resumeState as Prisma.InputJsonValue;
  }
  const rows = parseRows(raw.appendSegments, baseCount as number);
  if (!rows.ok) return rows;
  return {
    ok: true,
    value: {
      seq: seq as number,
      status,
      kind: isTurnKind(raw.kind) ? raw.kind : "lesson",
      baseCount: baseCount as number,
      question: raw.question as string | undefined,
      preview: raw.preview as string | undefined,
      rawResponse: raw.rawResponse as string | undefined,
      speedMultiplier: raw.speedMultiplier as number | undefined,
      traceId: raw.traceId as string | undefined,
      orderBeforeTurnId: raw.orderBeforeTurnId as string | undefined,
      orderAfterTurnId: raw.orderAfterTurnId as string | undefined,
      appendSegments: rows.value,
      resumeState,
    },
  };
}

function parseScene(raw: Record<string, unknown>): Parsed<CheckpointScene> {
  if (raw.visualStatus != null && !VISUAL_STATUSES.has(raw.visualStatus as string)) {
    return { ok: false, error: "invalid visualStatus" };
  }
  if (raw.sceneEngineVersion != null && (typeof raw.sceneEngineVersion !== "string" || raw.sceneEngineVersion.length > 64)) {
    return { ok: false, error: "invalid sceneEngineVersion" };
  }
  return {
    ok: true,
    value: {
      sceneDocument: raw.sceneDocument,
      sceneEngineVersion: (raw.sceneEngineVersion as string | null | undefined) ?? null,
      validationReport: raw.validationReport,
      visualStatus: (raw.visualStatus as VisualStatus | null | undefined) ?? null,
      sceneArtifacts: raw.sceneArtifacts,
    },
  };
}

// ---------------------------------------------------------------------------
// Canonical rows
// ---------------------------------------------------------------------------

/**
 * The rows a turn keeps when its scene is not a validated figure: words and
 * rows survive, the figure's ink and every pointing at it go. Mirrors the
 * browser's `partialTurnSegments`. The server needs it too because it holds
 * rows a validated scene accepted earlier; a later text-only checkpoint (the
 * client's fallback when a figure is refused) must not be refused for them.
 * It only drops what the text-only canonicalizer would refuse.
 */
export function stripSceneInk<T extends CheckpointRow>(rows: readonly T[]): T[] {
  const kept: T[] = [];
  for (const row of rows) {
    if (isStoredCommandTrustedGeometry(row.command)) continue;
    const commands = parseStoredSegmentCommands(row.command);
    const allowed = commands.filter((command) => !SCENE_POINTING.has(command.type));
    if (allowed.length === commands.length) {
      kept.push(row);
      continue;
    }
    if (allowed.length === 0 && !row.narration.trim()) continue;
    kept.push({ ...row, command: allowed.length > 0 ? serializeSegmentCommands(allowed) : null });
  }
  return kept;
}

function sceneOf(turn: Turn): CheckpointScene {
  return {
    sceneDocument: turn.sceneDocument ?? undefined,
    sceneEngineVersion: turn.sceneEngineVersion,
    validationReport: turn.validationReport ?? undefined,
    visualStatus: (VISUAL_STATUSES.has(turn.visualStatus ?? "") ? turn.visualStatus : null) as VisualStatus | null,
    sceneArtifacts: turn.sceneArtifacts ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function authorize(boardId: string, turnId: string): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const userId = await getUserId();
  if (!userId) return { ok: false, response: json({ error: "unauthorized" }, 401) };
  if (!UUID.test(turnId)) return { ok: false, response: json({ error: "turn id must be a UUID" }, 400) };
  await ensureUser(userId);
  const board = await prisma.board.findFirst({ where: { id: boardId, userId } });
  if (!board) return { ok: false, response: json({ error: "not found" }, 404) };
  return { ok: true, userId };
}

/** `PUT /api/boards/{boardId}/turns/{turnId}`: multipart `metadata` plus `audio-{i}` parts. */
export async function handleTurnCheckpoint(request: Request, params: RouteParams): Promise<Response> {
  const preflight = validateTurnUploadHeaders(request.headers);
  if (!preflight.ok) return json({ error: preflight.error }, preflight.status);
  const auth = await authorize(params.boardId, params.turnId);
  if (!auth.ok) return auth.response;

  let formData: FormData;
  try {
    formData = await readBoundedFormData(request, MAX_TURN_UPLOAD_BYTES);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "invalid multipart form data" },
      error instanceof RequestBodyError ? error.status : 400);
  }
  const metadataRaw = formData.get("metadata");
  if (typeof metadataRaw !== "string") return json({ error: "metadata required" }, 400);
  const parts = validateCheckpointUploadParts(formData, metadataRaw);
  if (!parts.ok) return json({ error: parts.error }, parts.status);
  let raw: unknown;
  try {
    raw = JSON.parse(metadataRaw);
  } catch {
    return json({ error: "invalid metadata json" }, 400);
  }
  if (!isRecord(raw)) return json({ error: "invalid metadata" }, 400);
  const common = parseCommon(raw, "put");
  if (!common.ok) return json({ error: common.error }, 400);
  const scene = parseScene(raw);
  if (!scene.ok) return json({ error: scene.error }, 400);

  const files = new Map<number, File>();
  for (const [name, value] of formData.entries()) {
    if (name !== "metadata" && value instanceof File) files.set(Number(name.slice("audio-".length)), value);
  }
  return applyCheckpoint(request, auth.userId, params, {
    ...common.value,
    scene: scene.value,
    tolerateOverlap: false,
  }, files);
}

/**
 * `PATCH /api/boards/{boardId}/turns/{turnId}`: the small keepalive close sent
 * on `pagehide`. JSON only, never audio. With no rows it only moves a live turn
 * to stopped and keeps `seq`, so a later checkpoint with `seq = last + 1` still
 * applies. With rows (the unsent tail, words and ink) it appends them under the
 * turn's stored scene and takes `seq`.
 */
export async function handleTurnClose(request: Request, params: RouteParams): Promise<Response> {
  const auth = await authorize(params.boardId, params.turnId);
  if (!auth.ok) return auth.response;
  let raw: unknown;
  try {
    raw = await readBoundedJson(request, MAX_CLOSE_BODY_BYTES);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "invalid json" },
      error instanceof RequestBodyError ? error.status : 400);
  }
  if (!isRecord(raw)) return json({ error: "invalid close body" }, 400);
  const common = parseCommon(raw, "patch");
  if (!common.ok) return json({ error: common.error }, 400);
  // A close that creates the turn saves it as text: the figure never committed
  // on this tab's checkpoints, and the body has no room for a scene. Its
  // artifacts may still carry the plan and the page continuation marker.
  const createScene: CheckpointScene = {
    visualStatus: "text_only",
    sceneArtifacts: isRecord(raw.sceneArtifacts) ? raw.sceneArtifacts : undefined,
  };
  const existing = await prisma.turn.findFirst({ where: { id: params.turnId } });
  if (existing && (existing.userId !== auth.userId || existing.boardId !== params.boardId)) {
    return json({ error: "not found" }, 404);
  }
  if (!existing && !common.value.question?.trim()) return json({ error: "turn not found" }, 404);
  if (existing && common.value.appendSegments.length === 0) {
    return closeStatusOnly(request, auth.userId, params, existing, common.value);
  }
  return applyCheckpoint(request, auth.userId, params, {
    ...common.value,
    scene: existing ? "stored" : createScene,
    tolerateOverlap: true,
  }, new Map());
}

async function ownedTraceAllowed(userId: string, boardId: string, traceId: string | undefined): Promise<boolean> {
  return Boolean(traceId) && await assertOwnedTrace(userId, traceId!, boardId);
}

async function closeStatusOnly(
  request: Request,
  userId: string,
  params: RouteParams,
  existing: Turn,
  input: Omit<CheckpointInput, "scene" | "tolerateOverlap">,
): Promise<Response> {
  // New metadata has the same canonical byte budget/quota as a full save.
  // Only a status-only or stale-header close may skip that charged path.
  // Legacy rows also need their existing scene receipt envelope accounted.
  if (Array.isArray(existing.submittedSegments) || (input.seq > existing.checkpointSeq &&
    (input.rawResponse !== undefined || input.resumeState !== undefined))) {
    return applyCheckpoint(request, userId, params, {
      ...input, baseCount: heldRows(existing).length, appendSegments: [],
      scene: "stored", tolerateOverlap: true,
    }, new Map());
  }
  const production = process.env.NODE_ENV === "production";
  if (production && !await ownedTraceAllowed(userId, params.boardId, input.traceId ?? existing.traceId ?? undefined)) {
    return json({ error: "an authorized lesson save allowance is required" }, 403);
  }
  if (existing.traceId && input.traceId && existing.traceId !== input.traceId) {
    return json({ error: "trace does not match the saved turn" }, 409);
  }
  try {
    const turn = await withUserStorageLock(userId, async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT 1 FROM "boards" WHERE "id" = ${params.boardId} AND user_id = ${userId} FOR UPDATE`;
      if (!locked.length) throw new StorageQuotaError("board not found", 404);
      const current = await tx.turn.findFirst({ where: { id: params.turnId, userId, boardId: params.boardId } });
      if (!current) throw new StorageQuotaError("turn not found", 404);
      const currentStatus = isTurnStatus(current.status) ? current.status : "complete";
      if (currentStatus === "complete") return current;
      const status = nextTurnStatus(currentStatus, input.status);
      const ownsMetadata = input.seq > current.checkpointSeq;
      const hasMetadata = input.rawResponse !== undefined || input.resumeState !== undefined;
      return tx.turn.update({
        where: { id: current.id },
        data: {
          status,
          ...(ownsMetadata && input.rawResponse !== undefined ? { rawResponse: input.rawResponse } : {}),
          ...(ownsMetadata && input.resumeState !== undefined ? { resumeState: nullableJson(input.resumeState) } : {}),
          ...(ownsMetadata && hasMetadata ? { checkpointSeq: input.seq } : {}),
        },
      });
    });
    const segments = await prisma.segment.findMany({ where: { turnId: turn.id }, orderBy: { orderIndex: "asc" } });
    return json(turnBody({ ...turn, segments }));
  } catch (error) {
    if (error instanceof StorageQuotaError) return json({ error: error.message }, error.status);
    throw error;
  }
}

type CommitOutcome =
  | { kind: "saved"; turn: TurnWithSegments; sceneAccepted: boolean }
  | { kind: "stale"; turn: TurnWithSegments }
  | { kind: "final"; turn: TurnWithSegments }
  | { kind: "retry_stopped" }
  | { kind: "conflict"; serverCount: number; serverSeq: number }
  | { kind: "trace_saved"; turn: TurnWithSegments };

async function applyCheckpoint(
  request: Request,
  userId: string,
  { boardId, turnId }: RouteParams,
  input: CheckpointInput,
  files: Map<number, File>,
  stoppedRetries = 0,
): Promise<Response> {
  const production = process.env.NODE_ENV === "production";

  // --- Trace: one turn per lesson trace ------------------------------------
  const before = await prisma.turn.findFirst({
    where: { id: turnId },
    include: { segments: { orderBy: { orderIndex: "asc" } } },
  });
  if (before && (before.userId !== userId || before.boardId !== boardId)) return json({ error: "not found" }, 404);
  if (!before && !input.tolerateOverlap && (input.question === undefined || input.rawResponse === undefined)) {
    return json({ error: "question and rawResponse are required to create a checkpoint" }, 400);
  }
  const traceId = input.traceId ?? before?.traceId ?? undefined;
  if (before?.traceId && input.traceId && before.traceId !== input.traceId) {
    return json({ error: "trace does not match the saved turn" }, 409);
  }
  if (production) {
    if (!await ownedTraceAllowed(userId, boardId, traceId)) {
      return json({ error: "an authorized lesson save allowance is required" }, 403);
    }
    if (!before) {
      const allowance = await prisma.ownedTrace.findUnique({ where: { traceId: traceId! } });
      if (allowance?.savedTurnId && allowance.savedTurnId !== turnId) {
        const saved = await prisma.turn.findFirst({
          where: { id: allowance.savedTurnId, userId, boardId },
          include: { segments: { orderBy: { orderIndex: "asc" } } },
        });
        if (saved) return json({ error: "this lesson is already saved as another turn", code: "trace_saved", ...turnBody(saved) }, 409);
        return json({ error: "lesson save allowance has already been used" }, 409);
      }
    }
  }

  // --- Order and idempotency, before any upload ----------------------------
  const stored = heldRows(before);
  const beforeStatus: TurnStatus | null = before ? (isTurnStatus(before.status) ? before.status : "complete") : null;
  if (before && beforeStatus === "complete") return json(turnBody(before, { stale: true, final: true }));
  // A metadata close may arrive before an older in-flight row/audio PUT.
  // Recover only missing rows/clips of a stopped turn, never its old header.
  const lateStoppedRows = Boolean(before && beforeStatus === "stopped" && input.seq <= before.checkpointSeq &&
    (hasMissingCheckpointPayload(before, input, files) || hasNewerCheckpointScene(before, input)));
  const tolerateOverlap = input.tolerateOverlap || lateStoppedRows;
  let append = input.appendSegments;
  if (before && input.seq <= before.checkpointSeq && !tolerateOverlap) {
    return json(turnBody(before, { stale: true }));
  }
  if (input.baseCount !== stored.length) {
    const overlap = tolerateOverlap && input.baseCount < stored.length;
    // A close whose tail starts past the saved rows (a checkpoint still in
    // flight) cannot append, but still stops the turn. Its body reports the
    // server's count.
    if (input.tolerateOverlap && before && !overlap) {
      return closeStatusOnly(request, userId, { boardId, turnId }, before, input);
    }
    if (!overlap) return json({ error: "checkpoint does not continue the saved rows", serverCount: stored.length, serverSeq: before?.checkpointSeq ?? 0 }, 409);
    append = append.filter((row) => row.orderIndex >= stored.length);
  }
  const seq = Math.max(input.seq, before?.checkpointSeq ?? 0);
  if (before && input.tolerateOverlap && append.length === 0 && !Array.isArray(before.submittedSegments) &&
    (input.seq <= before.checkpointSeq || (input.rawResponse === undefined && input.resumeState === undefined))) {
    return closeStatusOnly(request, userId, { boardId, turnId }, before, input);
  }

  // --- What the turn becomes -------------------------------------------------
  const ownsMetadata = !before || input.seq > before.checkpointSeq;
  const question = ownsMetadata ? input.question ?? before?.question ?? "" : before!.question;
  if (!question.trim()) return json({ error: "question is required" }, 400);
  const rawResponse = ownsMetadata ? input.rawResponse ?? before?.rawResponse ?? "" : before!.rawResponse;
  const status = before ? nextTurnStatus(beforeStatus!, input.status) : input.status;
  let ownsScene = !input.tolerateOverlap && input.scene !== "stored" && (!before || input.seq > heldSceneSeq(before));
  const scene = before && !ownsScene ? sceneOf(before) : input.scene === "stored" ? sceneOf(before!) : input.scene;
  if (status === "complete" && !rawResponse.trim() &&
    !(scene.visualStatus === "retry_required" && scene.sceneArtifacts != null)) {
    return json({ error: "question and rawResponse required unless persisting a required-diagram failure" }, 400);
  }

  const merged: HeldRow[] = [...stored, ...append];
  if (merged.length > MAX_TURN_SEGMENTS) return json({ error: "turn has too many segments" }, 413);

  // Audio parts: new rows, or late audio for a held row that has none yet.
  const uploads = new Map<number, File>();
  for (const [index, file] of files) {
    if (file.size === 0) continue;
    const target = merged[index];
    if (!target) return json({ error: `audio part audio-${index} has no matching segment` }, 400);
    if (index < stored.length && target.audioUrl) continue;
    uploads.set(index, file);
  }
  for (const file of uploads.values()) {
    const prefix = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (!audioPrefixMatchesType(file.type, prefix)) {
      return json({ error: "audio content does not match its declared format" }, 415);
    }
  }
  const newAudioBytes = [...uploads.values()].reduce((sum, file) => sum + file.size, 0);
  const chargedAudio = before ? Number(before.storageBytes - before.metadataBytes) : 0;
  if (Math.max(0, chargedAudio) + newAudioBytes > MAX_TURN_AUDIO_TOTAL_BYTES) {
    return json({ error: "turn audio exceeds the total size limit" }, 413);
  }

  const canonicalRowsFor = (selected: CheckpointScene) => (selected.visualStatus === "validated" ? merged : stripSceneInk(merged))
    .map((row): CheckpointRow => ({
      orderIndex: row.orderIndex,
      narration: row.narration,
      spokenText: row.spokenText,
      command: row.command,
      ...(row.durationMs != null ? { durationMs: row.durationMs } : {}),
      ...(row.timings != null ? { timings: row.timings } : {}),
    }));
  const header = { question, rawResponse, ...scene };
  if (utf8Bytes({ ...header, segments: merged }) > MAX_TURN_MERGED_METADATA_BYTES) {
    return json({ error: "turn metadata exceeds the size limit" }, 413);
  }
  let canonical = await canonicalizeTurnSceneMetadata({ ...header, question, segments: canonicalRowsFor(scene) });
  if (!canonical.ok) return json({ error: `scene persistence rejected: ${canonical.error}` }, 400);
  const resumeState = ownsMetadata && input.resumeState !== undefined ? input.resumeState : (before?.resumeState ?? null);
  const sceneOnlyRepair = before && input.question === undefined && input.rawResponse === undefined && input.resumeState === undefined;
  if (ownsScene && before && (!ownsMetadata || sceneOnlyRepair) && !sceneMatchesResumeAuthority(canonical.value, resumeState)) {
    if (ownsMetadata) return json({ error: "scene persistence rejected: scene disagrees with the current resume authority" }, 400);
    // Keep the rescued payload and newer header, but do not acknowledge this
    // scene. A surviving producer must submit a fresh, coherent scene.
    ownsScene = false;
    const storedScene = sceneOf(before);
    canonical = await canonicalizeTurnSceneMetadata({ question, ...storedScene, segments: canonicalRowsFor(storedScene) });
    if (!canonical.ok) return json({ error: `scene persistence rejected: ${canonical.error}` }, 400);
  }
  const sceneSeq = ownsScene ? input.seq : heldSceneSeq(before);
  const canonicalRows = canonical.value.segments.map((row, orderIndex) => ({ ...row, orderIndex }));
  const metadataBytes = utf8Bytes({
    question, rawResponse, ...canonical.value, segments: canonicalRows,
    submitted: status === "complete" ? null : heldCheckpoint(merged, sceneSeq), resumeState,
  }) + uploads.size * AUDIO_REF_BYTES * 2;
  const metadataGrowth = before ? Math.max(0, metadataBytes - Number(before.metadataBytes)) : metadataBytes;
  const chargeBytes = metadataGrowth + newAudioBytes;

  // --- Reserve, upload, commit ---------------------------------------------
  const attemptDir = attemptDirName();
  const prefix = checkpointAttemptPrefix(boardId, turnId, attemptDir);
  let reservation: TurnStorageReservation | null = null;
  try {
    if (!before) {
      reservation = await reserveTurnStorage({ userId, boardId, turnId, bytes: chargeBytes, prefix });
    } else if (chargeBytes > 0 || uploads.size > 0) {
      reservation = await reserveTurnGrowthStorage({ userId, boardId, turnId, bytes: chargeBytes, prefix });
    }
  } catch (error) {
    if (error instanceof StorageQuotaError) return json({ error: error.message }, error.status);
    throw error;
  }

  let settled = false;
  const uploadSignal = AbortSignal.any([request.signal, AbortSignal.timeout(10 * 60_000)]);
  try {
    const uploaded = new Map<number, { url: string | null; format: string }>();
    for (const [index, file] of [...uploads].sort((a, b) => a[0] - b[0])) {
      if (uploadSignal.aborted) throw new StorageQuotaError("turn upload canceled or expired", 409);
      const key = checkpointAudioKey(boardId, turnId, attemptDir, index, file.type);
      const url = await uploadAudio(key, new Uint8Array(await file.arrayBuffer()), file.type, uploadSignal);
      uploaded.set(index, { url, format: file.type });
    }
    if (uploadSignal.aborted) throw new StorageQuotaError("turn upload canceled or expired", 409);
    const held: HeldRow[] = merged.map((row, index) => {
      const clip = uploaded.get(index);
      return clip ? { ...row, audioUrl: clip.url, audioFormat: clip.format } : row;
    });
    const segmentValues = canonicalRows.map((row) => {
      const source = typeof row.sourceOrderIndex === "number" ? row.sourceOrderIndex : null;
      const clip = source === null ? null : held[source];
      return {
        turnId,
        orderIndex: row.orderIndex,
        narration: row.narration ?? "",
        spokenText: row.spokenText ?? "",
        command: row.command == null ? undefined : (row.command as Prisma.InputJsonValue),
        audioUrl: clip?.audioUrl ?? null,
        audioFormat: clip?.audioFormat ?? "audio/mpeg",
        audioRef: source,
        durationMs: row.durationMs ?? null,
        timings: row.timings == null ? undefined : (row.timings as Prisma.InputJsonValue),
      };
    });

    let outcome: CommitOutcome | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3 && !outcome; attempt += 1) {
      try {
        outcome = await withUserStorageLock(userId, async (tx): Promise<CommitOutcome> => {
          const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT 1 FROM "boards" WHERE "id" = ${boardId} AND user_id = ${userId} FOR UPDATE`;
          if (!locked.length) throw new StorageQuotaError("board not found", 404);
          const current = await tx.turn.findFirst({
            where: { id: turnId },
            include: { segments: { orderBy: { orderIndex: "asc" } } },
          });
          const release = async () => { if (reservation) await abandonTurnStorage(reservation, tx); };
          if (current && (current.userId !== userId || current.boardId !== boardId)) {
            throw new StorageQuotaError("turn not found", 404);
          }
          if (!current && before) throw new StorageQuotaError("turn not found", 404);
          if (current) {
            if (current.status === "complete") { await release(); return { kind: "final", turn: current }; }
            if (input.seq <= current.checkpointSeq && !tolerateOverlap) {
              await release();
              // A newer close may have committed while this clip uploaded.
              // Re-read/canonicalize the missing payload under its newer header.
              return current.status === "stopped" && stoppedRetries < 2 && (hasMissingCheckpointPayload(current, input, files) || hasNewerCheckpointScene(current, input))
                ? { kind: "retry_stopped" } : { kind: "stale", turn: current };
            }
            // Anything committed since this request read the turn means the
            // canonical rows above were built on an old state: resend.
            if (heldRows(current).length !== stored.length || current.checkpointSeq !== (before?.checkpointSeq ?? 0) || heldSceneSeq(current) !== heldSceneSeq(before)) {
              await release();
              if (stoppedRetries < 2 && ((current.status === "stopped" &&
                (hasMissingCheckpointPayload(current, input, files) || hasNewerCheckpointScene(current, input))) ||
                (input.tolerateOverlap && input.appendSegments.length === 0))) {
                // A metadata-only close can race a later row checkpoint. Re-read
                // its header/rows before charging, but still honour Stop.
                return { kind: "retry_stopped" };
              }
              return { kind: "conflict", serverCount: heldRows(current).length, serverSeq: current.checkpointSeq };
            }
          }
          const finalStatus = current ? nextTurnStatus(isTurnStatus(current.status) ? current.status : "complete", status) : status;
          const turnData = {
            question,
            rawResponse,
            ...(ownsMetadata && input.speedMultiplier !== undefined ? { speedMultiplier: input.speedMultiplier } : {}),
            sceneDocument: nullableJson(canonical.value.sceneDocument),
            sceneEngineVersion: canonical.value.sceneEngineVersion,
            validationReport: nullableJson(canonical.value.validationReport),
            visualStatus: canonical.value.visualStatus,
            sceneArtifacts: nullableJson(canonical.value.sceneArtifacts),
            status: finalStatus,
            checkpointSeq: seq,
            submittedSegments: finalStatus === "complete" ? Prisma.DbNull : (heldCheckpoint(held, sceneSeq) as unknown as Prisma.InputJsonValue),
            resumeState: nullableJson(resumeState),
          };
          let turn: Turn;
          if (!current) {
            if (production) {
              const allowance = await tx.ownedTrace.findUnique({ where: { traceId: traceId! } });
              if (!allowance || allowance.userId !== userId || allowance.expiresAt <= new Date()) {
                throw new StorageQuotaError("lesson save allowance expired or is not owned", 403);
              }
              if (allowance.savedTurnId && allowance.savedTurnId !== turnId) {
                const saved = await tx.turn.findFirst({
                  where: { id: allowance.savedTurnId, userId, boardId },
                  include: { segments: { orderBy: { orderIndex: "asc" } } },
                });
                if (!saved) throw new StorageQuotaError("lesson save allowance has already been used", 409);
                await release();
                return { kind: "trace_saved", turn: saved };
              }
            }
            const count = await tx.turn.count({ where: { boardId } });
            let orderIndex = count;
            const anchors = [input.orderAfterTurnId, input.orderBeforeTurnId];
            if (anchors.some((id) => id === turnId)) throw new StorageQuotaError("invalid ordering anchor", 400);
            const after = input.orderAfterTurnId ? await tx.turn.findFirst({ where: { id: input.orderAfterTurnId, boardId, userId } }) : null;
            const beforeAnchor = input.orderBeforeTurnId ? await tx.turn.findFirst({ where: { id: input.orderBeforeTurnId, boardId, userId } }) : null;
            if ((input.orderAfterTurnId && !after) || (input.orderBeforeTurnId && !beforeAnchor) ||
              (after && beforeAnchor && after.orderIndex >= beforeAnchor.orderIndex)) {
              throw new StorageQuotaError("invalid ordering anchor", 400);
            }
            if (beforeAnchor) orderIndex = beforeAnchor.orderIndex;
            else if (after) orderIndex = after.orderIndex + 1;
            if (orderIndex < count) {
              // Unique (boardId, orderIndex): move the bounded tail descending
              // while holding the existing authenticated board/user locks.
              const tail = await tx.turn.findMany({ where: { boardId, orderIndex: { gte: orderIndex } }, orderBy: { orderIndex: "desc" } });
              for (const later of tail) await tx.turn.update({ where: { id: later.id }, data: { orderIndex: later.orderIndex + 1, updatedAt: later.updatedAt } });
            }
            turn = await tx.turn.create({
              data: {
                id: turnId,
                boardId,
                userId,
                orderIndex,
                kind: input.kind,
                traceId: traceId ?? null,
                speedMultiplier: input.speedMultiplier ?? 1,
                storageBytes: BigInt(chargeBytes),
                metadataBytes: BigInt(metadataBytes),
                ...turnData,
              },
            });
            await tx.board.update({
              where: { id: boardId },
              data: { preview: (input.preview?.trim() || question).slice(0, 60), updatedAt: new Date() },
            });
            if (production) {
              await tx.ownedTrace.update({ where: { traceId: traceId! }, data: { savedTurnId: turnId } });
            }
          } else {
            turn = await tx.turn.update({
              where: { id: turnId },
              data: {
                ...turnData,
                storageBytes: { increment: BigInt(chargeBytes) },
                metadataBytes: BigInt(Math.max(metadataBytes, Number(current.metadataBytes))),
              },
            });
            await tx.segment.deleteMany({ where: { turnId } });
          }
          const segments = segmentValues.length > 0
            ? await tx.segment.createManyAndReturn({ data: segmentValues })
            : [];
          if (reservation) await settleTurnStorage(reservation, false, tx);
          return { kind: "saved", turn: { ...turn, segments }, sceneAccepted: ownsScene };
        });
      } catch (error) {
        lastError = error;
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
        throw error;
      }
    }
    if (!outcome) throw lastError ?? new Error("failed to save checkpoint after retries");
    settled = true;
    switch (outcome.kind) {
      case "retry_stopped": return applyCheckpoint(request, userId, { boardId, turnId }, input, files, stoppedRetries + 1);
      case "saved": return json(turnBody(outcome.turn, { sceneAccepted: outcome.sceneAccepted }));
      case "stale": return json(turnBody(outcome.turn, { stale: true, sceneAccepted: false }));
      case "final": return json(turnBody(outcome.turn, { stale: true, final: true }));
      case "conflict": return json({ error: "checkpoint does not continue the saved rows", serverCount: outcome.serverCount, serverSeq: outcome.serverSeq }, 409);
      case "trace_saved": return json({ error: "this lesson is already saved as another turn", code: "trace_saved", ...turnBody(outcome.turn) }, 409);
    }
  } catch (error) {
    if (!settled && reservation) {
      try {
        await abandonTurnStorage(reservation);
      } catch { /* the durable intent's own deadline still recovers the charge */ }
    }
    if (error instanceof StorageQuotaError) return json({ error: error.message }, error.status);
    throw error;
  }
}
