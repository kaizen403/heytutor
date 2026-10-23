import { Prisma, type PrismaClient } from "@prisma/client";
import { aggregateCoverage, COVERAGE_SCAN_BUDGET, type CoverageFact, type CoverageWindow } from "./coverage";

/**
 * Only structured projections leave Postgres: no identities, source text,
 * full artifacts, geometry, narration or audio. Chapters were never saved;
 * NULL is intentional, not a guess based on the drawing family or question.
 * `scoped` keeps the newest budget rows plus one witness; segment ink is read
 * only for the rows that enter the report.
 */
export function productionCoverageQuery(window: CoverageWindow): Prisma.Sql {
  return Prisma.sql`
    WITH scoped AS MATERIALIZED (
      SELECT t.id, t.created_at
      FROM turns t
      WHERE t.kind = 'lesson' AND t.status IN ('complete', 'stopped')
        AND COALESCE(t.scene_artifacts #>> '{boardContinuation,schemaVersion}', '') <> 'board-continuation/v1'
        AND t.created_at >= ${new Date(window.from)} AND t.created_at < ${new Date(window.to)}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ${COVERAGE_SCAN_BUDGET + 1}
    ),
    chosen AS (
      SELECT id FROM scoped
      ORDER BY created_at DESC, id DESC
      LIMIT ${COVERAGE_SCAN_BUDGET}
    ),
    facts AS (
      SELECT
        t.scene_artifacts #>> '{failureTelemetry,subject}' AS subject,
        NULL::text AS "chapterId",
        t.scene_artifacts #>> '{turnPlan,visualRequirement}' AS requirement,
        t.visual_status AS "visualStatus", t.status,
        t.scene_artifacts #>> '{degradation,reason}' AS "degradationReason",
        t.scene_artifacts #> '{degradation,issueCodes}' AS "issueCodes",
        t.scene_artifacts #>> '{failureTelemetry,code}' AS "failureCode",
        t.scene_artifacts #> '{failureTelemetry,issueCodes}' AS "failureIssueCodes",
        t.scene_artifacts #> '{failureTelemetry,unknownIssueCount}' AS "recordedUnknownIssueCount",
        t.scene_artifacts ->> 'diagramStrategy' AS strategy,
        EXISTS (
          SELECT 1 FROM segments s
          CROSS JOIN LATERAL jsonb_array_elements(CASE
            WHEN jsonb_typeof(s.command -> 'commands') = 'array' THEN s.command -> 'commands'
            ELSE '[]'::jsonb END) ink
          WHERE s.turn_id = t.id AND s.command -> 'trustedDiagramGeometry' = 'true'::jsonb
            AND ink ->> 'type' IN ('DRAW_LINE', 'DRAW_CIRCLE', 'DRAW_ARC', 'DRAW_RECT', 'DRAW_POINT', 'ARROW', 'DIMENSION')
            AND COALESCE(ink #>> '{visualStyle,strokeRole}', '') <> 'trace'
        ) AS "hasTrustedInk",
        (SELECT COUNT(*) FROM scoped) AS "windowMatches"
      FROM turns t
      INNER JOIN chosen ON chosen.id = t.id
    )
    SELECT subject, "chapterId", requirement, "visualStatus", status, "degradationReason", "issueCodes",
      "failureCode", "failureIssueCodes", "recordedUnknownIssueCount", strategy, "hasTrustedInk",
      "windowMatches", COUNT(*) AS count
    FROM facts GROUP BY 1,2,3,4,5,6,7,8,9,10,11,12,13
  `;
}

/** Shared by the admin API and CLI. Fail closed if Postgres won't enforce READ ONLY. */
export async function loadProductionCoverage(database: PrismaClient, window: CoverageWindow) {
  return database.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const state = await tx.$queryRaw<Array<{ readOnly: string }>>`SELECT current_setting('transaction_read_only') AS "readOnly"`;
    if (state[0]?.readOnly !== "on") throw new Error("coverage_requires_read_only");
    await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`;
    const facts = await tx.$queryRaw<CoverageFact[]>(productionCoverageQuery(window));
    if (facts.length > 0 && facts.some(fact => fact.windowMatches == null)) throw new Error("coverage_scan_mismatch");
    return aggregateCoverage(facts, window);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
}
