/** Optional real PostgreSQL gate. Synthetic temporary tables only; never a production URL. */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { loadProductionCoverage } from "../../lib/admin/coverageQueries";
import { parseCoverageWindow } from "../../lib/admin/coverage";

async function main() {
  const raw = process.env.COVERAGE_TEST_DATABASE_URL;
  assert(raw, "COVERAGE_TEST_DATABASE_URL must name a disposable local coverage_test database");
  const url = new URL(raw);
  assert(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/coverage_test",
    "refusing non-local or non-test database");
  url.searchParams.set("connection_limit", "1");
  const db = new PrismaClient({ log: [], datasources: { db: { url: url.toString() } } });
  const date = new Date("2026-10-02T12:00:00Z");
  try {
    await db.$executeRaw`CREATE TEMP TABLE turns (id text PRIMARY KEY, kind text, status text,
      created_at timestamptz, visual_status text, scene_artifacts jsonb)`;
    await db.$executeRaw`CREATE TEMP TABLE segments (turn_id text, command jsonb)`;
    const rows = [
      { id: "drawn", visual: "validated", ink: true },
      { id: "empty", visual: "text_only" },
      { id: "suppressed", visual: "retry_required", suppressed: true },
      { id: "planned-not-drawn", visual: "validated" },
      { id: "trace-only", visual: "validated", trace: true },
      { id: "untrusted", visual: "validated", untrusted: true },
      { id: "unknown", visual: null, unknown: true },
      { id: "none", visual: "text_only", none: true },
      { id: "doubt", visual: "text_only", kind: "doubt" },
      { id: "resume", visual: "text_only", kind: "resume" },
      { id: "live", visual: "text_only", status: "live" },
      { id: "continuation", visual: "text_only", continuation: true },
      { id: "before-window", visual: "text_only", date: new Date("2026-09-30T23:59:59Z") },
      { id: "exclusive-end", visual: "text_only", date: new Date("2026-10-08T00:00:00Z") },
      { id: "stopped", visual: "text_only", status: "stopped" },
    ];
    for (const row of rows) {
      const artifacts = JSON.stringify({ failureTelemetry: { subject: row.unknown ? "PRIVATE_STUDENT_CANARY" : "physics",
        ...(row.suppressed ? { code: "fallback_suppressed" } : {}) },
      turnPlan: { visualRequirement: row.unknown ? null : row.none ? "none" : "required", question: "PRIVATE_STUDENT_CANARY" },
      degradation: { reason: row.none ? null : "candidate_invalid", issueCodes: ["exact_assertion_unproven"] },
      diagramStrategy: "strict", ...(row.continuation ? { boardContinuation: { schemaVersion: "board-continuation/v1" } } : {}) });
      await db.$executeRaw`INSERT INTO turns VALUES (${row.id}, ${row.kind ?? "lesson"}, ${row.status ?? "complete"},
        ${row.date ?? date}, ${row.visual}, ${artifacts}::jsonb)`;
      if (row.ink || row.trace || row.untrusted) {
        const command = JSON.stringify({ trustedDiagramGeometry: !row.untrusted,
          commands: [{ type: "DRAW_LINE", params: [400, 100, 800, 200],
            ...(row.trace ? { visualStyle: { strokeRole: "trace" } } : {}) }] });
        await db.$executeRaw`INSERT INTO segments VALUES (${row.id}, ${command}::jsonb)`;
      }
    }
    const report = await loadProductionCoverage(db, parseCoverageWindow(new URLSearchParams("from=2026-10-01&to=2026-10-08")));
    assert.equal(report.totals.savedLessons, 9);
    assert.equal(report.totals.needed, 7);
    assert.equal(report.totals.drawn, 1);
    assert.equal(report.totals.neededDrawn, 1);
    assert.equal(report.totals.neededEmpty, 6);
    assert.equal(report.totals.unrecordedOutcome, 1);
    assert.equal(report.totals.unrecordedNeed, 1);
    assert.equal(report.emptyReasons.reduce((sum, row) => sum + row.lessons, 0), 7);
    assert(report.emptyReasons.some(row => row.fallbackSuppressed === "yes"));
    assert(report.emptyReasons.some(row => row.status === "stopped"));
    assert(!JSON.stringify(report).includes("PRIVATE_STUDENT_CANARY"));
    console.log("verify-production-coverage-db: real PostgreSQL READ ONLY snapshot, synthetic saved lessons, trusted non-trace ink, scope/window/privacy verified");
  } finally { await db.$disconnect(); }
}

void main().catch(() => {
  console.error("Synthetic coverage database gate failed; no URL, credentials, row data or query error printed.");
  process.exitCode = 1;
});
