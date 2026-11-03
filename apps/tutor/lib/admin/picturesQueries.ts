import { Prisma, type PrismaClient } from "@prisma/client";
import {
  aggregatePictureOutcomes,
  CACHED_DECLINE_TTL_MS,
  PICTURE_CACHE_LIMIT,
  PICTURE_LIBRARY_LIMIT,
  PICTURE_QUESTION_MAX,
  PICTURE_RECENT_LIMIT,
  PICTURE_SCAN_BUDGET,
  shapeLibraryRow,
  shapePictureCache,
  shapePictureTurn,
  type PictureCacheSource,
  type PictureFact,
  type PictureLibrarySource,
  type PicturesReport,
  type PicturesWindow,
  type PictureTurnSource,
} from "./pictures";

/**
 * Saved lessons only, as the coverage report counts them: lesson kind (a
 * resume copies its lesson's outcome, a doubt never asks), complete or
 * stopped, not a board continuation, inside the whole UTC day window.
 */
export function pictureLessonScope(window: PicturesWindow): Prisma.Sql {
  return Prisma.sql`t.kind = 'lesson' AND t.status IN ('complete', 'stopped')
    AND COALESCE(t.scene_artifacts #>> '{boardContinuation,schemaVersion}', '') <> 'board-continuation/v1'
    AND t.created_at >= ${new Date(`${window.from}T00:00:00.000Z`)} AND t.created_at < ${new Date(`${window.to}T00:00:00.000Z`)}`;
}

/**
 * One projection per lesson: the engine's status, the plan's requirement, the
 * browser's outcome object and the server's picture id. No identities, text,
 * plans or geometry. `scoped` keeps the newest budget rows plus one witness.
 */
export function pictureFactsQuery(window: PicturesWindow): Prisma.Sql {
  return Prisma.sql`
    WITH scoped AS MATERIALIZED (
      SELECT t.id, t.created_at FROM turns t
      WHERE ${pictureLessonScope(window)}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ${PICTURE_SCAN_BUDGET + 1}
    ),
    chosen AS (
      SELECT id FROM scoped ORDER BY created_at DESC, id DESC LIMIT ${PICTURE_SCAN_BUDGET}
    )
    SELECT
      to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
      t.scene_artifacts #>> '{failureTelemetry,subject}' AS subject,
      t.scene_artifacts #>> '{turnPlan,visualRequirement}' AS requirement,
      t.visual_status AS "visualStatus",
      t.scene_artifacts -> 'referencePictureOutcome' AS outcome,
      t.scene_artifacts #>> '{referencePicture,id}' AS "pictureId",
      t.scene_artifacts #>> '{referencePicture,source}' AS "pictureSource",
      (SELECT COUNT(*) FROM scoped) AS "windowMatches"
    FROM turns t
    INNER JOIN chosen ON chosen.id = t.id
  `;
}

/** The newest lessons that carry a picture outcome, for the table. */
export function pictureRecentQuery(window: PicturesWindow): Prisma.Sql {
  return Prisma.sql`
    SELECT
      t.id::text AS id, t.created_at AS "createdAt", LEFT(t.question, ${PICTURE_QUESTION_MAX}::int) AS question,
      t.user_id AS "userId", u.name AS "userName", u.email AS "userEmail",
      t.scene_artifacts #>> '{failureTelemetry,subject}' AS subject,
      t.scene_artifacts #>> '{turnPlan,visualRequirement}' AS requirement,
      t.visual_status AS "visualStatus",
      t.scene_artifacts ->> 'figureSource' AS "figureSource",
      t.scene_artifacts ->> 'diagramResultStatus' AS "diagramResultStatus",
      t.scene_artifacts -> 'degradation' AS degradation,
      t.scene_artifacts -> 'referencePictureOutcome' AS outcome,
      t.scene_artifacts #>> '{referencePicture,id}' AS "pictureId",
      t.scene_artifacts #>> '{referencePicture,source}' AS "pictureSource",
      t.scene_artifacts #>> '{referencePicture,title}' AS "pictureTitle",
      t.scene_artifacts #>> '{referencePicture,license}' AS "pictureLicense"
    FROM turns t
    LEFT JOIN users u ON u.id = t.user_id
    WHERE ${pictureLessonScope(window)}
      AND jsonb_typeof(t.scene_artifacts -> 'referencePictureOutcome') = 'object'
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT ${PICTURE_RECENT_LIMIT}
  `;
}

/** Stored pictures, most used in the period first. Never the image bytes or the plan. */
export function pictureLibraryQuery(window: PicturesWindow): Prisma.Sql {
  return Prisma.sql`
    WITH uses AS (
      SELECT t.scene_artifacts #>> '{referencePicture,id}' AS id, COUNT(*) AS turns, MAX(t.created_at) AS "lastUsedAt"
      FROM turns t
      WHERE ${pictureLessonScope(window)}
        AND jsonb_typeof(t.scene_artifacts -> 'referencePicture') = 'object'
      GROUP BY 1
    )
    SELECT
      rp.id, rp.source, rp.record ->> 'title' AS title, rp.record ->> 'shows' AS shows,
      rp.record ->> 'license' AS license, rp.record ->> 'artist' AS artist, rp.record ->> 'pageUrl' AS "pageUrl",
      CASE WHEN jsonb_typeof(rp.record -> 'labels') = 'array' THEN jsonb_array_length(rp.record -> 'labels') ELSE 0 END AS "labelCount",
      rp.record ->> 'width' AS width, rp.record ->> 'height' AS height,
      rp.created_at AS "createdAt", COALESCE(uses.turns, 0) AS turns, uses."lastUsedAt"
    FROM reference_pictures rp
    LEFT JOIN uses ON uses.id = rp.id
    ORDER BY COALESCE(uses.turns, 0) DESC, rp.created_at DESC, rp.id
    LIMIT ${PICTURE_LIBRARY_LIMIT}
  `;
}

type Executor = Pick<Prisma.TransactionClient, "$queryRaw">;

/**
 * Every query of the report, on one executor. Split from the read only
 * wrapper so the verify script can run it inside its own rolled back
 * transaction over temporary tables.
 */
export async function queryPicturesReport(tx: Executor, window: PicturesWindow, nowMs: number = Date.now()): Promise<PicturesReport> {
  const facts = await tx.$queryRaw<PictureFact[]>(pictureFactsQuery(window));
  if (facts.length > 0 && facts.some((fact) => fact.windowMatches == null)) throw new Error("pictures_scan_mismatch");
  const recent = await tx.$queryRaw<PictureTurnSource[]>(pictureRecentQuery(window));
  const library = await tx.$queryRaw<PictureLibrarySource[]>(pictureLibraryQuery(window));
  const libraryTotals = await tx.$queryRaw<Array<{ total: bigint; wikimedia: bigint; generated: bigint }>>`
    SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE source = 'wikimedia') AS wikimedia,
      COUNT(*) FILTER (WHERE source = 'generated') AS generated
    FROM reference_pictures`;
  const cacheTotals = await tx.$queryRaw<NonNullable<PictureCacheSource["totals"]>[]>`
    SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE picture_id IS NOT NULL) AS accepted,
      COUNT(*) FILTER (WHERE picture_id IS NULL) AS declined,
      COUNT(*) FILTER (WHERE picture_id IS NULL AND created_at > ${new Date(nowMs - CACHED_DECLINE_TTL_MS)}) AS "declinedActive"
    FROM reference_picture_queries`;
  const cacheReasons = await tx.$queryRaw<PictureCacheSource["reasons"][number][]>`
    SELECT reason, COUNT(*) AS count, MAX(created_at) AS "latestAt"
    FROM reference_picture_queries WHERE picture_id IS NULL
    GROUP BY reason ORDER BY COUNT(*) DESC, reason NULLS FIRST LIMIT ${PICTURE_CACHE_LIMIT}`;
  const cacheRecent = await tx.$queryRaw<PictureCacheSource["recent"][number][]>`
    SELECT LEFT(query_key, 12) AS "keyPrefix", reason, created_at AS "createdAt"
    FROM reference_picture_queries WHERE picture_id IS NULL
    ORDER BY created_at DESC, query_key LIMIT ${PICTURE_CACHE_LIMIT}`;

  const totals = libraryTotals[0];
  const rows = library.flatMap((row) => {
    const shaped = shapeLibraryRow(row);
    return shaped ? [shaped] : [];
  });
  const total = Number(totals?.total ?? 0);
  return {
    generatedAt: new Date(nowMs).toISOString(),
    window,
    ...aggregatePictureOutcomes(facts, window),
    recent: recent.flatMap((row) => {
      const shaped = shapePictureTurn(row);
      return shaped ? [shaped] : [];
    }),
    library: { total, wikimedia: Number(totals?.wikimedia ?? 0), generated: Number(totals?.generated ?? 0),
      truncated: total > library.length, rows },
    cache: shapePictureCache({ totals: cacheTotals[0], reasons: cacheReasons, recent: cacheRecent }),
  };
}

/** Shared by the admin API and the local sample script. Fail closed if Postgres won't enforce READ ONLY. */
export async function loadPicturesReport(database: PrismaClient, window: PicturesWindow, nowMs: number = Date.now()): Promise<PicturesReport> {
  return database.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const state = await tx.$queryRaw<Array<{ readOnly: string }>>`SELECT current_setting('transaction_read_only') AS "readOnly"`;
    if (state[0]?.readOnly !== "on") throw new Error("pictures_requires_read_only");
    await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`;
    return queryPicturesReport(tx, window, nowMs);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
}
