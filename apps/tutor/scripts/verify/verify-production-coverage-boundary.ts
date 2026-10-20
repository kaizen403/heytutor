/** Real admin route and query loader with synthetic grouped facts; no database or network. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { mock } from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { CoverageFact, CoverageReport, CoverageWindow } from "../../lib/admin/coverage";

const load = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
const canary = "PRIVATE_STUDENT_CANARY_do_not_return_or_log";
const window: CoverageWindow = { from: "2026-10-01", to: "2026-10-20" };
const expectedTotals = {
  savedLessons: 20, needed: 9, drawn: 5, neededDrawn: 3, neededEmpty: 4,
  neededUnknown: 2, empty: 9, unrecordedNeed: 4, unrecordedOutcome: 6,
};

const fact = (overrides: Partial<CoverageFact>): CoverageFact => ({
  subject: "maths", chapterId: null, requirement: "required", visualStatus: "validated",
  status: "complete", hasTrustedInk: true, degradationReason: null, issueCodes: [],
  failureCode: null, failureIssueCodes: [], strategy: "current", count: 1n,
  ...overrides,
});
const facts: CoverageFact[] = [
  fact({ count: 3n }),
  fact({ visualStatus: "text_only", hasTrustedInk: false, degradationReason: "candidate_invalid",
    failureCode: "fallback_suppressed", issueCodes: ["source_policy_suppressed", canary],
    failureIssueCodes: ["candidate_invalid"], strategy: "strict", count: 2n }),
  fact({ subject: "chemistry", visualStatus: "retry_required", hasTrustedInk: false,
    degradationReason: "required_visual_unavailable" }),
  fact({ subject: "physics", requirement: "none", visualStatus: "text_only", hasTrustedInk: false, count: 5n }),
  fact({ subject: canary, chapterId: canary, requirement: null, visualStatus: null,
    hasTrustedInk: false, strategy: canary, count: 4n }),
  fact({ subject: "physics", hasTrustedInk: false, status: "stopped" }),
  fact({ visualStatus: null, hasTrustedInk: false, count: 2n }),
  fact({ subject: "physics", requirement: "optional", count: 2n }),
];
// Unexpected source columns must never be copied onto the public aggregate.
Object.assign(facts[0]!, { question: canary, rawResponse: canary, userId: canary, audioUrl: canary });

interface RecordedQuery { sql: string; values: unknown[] }
function queryOf(input: unknown, values: unknown[]): RecordedQuery {
  if (Array.isArray(input)) return { sql: input.join("?"), values };
  assert(input && typeof input === "object", "raw queries must use Prisma parameter objects");
  const query = input as { sql?: unknown; values?: unknown };
  assert.equal(typeof query.sql, "string");
  assert(Array.isArray(query.values));
  return { sql: query.sql as string, values: query.values };
}
const compact = (sql: string) => sql.replace(/\s+/g, " ").trim();

let denied = false;
let readOnly: unknown = "on";
let failure: "set" | "setting" | "facts" | null = null;
let transactions = 0;
let factQueries = 0;
let networkCalls = 0;
const steps: string[] = [];
const queries: RecordedQuery[] = [];
const transactionOptions: unknown[] = [];
const databaseSteps = () => steps.filter(step => step !== "auth");
const deniedAccess = (name: PropertyKey): never => {
  throw new Error(`Unexpected database operation: ${String(name)}`);
};
const tx = new Proxy({
  $executeRaw: async (input: unknown, ...values: unknown[]) => {
    const query = queryOf(input, values);
    assert.equal(query.values.length, 0);
    const statement = compact(query.sql).replace(/;$/, "").toUpperCase();
    if (statement === "SET LOCAL STATEMENT_TIMEOUT = '15S'") {
      assert.deepEqual(databaseSteps(), ["transaction", "set-read-only", "verify-read-only"]);
      steps.push("statement-timeout");
      return 0;
    }
    assert.equal(statement, "SET TRANSACTION READ ONLY");
    steps.push("set-read-only");
    if (failure === "set") throw new Error(canary);
    return 0;
  },
  $queryRaw: async (input: unknown, ...values: unknown[]) => {
    const query = queryOf(input, values);
    queries.push(query);
    if (/current_setting\s*\(/i.test(query.sql)) {
      assert.deepEqual(databaseSteps(), ["transaction", "set-read-only"], "verify read-only before reading facts");
      assert.match(query.sql, /transaction_read_only/);
      steps.push("verify-read-only");
      if (failure === "setting") throw new Error(canary);
      return [{ readOnly }];
    }
    assert.deepEqual(databaseSteps(), ["transaction", "set-read-only", "verify-read-only", "statement-timeout"]);
    assert.equal(readOnly, "on", "no facts may be read without confirmed read-only mode");
    factQueries++;
    steps.push("facts");
    if (failure === "facts") throw new Error(canary);
    return facts;
  },
}, { get(target, key) { return key in target ? Reflect.get(target, key) : deniedAccess(key); } });
const db = new Proxy({
  $transaction: async (run: (transaction: typeof tx) => Promise<unknown>, options: unknown) => {
    transactions++;
    steps.push("transaction");
    transactionOptions.push(options);
    return run(tx);
  },
}, { get(target, key) { return key in target ? Reflect.get(target, key) : deniedAccess(key); } });

mock.module(resolve(root, "lib/auth/requireAdmin.ts"), { namedExports: {
  requireAdminRequest: async () => {
    steps.push("auth");
    return denied ? Response.json({ error: "unauthorized" }, { status: 401 }) : null;
  },
} });
mock.module(resolve(root, "lib/db/prisma.ts"), { namedExports: { prisma: db } });

function reset() {
  denied = false; readOnly = "on"; failure = null;
  transactions = 0; factQueries = 0; steps.length = 0;
  queries.length = 0; transactionOptions.length = 0;
}
function assertSafeReport(report: CoverageReport) {
  assert.deepEqual(report.window, window);
  assert.deepEqual(report.totals, expectedTotals, "weighted grouped facts produce exact lesson totals");
  assert.equal(report.totals.needed,
    report.totals.neededDrawn + report.totals.neededEmpty + report.totals.neededUnknown);
  assert.equal(report.subjects.reduce((sum, row) => sum + row.savedLessons, 0), 20);
  assert.equal(report.chapters.reduce((sum, row) => sum + row.savedLessons, 0), 20);
  assert(report.chapters.every(row => row.chapterId === null && row.chapter === "Unrecorded"));
  const suppressed = report.emptyReasons.find(row => row.fallbackSuppressed === "yes");
  assert.equal(suppressed?.lessons, 2);
  assert.deepEqual(suppressed?.issueCodes, ["candidate_invalid", "source_policy_suppressed"]);
  assert.equal(suppressed?.unknownIssueCount, 1);
  assert.equal(report.emptyReasons.find(row => row.requirement === "none")?.lessons, 5,
    "legitimate no-figure results remain visible without becoming required failures");
  assert.equal(report.emptyReasons.find(row => row.evidence === "validated_without_saved_ink")?.lessons, 1);
  assert(!JSON.stringify(report).includes(canary), "untrusted dimensions, extra columns and diagnostic text stay private");
}
function assertQueryBoundary(query: RecordedQuery) {
  const sql = compact(query.sql);
  assert.doesNotMatch(sql, /\b(?:insert|update|delete|upsert|truncate|alter|drop|create|grant|revoke|copy)\b/i);
  assert.doesNotMatch(sql, /\b(?:question|raw_response|rawResponse|narration|spoken_text|audio_url|scene_document|trace_id|preview|title)\b/i);
  assert.doesNotMatch(sql, /\b(?:limit|offset)\b/i, "the complete selected window cannot be truncated");
  assert.match(sql, /\bgroup\s+by\b/i, "database projects grouped counts, never per-student records");
  assert.match(sql, /failureTelemetry/);
  assert.match(sql, /visualRequirement/);
  assert.match(sql, /trustedDiagramGeometry/);
  assert.match(sql, /trace/);
  assert.match(sql, /\bkind\b\s*=\s*'lesson'/i);
  assert.match(sql, /\bstatus\b\s+in\s*\(\s*'complete'\s*,\s*'stopped'\s*\)/i);
  assert.match(sql, /boardContinuation/);
  assert.match(sql, /created_at\s*>=\s*\?/i, "start is inclusive and bound as data");
  assert.match(sql, /created_at\s*<\s*\?/i, "end is exclusive and bound as data");
  assert.doesNotMatch(sql, /2026-10-01|2026-10-20/, "window values are never interpolated into SQL");
  assert.deepEqual(query.values.map(value => value instanceof Date ? value.toISOString().slice(0, 10) : value),
    [window.from, window.to]);
}
const assertNotCached = (response: Response) => assert.match(response.headers.get("cache-control") ?? "", /(?:^|,)\s*no-store(?:,|$)/);

async function main() {
  const realFetch = globalThis.fetch;
  const originalError = console.error;
  const originalWarn = console.warn;
  const logs: unknown[][] = [];
  globalThis.fetch = async () => { networkCalls++; throw new Error("This gate permits no network"); };
  console.error = (...values) => { logs.push(values); };
  console.warn = (...values) => { logs.push(values); };
  try {
    const { productionCoverageQuery, loadProductionCoverage } = load(resolve(root, "lib/admin/coverageQueries.ts")) as
      typeof import("../../lib/admin/coverageQueries");
    const route = load(resolve(root, "app/api/admin/coverage/route.ts")) as typeof import("../../app/api/admin/coverage/route");
    const { parseProductionCoverageArgs } = load(resolve(root, "scripts/live/production-coverage.ts")) as
      typeof import("../live/production-coverage");
    const request = (search = "from=2026-10-01&to=2026-10-20") =>
      new Request(`https://coverage-fixture.invalid/api/admin/coverage?${search}`);

    assertQueryBoundary(queryOf(productionCoverageQuery(window), []));
    reset();
    const direct = await loadProductionCoverage(db as unknown as PrismaClient, window);
    assertSafeReport(direct);
    assert.deepEqual(transactionOptions, [{ isolationLevel: "RepeatableRead", timeout: 30_000 }]);
    assert.equal(factQueries, 1);
    assertQueryBoundary(queries.at(-1)!);

    reset();
    denied = true;
    const unauthorized = await route.GET(request("from=bad&to=bad"));
    assert.equal(unauthorized.status, 401);
    assert.equal(transactions, 0, "authorization precedes invalid-window parsing and all database access");
    assert.deepEqual(steps, ["auth"]);

    for (const search of ["from=2026-10-01", "from=bad&to=bad", "from=2026-02-30&to=2026-03-01",
      "from=2026-10-20&to=2026-10-01", "from=2026-10-01&to=2026-10-01", "from=2025-01-01&to=2026-10-20"]) {
      reset();
      const invalid = await route.GET(request(search));
      assert.equal(invalid.status, 400, "invalid windows return a generic client error");
      assert.equal(transactions, 0, "invalid input never opens a database transaction");
      assertNotCached(invalid);
      const body = await invalid.json();
      assert.deepEqual(Object.keys(body), ["error"]);
      assert.equal(typeof body.error, "string");
    }

    reset();
    const success = await route.GET(request());
    assert.equal(success.status, 200);
    assertNotCached(success);
    assertSafeReport(await success.json());
    assert.equal(transactions, 1);
    assert.equal(factQueries, 1);
    assert.equal(steps[0], "auth");

    for (const state of ["off", null, true, "ON"]) {
      reset(); readOnly = state;
      await assert.rejects(loadProductionCoverage(db as unknown as PrismaClient, window));
      assert.equal(factQueries, 0, "unconfirmed read-only transactions fail before the aggregate query");
    }
    for (const point of ["set", "setting", "facts"] as const) {
      reset(); failure = point;
      const failed = await route.GET(request());
      assert.equal(failed.status, 500);
      assertNotCached(failed);
      const text = await failed.text();
      assert(!text.includes(canary), "database exception details cannot cross the route");
      const body = JSON.parse(text) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body), ["error"]);
      assert.equal(typeof body.error, "string");
      assert.equal(factQueries, point === "facts" ? 1 : 0);
    }
    assert.deepEqual(parseProductionCoverageArgs(["--from", window.from, "--to", window.to]), { help: false, window });
    assert.deepEqual(parseProductionCoverageArgs(["--to", window.to, "--from", window.from]), { help: false, window });
    assert.deepEqual(parseProductionCoverageArgs(["--help"]), { help: true });
    assert.equal(parseProductionCoverageArgs([]).help, false);
    for (const args of [["--write"], ["--apply"], ["--help", "--write"], ["--from"], ["--from", window.from],
      ["--to", window.to], ["--from", window.from, "--from", window.from, "--to", window.to],
      ["--from", canary, "--to", window.to]]) {
      assert.throws(() => parseProductionCoverageArgs(args), "CLI accepts only valid unambiguous date flag pairs");
    }
    for (const args of [["--help"], [], ["--write"]]) {
      const child = spawnSync(process.execPath, ["--import", "tsx", "scripts/live/production-coverage.ts", ...args], {
        cwd: root, env: { ...process.env, DATABASE_URL: "" }, encoding: "utf8", timeout: 15_000,
      });
      assert.equal(child.error, undefined, "CLI exits without a database or external service");
      assert.equal(child.status, args[0] === "--help" ? 0 : 1);
      assert(!`${child.stdout}${child.stderr}`.includes(canary));
      if (args[0] === "--help") {
        assert.match(child.stdout, /Usage:/);
        assert.equal(child.stderr, "");
      } else {
        assert.equal(child.stdout, "");
        assert.equal(child.stderr.trim(), "Coverage report failed. Check UTC dates and database access; no credentials or lesson data were printed.");
      }
    }
    assert.equal(networkCalls, 0);
    assert(logs.every(values => values.length === 1 && typeof values[0] === "string"),
      "error logging contains a fixed message only, never database errors or structured student data");
    assert(!JSON.stringify(logs).includes(canary));
  } finally {
    globalThis.fetch = realFetch;
    console.error = originalError;
    console.warn = originalWarn;
    mock.restoreAll();
  }
  console.log("✓ production coverage boundary: admin-gated, read-only, bounded, complete and content-free");
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
