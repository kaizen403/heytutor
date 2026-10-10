import { Prisma, type Turn, type Segment } from "@prisma/client";
import { NextResponse } from "next/server";
import { ensureUser, getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { lectureAudioKey } from "@/lib/object-store/keys";
import { uploadAudio } from "@/lib/object-store/s3";
import { readBoundedFormData, RequestBodyError } from "@/lib/http/requestBody";
import { abandonTurnStorage, reserveTurnStorage, settleTurnStorage, StorageQuotaError, withUserStorageLock } from "@/lib/boards/storageQuota";
import { turnMetadataStorageBytes } from "@/lib/boards/storageAccounting";
import { mediaProxyUrl } from "@/lib/object-store/mediaUrl";
import { assertOwnedTrace } from "@/lib/obs/traceOwnership";
import { isTurnMetadataPersistable } from "@/lib/scene/turnPersistencePolicy";
import { canonicalizeTurnSceneMetadata } from "@/lib/scene/turnScenePersistence";
import { rejectTurnSave as rejectSave } from "@/lib/boards/turnSaveRejection";
import {
  audioPrefixMatchesType,
  validateTurnUploadHeaders,
  validateTurnUploadParts,
  MAX_TURN_UPLOAD_BYTES,
} from "@/lib/scene/turnUploadLimits";

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
  sourceOrderIndex?: number | null;
}

interface TurnMetadata {
  question: string;
  rawResponse: string;
  speedMultiplier?: number;
  traceId?: string;
  sceneDocument?: unknown;
  sceneEngineVersion?: string | null;
  validationReport?: unknown;
  visualStatus?: "validated" | "text_only" | "legacy" | "retry_required" | null;
  sceneArtifacts?: unknown;
  segments: TurnSegmentMeta[];
}


function nullableJson(value: unknown): Prisma.InputJsonValue | Prisma.NullTypes.DbNull {
  return value == null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function turnResponse(turn: Turn, insertedSegments: Segment[]) {
  return NextResponse.json({
    turn: {
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
      segments: insertedSegments
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
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const uploadPreflight = validateTurnUploadHeaders(request.headers);
  if (!uploadPreflight.ok) {
    return rejectSave("upload_headers_invalid", uploadPreflight.error, uploadPreflight.status);
  }

  const userId = await getUserId();
  if (!userId) {
    return rejectSave("unauthorized", "unauthorized", 401);
  }

  const { boardId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    return rejectSave("idempotency_key_invalid", "invalid idempotency key", 400, { boardId });
  }
  await ensureUser(userId);

  const board = await prisma.board.findFirst({
    where: { id: boardId, userId },
  });

  if (!board) {
    return rejectSave("board_not_found", "not found", 404, { boardId });
  }

  let formData: FormData;
  try {
    formData = await readBoundedFormData(request, MAX_TURN_UPLOAD_BYTES);
  } catch (error) {
    return rejectSave("multipart_invalid", error instanceof Error ? error.message : "invalid multipart form data",
      error instanceof RequestBodyError ? error.status : 400, { boardId });
  }
  const metadataRaw = formData.get("metadata");

  if (typeof metadataRaw !== "string") {
    return rejectSave("metadata_missing", "metadata required", 400, { boardId });
  }

  let metadata: TurnMetadata;
  try {
    metadata = JSON.parse(metadataRaw) as TurnMetadata;
  } catch {
    return rejectSave("metadata_json_invalid", "invalid metadata json", 400, { boardId });
  }
  if (!metadata || typeof metadata !== "object" ||
    typeof metadata.question !== "string" || metadata.question.length > 12_000 ||
    typeof metadata.rawResponse !== "string" || metadata.rawResponse.length > 100_000 ||
    (metadata.traceId !== undefined && (typeof metadata.traceId !== "string" || metadata.traceId.length > 128)) ||
    (metadata.speedMultiplier !== undefined && (!Number.isFinite(metadata.speedMultiplier) || metadata.speedMultiplier < 0.25 || metadata.speedMultiplier > 4))) {
    return rejectSave("turn_fields_invalid", "invalid or oversized turn fields", 400, { boardId });
  }
  const requiresSaveAllowance = process.env.NODE_ENV === "production";
  if (requiresSaveAllowance) {
    if (!metadata.traceId || !await assertOwnedTrace(userId, metadata.traceId, boardId)) {
      return rejectSave("save_allowance_required", "an authorized lesson save allowance is required", 403, { boardId, traceId: metadata.traceId });
    }
    const allowance = await prisma.ownedTrace.findUnique({ where: { traceId: metadata.traceId } });
    if (allowance?.savedTurnId) {
      const existing = await prisma.turn.findFirst({
        where: { id: allowance.savedTurnId, userId, boardId },
        include: { segments: { orderBy: { orderIndex: "asc" } } },
      });
      if (existing) return turnResponse(existing, existing.segments);
      return rejectSave("save_allowance_used", "lesson save allowance has already been used", 409, { boardId, traceId: metadata.traceId });
    }
  }

  const uploadParts = validateTurnUploadParts(formData, metadataRaw, metadata.segments);
  if (!uploadParts.ok) {
    return rejectSave("upload_parts_invalid", uploadParts.error, uploadParts.status, { boardId, traceId: metadata.traceId });
  }

  if (!isTurnMetadataPersistable(metadata)) {
    return rejectSave("turn_not_persistable", "question and rawResponse required unless persisting a required-diagram failure", 400, { boardId, traceId: metadata.traceId });
  }

  const canonicalScene = await canonicalizeTurnSceneMetadata(metadata);
  if (!canonicalScene.ok) {
    return rejectSave(canonicalScene.code ?? "scene_persistence_rejected", `scene persistence rejected: ${canonicalScene.error}`, 400, { boardId, traceId: metadata.traceId });
  }
  metadata = {
    ...metadata,
    ...canonicalScene.value,
  };

  // Skip a second audio upload when a committed response was lost. The
  // transaction repeats this check under the board lock for concurrent saves.
  if (idempotencyKey !== null) {
    const existing = await prisma.turn.findFirst({
      where: { boardId, userId, idempotencyKey },
      include: { segments: { orderBy: { orderIndex: "asc" } } },
    });
    if (existing) return turnResponse(existing, existing.segments);
  }

  const turnId = crypto.randomUUID();
  const segmentMeta = metadata.segments ?? [];
  for (const segment of segmentMeta) {
    if ((segment.narration !== undefined && (typeof segment.narration !== "string" || segment.narration.length > 12_000)) ||
      (segment.spokenText !== undefined && (typeof segment.spokenText !== "string" || segment.spokenText.length > 12_000)) ||
      (segment.durationMs !== undefined && (!Number.isFinite(segment.durationMs) || segment.durationMs < 0 || segment.durationMs > 600_000))) {
      return rejectSave("segment_fields_invalid", "invalid or oversized segment fields", 400, { boardId, traceId: metadata.traceId });
    }
  }
  // Validate all media before any upload so a later invalid segment cannot
  // leave earlier objects behind while its reservation is refunded.
  for (const [, value] of formData.entries()) {
    if (!(value instanceof File) || value.size === 0) continue;
    const prefix = new Uint8Array(await value.slice(0, 12).arrayBuffer());
    if (!audioPrefixMatchesType(value.type, prefix)) {
      return rejectSave("audio_format_mismatch", "audio content does not match its declared format", 415, { boardId, traceId: metadata.traceId });
    }
  }
  const audioFileFor = (segment: TurnMetadata["segments"][number]) => {
    const source = segment.sourceOrderIndex === undefined ? segment.orderIndex : segment.sourceOrderIndex;
    const file = source === null ? null : formData.get(`audio-${source}`);
    return file instanceof File && file.size > 0 ? file : null;
  };
  const plannedSegments = segmentMeta.map(segment => {
    const file = audioFileFor(segment);
    return { ...segment, audioRef: segment.sourceOrderIndex === undefined ? segment.orderIndex : segment.sourceOrderIndex,
      audioUrl: file ? mediaProxyUrl(lectureAudioKey(boardId, turnId, segment.orderIndex, file.type)) : null,
      audioFormat: file?.type ?? "audio/mpeg" };
  });
  const audioBytes = segmentMeta.reduce((sum, segment) => sum + (audioFileFor(segment)?.size ?? 0), 0);
  const storedBytes = turnMetadataStorageBytes({ ...metadata, segments: plannedSegments }) + audioBytes;
  let reservation;
  try {
    reservation = await reserveTurnStorage({ userId, boardId, turnId, bytes: storedBytes });
  } catch (error) {
    if (error instanceof StorageQuotaError) return rejectSave(error.code ?? "storage_admission_rejected", error.message, error.status, { boardId, traceId: metadata.traceId });
    throw error;
  }
  let settled = false;
  // End uploads well before their durable cleanup intent becomes due. A late
  // completion also has to atomically remove an unclaimed intent to commit.
  const uploadSignal = AbortSignal.any([request.signal, AbortSignal.timeout(10 * 60_000)]);
  try {

  const audioUrls = new Map<number, string | null>();
  const audioFormats = new Map<number, string>();
  for (const segment of segmentMeta) {
    if (uploadSignal.aborted) throw new StorageQuotaError("turn upload canceled or expired", 409);
    // Canonicalization may move rows; the audio part keeps its submitted index.
    const source = segment.sourceOrderIndex === undefined ? segment.orderIndex : segment.sourceOrderIndex;
    const file = source === null ? null : formData.get(`audio-${source}`);
    if (file instanceof File && file.size > 0) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      audioFormats.set(segment.orderIndex, file.type);
      const key = lectureAudioKey(boardId, turnId, segment.orderIndex, file.type);
      const audioUrl = await uploadAudio(key, bytes, file.type, uploadSignal);
      if (uploadSignal.aborted) throw new StorageQuotaError("turn upload canceled or expired", 409);
      if (!audioUrl) throw new StorageQuotaError("Your lesson could not be saved because its audio upload failed. Please try saving again.", 503, "storage_verification_failed");
      audioUrls.set(segment.orderIndex, audioUrl);
    } else {
      audioUrls.set(segment.orderIndex, null);
    }
  }

  if (uploadSignal.aborted) throw new StorageQuotaError("turn upload canceled or expired", 409);
  const retainedMetadataBytes = turnMetadataStorageBytes({ ...metadata, segments: plannedSegments.map(segment => ({
    ...segment, audioUrl: audioUrls.get(segment.orderIndex) ?? null,
  })) });
  const retainedBytes = retainedMetadataBytes + audioBytes;
  if (retainedBytes > reservation.bytes) throw new StorageQuotaError("storage accounting changed; try saving again", 409);

  const MAX_INSERT_ATTEMPTS = 3;
  let saved: { turn: Turn; insertedSegments: Segment[] } | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt += 1) {
    try {
      saved = await withUserStorageLock(userId, async (tx) => {
        // Lock the board row so concurrent turn saves serialize against it.
        const ownedRows = await tx.$queryRaw<Array<{ id: string }>>`SELECT 1 FROM "boards" WHERE "id" = ${boardId} AND user_id = ${userId} FOR UPDATE`;
        if (!ownedRows.length) throw new StorageQuotaError("board not found", 404);

        if (requiresSaveAllowance) {
          const allowance = await tx.ownedTrace.findUnique({ where: { traceId: metadata.traceId! } });
          if (!allowance || allowance.userId !== userId || allowance.expiresAt <= new Date()) {
            throw new StorageQuotaError("lesson save allowance expired or is not owned", 403);
          }
          if (allowance.savedTurnId) {
            const existing = await tx.turn.findFirst({
              where: { id: allowance.savedTurnId, userId, boardId },
              include: { segments: { orderBy: { orderIndex: "asc" } } },
            });
            if (!existing) throw new StorageQuotaError("lesson save allowance has already been used", 409);
            await abandonTurnStorage(reservation, tx);
            return { turn: existing, insertedSegments: existing.segments };
          }
        }

        if (idempotencyKey !== null) {
          const existing = await tx.turn.findFirst({
            where: { boardId, userId, idempotencyKey },
            include: { segments: { orderBy: { orderIndex: "asc" } } },
          });
          if (existing) {
            await abandonTurnStorage(reservation, tx);
            return { turn: existing, insertedSegments: existing.segments };
          }
        }

        const turnCount = await tx.turn.count({ where: { boardId } });
        const orderIndex = turnCount;

        const turn = await tx.turn.create({
          data: {
            id: turnId,
            boardId,
            userId,
            idempotencyKey,
            orderIndex,
            question: metadata.question,
            storageBytes: BigInt(retainedBytes),
            metadataBytes: BigInt(retainedMetadataBytes),
            rawResponse: metadata.rawResponse,
            speedMultiplier: metadata.speedMultiplier ?? 1,
            traceId: metadata.traceId ?? null,
            sceneDocument: nullableJson(metadata.sceneDocument),
            sceneEngineVersion: metadata.sceneEngineVersion ?? null,
            validationReport: nullableJson(metadata.validationReport),
            visualStatus: metadata.visualStatus ?? null,
            sceneArtifacts: nullableJson(metadata.sceneArtifacts),
          },
        });

        const segmentValues = segmentMeta.map((segment) => ({
          turnId,
          orderIndex: segment.orderIndex,
          narration: segment.narration ?? "",
          spokenText: segment.spokenText ?? "",
          command: segment.command === undefined ? undefined : (segment.command as Prisma.InputJsonValue),
          audioUrl: audioUrls.get(segment.orderIndex) ?? null,
          audioFormat: audioFormats.get(segment.orderIndex) ?? "audio/mpeg",
          audioRef: segment.sourceOrderIndex === undefined ? segment.orderIndex : segment.sourceOrderIndex,
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

        if (requiresSaveAllowance) await tx.ownedTrace.update({
          where: { traceId: metadata.traceId! }, data: { savedTurnId: turn.id },
        });

        await settleTurnStorage(reservation, false, tx, retainedBytes);
        return { turn, insertedSegments };
      });
      break;
    } catch (error) {
      lastError = error;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        // Unique constraint on (boardId, orderIndex) — retry to get a new index.
        continue;
      }
      throw error;
    }
  }

  if (!saved) {
    throw lastError ?? new Error("failed to save turn after retries");
  }
  settled = true;

  return turnResponse(saved.turn, saved.insertedSegments);
  } catch (error) {
    if (!settled) {
      // Admission already persisted a cleanup intent. Best-effort acceleration
      // can fail during a DB outage; the original deadline remains recoverable.
      try {
        await abandonTurnStorage(reservation);
      } catch { /* the pre-upload receipt retains bytes and pending-turn recovery */ }
    }
    if (error instanceof StorageQuotaError) return rejectSave(error.code ?? "storage_commit_rejected", error.message, error.status, { boardId, traceId: metadata.traceId });
    throw error;
  }
}
