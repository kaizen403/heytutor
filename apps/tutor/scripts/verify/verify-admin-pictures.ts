/**
 * Admin Pictures page: the period window, the folds over content-free facts
 * (needed, attempted, shown, declined, unavailable, skipped), zero division
 * and empty data, malformed telemetry, the SQL scope (lesson kind only, saved
 * statuses, whole UTC days, no blobs), the route gate, and a static render.
 *
 * With a localhost DATABASE_URL (or PICTURES_TEST_DATABASE_URL) it also runs
 * the real SQL over temporary tables inside one transaction that is rolled
 * back, so no real row is read or written. `--db` makes that part required.
 *
 *   npx tsx scripts/verify/verify-admin-pictures.ts
 *   pnpm --filter @heytutor/tutor exec dotenv -e .env.local -- tsx scripts/verify/verify-admin-pictures.ts --db
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrismaClient } from "@prisma/client";
import {
  aggregatePictureOutcomes,
  parsePicturesPeriod,
  percentileMs,
  pictureScan,
  picturesWindow,
  PICTURE_SCAN_BUDGET,
  shapeLibraryRow,
  shapePictureCache,
  shapePictureTurn,
  windowDays,
  type PictureFact,
  type PicturesReport,
} from "../../lib/admin/pictures";
import { pictureFactsQuery, pictureLessonScope, pictureLibraryQuery, pictureRecentQuery, queryPicturesReport } from "../../lib/admin/picturesQueries";
import { PicturesContent } from "../../features/admin/pictures/PicturesView";

const root = resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");
const NOW = Date.UTC(2026, 9, 27, 12, 0);
const PICTURE = "rp_3a504b6daf5cbb28d92346c2";

// --- period --------------------------------------------------------------------------
{
  const week = parsePicturesPeriod(new URLSearchParams(""), NOW);
  assert.deepEqual(week, { days: 7, from: "2026-10-21", to: "2026-10-28" }, "default is 7 whole UTC days ending today");
  assert.equal(windowDays(week).length, 7);
  assert.deepEqual(parsePicturesPeriod(new URLSearchParams("days=1"), NOW), { days: 1, from: "2026-10-27", to: "2026-10-28" });
  assert.equal(parsePicturesPeriod(new URLSearchParams("days=90"), NOW).from, "2026-07-30");
  // Late on the last day of a month still ends at the next UTC midnight.
  assert.deepEqual(picturesWindow(30, Date.UTC(2026, 9, 31, 23, 59)), { days: 30, from: "2026-10-02", to: "2026-11-01" });
  for (const query of ["days=0", "days=2", "days=365", "days=7.5", "days=abc", "days=-7", "days=", "days=7&days=30", "days=1e1"]) {
    assert.throws(() => parsePicturesPeriod(new URLSearchParams(query), NOW), /invalid_pictures_period/, `reject ${query}`);
  }
}

// --- percentiles -------------------------------------------------------------------------
{
  assert.equal(percentileMs([], 0.5), null, "no attempts is null, not 0");
  assert.equal(percentileMs([7], 0.9), 7);
  assert.equal(percentileMs([40, 10, 30, 20], 0.5), 25, "median interpolates and does not depend on order");
  assert.equal(percentileMs([10, 20, 30, 40], 0.9), 37);
}

// --- folds ------------------------------------------------------------------------------
const window = picturesWindow(7, NOW);
const outcome = (status: string, ms: number, extra: Record<string, unknown> = {}) =>
  ({ attempted: true, status, reason: status === "shown" ? null : `${status}_reason`, ms, speculative: false, ...extra });
const fact = (extra: Partial<PictureFact> = {}): PictureFact => ({ day: "2026-10-27", subject: "other", requirement: "required",
  visualStatus: "text_only", outcome: null, pictureId: null, pictureSource: null, ...extra });
{
  const empty = aggregatePictureOutcomes([], window);
  assert.equal(empty.totals.lessons, 0);
  assert.equal(empty.totals.needed, 0);
  assert.equal(empty.totals.shownRate, null, "nothing needed: the rate is n/a, not 0% and not NaN");
  assert.equal(empty.totals.shownOfAttempted, null);
  assert.deepEqual(empty.ms.attempted, { count: 0, medianMs: null, p90Ms: null });
  assert.deepEqual(empty.scan, { budget: PICTURE_SCAN_BUDGET, scanned: 0, truncated: false });
  assert.deepEqual(empty.subjects.map((row) => row.subject), ["maths", "physics", "chemistry", "other"], "zero subjects still listed; unknown only when present");
  assert(empty.subjects.every((row) => row.shownRate === null));
  assert.equal(empty.daily.needed.length, 7);
  assert(empty.daily.needed.every((point) => point.count === 0) && empty.daily.shown.every((point) => point.count === 0));
  assert.equal(empty.reasons.length + empty.sources.length, 0);
  assert(!JSON.stringify(empty).includes("NaN") && !JSON.stringify(empty).includes("null%"));

  const noAttempts = aggregatePictureOutcomes([fact(), fact({ subject: "maths" })], window);
  assert.equal(noAttempts.totals.needed, 2);
  assert.equal(noAttempts.totals.notAttempted, 2, "flag off: every needed lesson is not attempted");
  assert.equal(noAttempts.totals.shownRate, 0);
  assert.equal(noAttempts.totals.shownOfAttempted, null, "no attempts: shown of attempted is n/a");
}
{
  const report = aggregatePictureOutcomes([
    fact({ outcome: outcome("shown", 10_000, { speculative: true }), pictureId: PICTURE, pictureSource: "wikimedia" }),
    fact({ outcome: outcome("shown", 20_000), pictureId: PICTURE, pictureSource: "wikimedia", subject: "maths", day: "2026-10-25" }),
    fact({ outcome: outcome("shown", 30_000), subject: "physics" }),
    fact({ outcome: outcome("declined", 40_000, { reason: "no_candidate_accepted" }), subject: "physics", requirement: "optional" }),
    fact({ outcome: outcome("declined", 1_000, { reason: "no_candidate_accepted" }), subject: "chemistry" }),
    fact({ outcome: outcome("unavailable", 25_000, { reason: "wait_deadline" }), subject: "chemistry" }),
    fact({ outcome: outcome("skipped", 500, { reason: "not_waited" }), subject: null, requirement: null }),
    fact({ subject: "maths" }),
    fact({ outcome: outcome("declined", 9_000, { reason: "no_candidates" }), requirement: null, subject: "PRIVATE_SUBJECT_CANARY" }),
    // Not needed: the engine drew, or the plan said none.
    fact({ visualStatus: "validated", outcome: outcome("skipped", 800, { reason: "verified_figure", speculative: true }) }),
    fact({ visualStatus: "validated" }),
    fact({ requirement: "none", outcome: outcome("skipped", 300, { reason: "not_waited" }) }),
    fact({ requirement: "none" }),
    // Malformed telemetry reads as no attempt and is never echoed.
    fact({ outcome: { attempted: true, status: "shown", reason: "<script>alert(1)</script>", ms: -1, speculative: false } }),
    fact({ outcome: { attempted: true, status: "bogus", reason: null, ms: 10, speculative: false } }),
    fact({ outcome: "shown" }),
  ], window);
  const { totals } = report;
  assert.equal(totals.lessons, 16);
  assert.equal(totals.engineDrew, 2);
  assert.equal(totals.needed, 12, "required or optional and not drawn, plus unrecorded plans with picture evidence");
  assert.equal(totals.unrecordedNeed, 2);
  assert.equal(totals.attempted, 8);
  assert.equal(totals.notAttempted, 4, "one with no outcome, three with malformed outcomes");
  assert.equal(totals.shown, 3);
  assert.equal(totals.declined, 3);
  assert.equal(totals.unavailable, 1);
  assert.equal(totals.skipped, 1);
  assert.equal(totals.attempted, totals.shown + totals.declined + totals.unavailable + totals.skipped, "statuses partition the attempts");
  assert.equal(totals.needed, totals.attempted + totals.notAttempted, "attempted and not attempted partition the need");
  assert.equal(totals.shownUnsaved, 1, "browser said shown, server saved nothing");
  assert.equal(totals.abandonedAfterDraw, 1);
  assert.equal(totals.outsideNeed, 1);
  assert.equal(totals.speculative, 1);
  assert.equal(totals.shownRate, 3 / 12);
  assert.equal(totals.shownOfAttempted, 3 / 8);
  assert.deepEqual(report.sources, [{ source: "wikimedia", count: 2 }], "only saved pictures count toward a source");
  assert.deepEqual(report.ms.attempted, { count: 8, medianMs: 15_000, p90Ms: 33_000 });
  assert.deepEqual(report.ms.shown, { count: 3, medianMs: 20_000, p90Ms: 28_000 });
  assert.deepEqual(report.reasons[0], { status: "declined", reason: "no_candidate_accepted", count: 2 });
  assert.equal(report.reasons.reduce((sum, row) => sum + row.count, 0), totals.declined + totals.unavailable + totals.skipped);
  const subjects = new Map(report.subjects.map((row) => [row.subject, row]));
  assert.equal(subjects.get("chemistry")?.needed, 2);
  assert.equal(subjects.get("chemistry")?.shownRate, 0);
  assert.equal(subjects.get("unknown")?.needed, 2, "a missing or unknown subject is unknown, never other");
  assert.equal(report.subjects.reduce((sum, row) => sum + row.needed, 0), totals.needed, "subjects partition the need");
  assert.equal(report.daily.needed.find((point) => point.day === "2026-10-25")?.count, 1);
  assert.equal(report.daily.shown.find((point) => point.day === "2026-10-27")?.count, 2);
  assert.equal(report.daily.needed.reduce((sum, point) => sum + point.count, 0), totals.needed);
  const text = JSON.stringify(report);
  for (const canary of ["PRIVATE_SUBJECT_CANARY", "<script>", "bogus"]) assert(!text.includes(canary), `${canary} never leaves the fold`);

  // A day outside the window is counted in the totals it belongs to but never smeared into an edge bucket.
  const stray = aggregatePictureOutcomes([fact({ day: "2026-01-01" })], window);
  assert.equal(stray.totals.needed, 1);
  assert.equal(stray.daily.needed.reduce((sum, point) => sum + point.count, 0), 0);
}
{
  assert.deepEqual(pictureScan([fact({ windowMatches: 2n }), fact({ windowMatches: 2n })]), { budget: PICTURE_SCAN_BUDGET, scanned: 2, truncated: false });
  const full = Array.from({ length: PICTURE_SCAN_BUDGET }, () => fact({ windowMatches: BigInt(PICTURE_SCAN_BUDGET + 1) }));
  assert.deepEqual(pictureScan(full), { budget: PICTURE_SCAN_BUDGET, scanned: PICTURE_SCAN_BUDGET, truncated: true }, "the witness marks a partial scan");
  assert.throws(() => pictureScan([fact({ windowMatches: 1n }), fact({ windowMatches: 1n })]), /pictures_scan_mismatch/);
  assert.throws(() => pictureScan([fact({ windowMatches: 3n }), fact({ windowMatches: 3n })]), /pictures_scan_mismatch/);
}

// --- rows -------------------------------------------------------------------------------
{
  const base = { id: "00000000-0000-0000-0000-000000000001", createdAt: new Date(NOW), question: "Explain the eye.", userId: "user_abcdef123",
    userName: null, userEmail: null, subject: "other", requirement: "required", visualStatus: "text_only", figureSource: "text_only",
    diagramResultStatus: "text_only", degradation: { reason: "missing_capability", issueCodes: [] }, outcome: outcome("shown", 12_345),
    pictureId: PICTURE, pictureSource: "wikimedia", pictureTitle: "Eye diagram", pictureLicense: "CC BY-SA 4.0" };
  const row = shapePictureTurn(base)!;
  assert.equal(row.userLabel, "user_abc", "no name or email falls back to a short id, as the other tables do");
  assert.equal(row.engine.outcome, "text_only");
  assert.equal(row.engine.degradationReason, "missing_capability");
  assert.equal(row.shown?.thumbUrl, `/api/reference-picture/${PICTURE}/image`);
  assert.equal(row.picture?.ms, 12_345);
  assert.equal(shapePictureTurn({ ...base, pictureId: "rp_forged", question: "x".repeat(5_000) })?.shown, null, "a forged id shows no picture");
  assert.equal(shapePictureTurn({ ...base, question: "x".repeat(5_000) })!.question.length, 240, "the question is cut before it leaves the server");
  assert.equal(shapePictureTurn({ ...base, userName: "  Asha  " })!.userLabel, "Asha");
  assert.equal(shapePictureTurn({ ...base, subject: "biology", requirement: "maybe" })!.subject, "unknown");
  assert.equal(shapePictureTurn({ ...base, createdAt: "not a date" }), null);
  assert.equal(shapePictureTurn({ ...base, outcome: { status: "shown" } })!.picture, null);

  const library = { id: PICTURE, source: "wikimedia", title: "Neuron", shows: "structure of a neuron", license: "Public domain", artist: "LadyofHats",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Neuron.svg", labelCount: 29, width: "760", height: "553",
    createdAt: new Date(NOW), turns: 3n, lastUsedAt: new Date(NOW) };
  const shaped = shapeLibraryRow(library)!;
  assert.equal(shaped.turns, 3);
  assert.equal(shaped.width, 760);
  assert.equal(shapeLibraryRow({ ...library, pageUrl: "javascript:alert(1)" })!.pageUrl, null, "only https page links survive");
  assert.equal(shapeLibraryRow({ ...library, turns: 0, lastUsedAt: null })!.lastUsedAt, null);
  assert.equal(shapeLibraryRow({ ...library, id: "not-a-picture" }), null);

  const cache = shapePictureCache({ totals: { total: 5n, accepted: 2n, declined: 3n, declinedActive: 1n },
    reasons: [{ reason: "no_candidates", count: 2n, latestAt: new Date(NOW) }, { reason: null, count: 1n, latestAt: null },
      { reason: "Student asked about <b>", count: 4n, latestAt: null }],
    recent: [{ keyPrefix: "abc123<def>", reason: "plan_failed", createdAt: new Date(NOW) }, { keyPrefix: "x", reason: null, createdAt: null }] });
  assert.deepEqual(cache.reasons.map((row) => row.reason), ["unrecognised", "no_candidates", "no_picture"], "free text never displays");
  assert.equal(cache.recent.length, 1);
  assert.equal(cache.recent[0]!.keyPrefix, "abc123def");
  assert.equal(shapePictureCache({ totals: undefined, reasons: [], recent: [] }).total, 0, "an empty cache reads zero");
}

// --- SQL scope ------------------------------------------------------------------------------
{
  const scope = pictureLessonScope(window);
  assert.match(scope.text, /t\.kind = 'lesson'/, "lesson turns only: a resume copies its lesson's outcome");
  assert.match(scope.text, /t\.status IN \('complete', 'stopped'\)/);
  assert.match(scope.text, /board-continuation\/v1/);
  assert.match(scope.text, /t\.created_at >= \$1 AND t\.created_at < \$2/);
  assert.deepEqual(scope.values, [new Date("2026-10-21T00:00:00.000Z"), new Date("2026-10-28T00:00:00.000Z")], "whole UTC days, end exclusive");
  const facts = pictureFactsQuery(window).text;
  assert.match(facts, /LIMIT \$\d+/);
  assert.equal(pictureFactsQuery(window).values.at(-2), PICTURE_SCAN_BUDGET + 1, "one witness row past the budget");
  for (const column of ["question", "raw_response", "user_id", "email"]) assert(!facts.includes(column), `facts never read ${column}`);
  for (const query of [pictureFactsQuery(window), pictureRecentQuery(window), pictureLibraryQuery(window)]) {
    assert(!/rp\.(image|plan)\b|raw_response|audio_url|scene_document/.test(query.text), "no blobs, drafts, audio or scene documents");
    assert.match(query.text, /t\.kind = 'lesson'/, "every turn read is scoped to lessons");
  }
  assert.match(pictureRecentQuery(window).text, /LEFT\(t\.question, \$\d+::int\)/, "questions are cut in SQL");
  const route = read("app/api/admin/pictures/route.ts");
  assert(route.includes("requireAdminRequest") && route.includes('export const dynamic = "force-dynamic"'), "the pictures API stays gated and dynamic");
  assert(!/console\.error\([^)]*error\)/.test(route), "the route never logs a row payload");
  assert(read("features/admin/nav/AdminNav.tsx").includes('href: "/admin/pictures"'), "the nav links the Pictures page");
}

// --- static render ------------------------------------------------------------------------
function sampleReport(): PicturesReport {
  const summary = aggregatePictureOutcomes([
    fact({ outcome: outcome("shown", 10_000), pictureId: PICTURE, pictureSource: "wikimedia" }),
    fact({ outcome: outcome("declined", 9_000, { reason: "no_candidate_accepted" }), subject: "physics" }),
  ], window);
  return { ...summary, generatedAt: new Date(NOW).toISOString(), window,
    recent: [shapePictureTurn({ id: "00000000-0000-0000-0000-000000000002", createdAt: new Date(NOW), question: "Explain the neuron.",
      userId: "user_1", userName: "Asha", userEmail: null, subject: "other", requirement: "required", visualStatus: "text_only",
      figureSource: "text_only", diagramResultStatus: "text_only", degradation: null, outcome: outcome("shown", 10_000),
      pictureId: PICTURE, pictureSource: "wikimedia", pictureTitle: "Neuron", pictureLicense: "Public domain" })!],
    library: { total: 1, wikimedia: 1, generated: 0, truncated: false, rows: [shapeLibraryRow({ id: PICTURE, source: "wikimedia",
      title: "Neuron", shows: "structure of a neuron", license: "Public domain", artist: "LadyofHats", pageUrl: "javascript:alert(1)",
      labelCount: 29, width: 760, height: 553, createdAt: new Date(NOW), turns: 1, lastUsedAt: new Date(NOW) })!] },
    cache: shapePictureCache({ totals: { total: 1, accepted: 0, declined: 1, declinedActive: 1 },
      reasons: [{ reason: "no_candidates", count: 1, latestAt: new Date(NOW) }], recent: [] }) };
}
{
  const previousReact = Object.getOwnPropertyDescriptor(globalThis, "React");
  Object.defineProperty(globalThis, "React", { value: React, configurable: true });
  try {
    const render = (data: PicturesReport | null, error: string | null = null) =>
      renderToStaticMarkup(React.createElement(PicturesContent, { data, loading: false, error, onRetry: () => {} }));
    const markup = render(sampleReport());
    for (const label of ["Needed, engine did not draw", "Picture attempted", "Shown rate", "Median time", "p90 time", "By subject",
      "Recent lessons with a picture outcome", "Picture library", "Topic cache", "Cached declines", "no candidate accepted"]) {
      assert(markup.includes(label), `the page names ${label}`);
    }
    assert(markup.includes(`/api/reference-picture/${PICTURE}/image`), "thumbnails load from the public asset route");
    assert(markup.includes('href="/admin/users/user_1"'), "the turn links to the user detail page");
    assert(!markup.includes("javascript:"), "a script page URL never renders as a link");
    assert(!markup.includes("NaN"));
    const emptyMarkup = render({ ...sampleReport(), ...aggregatePictureOutcomes([], window), recent: [] });
    assert(emptyMarkup.includes("No saved lessons in this period") && emptyMarkup.includes("No picture outcomes in this period"));
    assert(emptyMarkup.includes("n/a"), "an empty period reads n/a for rates and times");
    assert(render(null, "unauthorized").includes("Admins only"));
    assert(render(null).includes("Loading reference picture outcomes"));
  } finally {
    if (previousReact) Object.defineProperty(globalThis, "React", previousReact);
    else Reflect.deleteProperty(globalThis, "React");
  }
}

// --- real SQL over temporary tables (rolled back) -------------------------------------------
class Rollback extends Error {
  constructor(readonly report: PicturesReport) { super("rollback"); }
}

async function verifyDatabase(): Promise<boolean> {
  const raw = process.env.PICTURES_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  const local = raw ? ["localhost", "127.0.0.1"].includes(new URL(raw).hostname) : false;
  if (!raw || !local) {
    assert(!process.argv.includes("--db"), "--db needs a localhost DATABASE_URL or PICTURES_TEST_DATABASE_URL");
    return false;
  }
  const url = new URL(raw);
  url.searchParams.set("connection_limit", "1");
  const db = new PrismaClient({ log: [], datasources: { db: { url: url.toString() } } });
  const at = (ageMs: number) => new Date(NOW - ageMs);
  const HOUR = 3_600_000;
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`CREATE TEMP TABLE turns (id uuid PRIMARY KEY, user_id text, kind text, status text, question text,
        created_at timestamptz, visual_status text, scene_artifacts jsonb) ON COMMIT DROP`;
      await tx.$executeRaw`CREATE TEMP TABLE users (id text PRIMARY KEY, name text, email text) ON COMMIT DROP`;
      await tx.$executeRaw`CREATE TEMP TABLE reference_pictures (id text PRIMARY KEY, source text, record jsonb, created_at timestamptz) ON COMMIT DROP`;
      await tx.$executeRaw`CREATE TEMP TABLE reference_picture_queries (query_key text PRIMARY KEY, picture_id text, reason text, created_at timestamptz) ON COMMIT DROP`;
      // Every name the report reads must resolve to a temporary table, or the check stops before reading anything real.
      const shadows = await tx.$queryRaw<Array<{ schema: string }>>`SELECT n.nspname AS schema FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.oid IN (to_regclass('turns'), to_regclass('users'), to_regclass('reference_pictures'), to_regclass('reference_picture_queries'))`;
      assert(shadows.length === 4 && shadows.every((row) => row.schema.startsWith("pg_temp")), "the SQL check runs on temporary tables only");
      await tx.$executeRaw`INSERT INTO pg_temp.users VALUES ('u1', 'Asha', NULL)`;
      await tx.$executeRaw`INSERT INTO pg_temp.reference_pictures VALUES (${PICTURE}, 'wikimedia', ${JSON.stringify({ title: "Neuron", shows: "structure of a neuron",
        license: "Public domain", artist: "LadyofHats", pageUrl: "https://commons.wikimedia.org/x", labels: ["axon", "dendrite"], width: 760, height: 553 })}::jsonb, ${at(30 * 24 * HOUR)})`;
      const picture = { id: PICTURE, source: "wikimedia", title: "Neuron", license: "Public domain" };
      const rows: Array<[string, Date, string, string, string, Record<string, unknown>]> = [
        ["shown", at(HOUR), "lesson", "complete", "text_only", { referencePictureOutcome: outcome("shown", 10_000), referencePicture: picture }],
        ["stopped", at(2 * HOUR), "lesson", "stopped", "text_only", { referencePictureOutcome: outcome("declined", 20_000, { reason: "no_candidates" }) }],
        ["first-day", new Date("2026-10-21T00:00:00Z"), "lesson", "complete", "text_only", { referencePictureOutcome: outcome("unavailable", 30_000, { reason: "wait_deadline" }) }],
        ["not-attempted", at(3 * HOUR), "lesson", "complete", "text_only", {}],
        ["drew", at(4 * HOUR), "lesson", "complete", "validated", { referencePictureOutcome: outcome("skipped", 800, { reason: "verified_figure" }) }],
        ["doubt", at(HOUR), "doubt", "complete", "text_only", { referencePictureOutcome: outcome("shown", 10_000), referencePicture: picture }],
        ["resume", at(HOUR), "resume", "complete", "text_only", { referencePictureOutcome: outcome("shown", 10_000), referencePicture: picture }],
        ["live", at(HOUR), "lesson", "live", "text_only", { referencePictureOutcome: outcome("shown", 10_000), referencePicture: picture }],
        ["continuation", at(HOUR), "lesson", "complete", "text_only", { boardContinuation: { schemaVersion: "board-continuation/v1" }, referencePictureOutcome: outcome("shown", 1) }],
        ["before-window", new Date("2026-10-20T23:59:59Z"), "lesson", "complete", "text_only", { referencePictureOutcome: outcome("shown", 10_000), referencePicture: picture }],
        ["exclusive-end", new Date("2026-10-28T00:00:00Z"), "lesson", "complete", "text_only", { referencePictureOutcome: outcome("shown", 10_000), referencePicture: picture }],
      ];
      for (const [index, [label, createdAt, kind, status, visual, extra]] of rows.entries()) {
        const id = `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`;
        const artifacts = JSON.stringify({ failureTelemetry: { subject: "other" }, turnPlan: { visualRequirement: "required" }, figureSource: "text_only", ...extra });
        await tx.$executeRaw`INSERT INTO pg_temp.turns VALUES (${id}::uuid, 'u1', ${kind}, ${status}, ${`Question ${label} ${"x".repeat(400)}`}, ${createdAt}, ${visual}, ${artifacts}::jsonb)`;
      }
      await tx.$executeRaw`INSERT INTO pg_temp.reference_picture_queries VALUES ('k_accept', ${PICTURE}, NULL, ${at(HOUR)}),
        ('k_fresh', NULL, 'no_candidates', ${at(HOUR)}), ('k_old', NULL, 'no_candidate_accepted', ${at(48 * HOUR)}), ('k_null', NULL, NULL, ${at(2 * HOUR)})`;
      throw new Rollback(await queryPicturesReport(tx, window, NOW));
    }, { timeout: 30_000 });
    assert.fail("the check transaction must roll back");
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    const report = error.report;
    assert.equal(report.totals.lessons, 5, "doubt, resume, live, continuation and out of window rows are not counted");
    assert.equal(report.totals.needed, 4);
    assert.equal(report.totals.attempted, 3);
    assert.equal(report.totals.shown, 1);
    assert.equal(report.totals.declined, 1);
    assert.equal(report.totals.unavailable, 1);
    assert.equal(report.totals.notAttempted, 1);
    assert.equal(report.totals.abandonedAfterDraw, 1);
    assert.deepEqual(report.ms.attempted, { count: 3, medianMs: 20_000, p90Ms: 28_000 });
    assert.equal(report.daily.needed.find((point) => point.day === "2026-10-21")?.count, 1, "the first UTC day is inclusive");
    assert.deepEqual(report.scan, { budget: PICTURE_SCAN_BUDGET, scanned: 5, truncated: false });
    assert.equal(report.recent.length, 4, "the table lists lessons with an outcome, the engine drawn one included");
    assert.equal(report.recent[0]!.userLabel, "Asha");
    assert.equal(report.recent[0]!.question.length, 240);
    assert.equal(report.recent[0]!.shown?.id, PICTURE);
    assert.equal(report.library.total, 1);
    assert.equal(report.library.rows[0]!.turns, 1, "library uses count lesson turns in the period only");
    assert.equal(report.library.rows[0]!.labelCount, 2);
    assert.equal(report.library.rows[0]!.width, 760);
    assert.deepEqual([report.cache.total, report.cache.accepted, report.cache.declined, report.cache.declinedActive], [4, 1, 3, 2]);
    assert.deepEqual(report.cache.reasons.map((row) => row.reason).sort(), ["no_candidate_accepted", "no_candidates", "no_picture"]);
    assert.equal(report.cache.recent[0]!.reason, "no_candidates", "recent declines are newest first");
  } finally {
    await db.$disconnect();
  }
  return true;
}

verifyDatabase().then((ranDatabase) => {
  console.log(`✓ admin pictures: period, folds, zero division, malformed telemetry, lesson scope, gate, render${ranDatabase ? ", real SQL on rolled back temp tables" : " (SQL check skipped: no localhost database)"}`);
}, (error: unknown) => {
  console.error(error);
  process.exit(1);
});
