import assert from "node:assert/strict";
import { aggregateCoverage, parseCoverageWindow, type CoverageFact } from "../../lib/admin/coverage";

const window = parseCoverageWindow(new URLSearchParams("from=2026-10-01&to=2026-10-08"));
const fact = (extra: Partial<CoverageFact> = {}): CoverageFact => ({ subject: "physics", chapterId: null,
  requirement: "required", visualStatus: "text_only", status: "complete", hasTrustedInk: false,
  degradationReason: "candidate_invalid", issueCodes: ["exact_assertion_unproven"],
  failureCode: null, failureIssueCodes: [], strategy: "strict", count: 1n, ...extra });
const report = aggregateCoverage([
  fact({ count: 2n }),
  fact({ visualStatus: "validated", hasTrustedInk: true, count: 3n }),
  fact({ issueCodes: ["source_policy_suppressed"], failureCode: "fallback_suppressed" }),
  fact({ requirement: "none", subject: "chemistry", degradationReason: null, issueCodes: [] }),
  fact({ requirement: null, subject: null, visualStatus: null, degradationReason: null, issueCodes: [] }),
  fact({ visualStatus: "validated", hasTrustedInk: false }),
], window);
assert.equal(report.totals.savedLessons, 9);
assert.equal(report.totals.needed, 7);
assert.equal(report.totals.neededDrawn, 3);
assert.equal(report.totals.neededEmpty, 4);
assert.equal(report.totals.empty, 5);
assert.equal(report.totals.unrecordedOutcome, 1);
assert.equal(report.totals.unrecordedNeed, 1);
assert.equal(report.emptyReasons.reduce((sum, row) => sum + row.lessons, 0), report.totals.empty);
assert.equal(report.emptyReasons.find(row => row.failureCode === "fallback_suppressed")?.fallbackSuppressed, "yes");
assert.equal(report.emptyReasons.find(row => row.lessons === 2)?.fallbackSuppressed, "unrecorded");
assert(report.emptyReasons.some(row => row.evidence === "validated_without_saved_ink"));
assert(report.subjects.some(row => row.subject === "unknown"));
assert(report.chapters.every(row => row.chapterId === null && row.chapter === "Unrecorded"));
assert.equal(aggregateCoverage([], window).totals.savedLessons, 0);
assert.equal(aggregateCoverage([fact({ recordedUnknownIssueCount: 5 })], window).emptyReasons[0]!.unknownIssueCount, 5);
const chapters = aggregateCoverage([fact({ chapterId: "physics|1" }), fact({ chapterId: "physics|2" })], window);
assert.equal(chapters.chapters.length, 2, "an explicit taxonomy binding is grouped, not guessed");
assert(chapters.chapters.every(row => row.chapterId !== null));

const canary = "PRIVATE_STUDENT_QUESTION_AND_EMAIL";
const privateReport = aggregateCoverage([fact({ subject: canary, chapterId: canary,
  degradationReason: canary, issueCodes: [canary, "a_private_student_identifier", "exact_assertion_unproven"],
  failureIssueCodes: [canary], failureCode: canary, strategy: canary })], window);
assert(!JSON.stringify(privateReport).includes(canary));
assert(!JSON.stringify(privateReport).includes("a_private_student_identifier"));
assert(privateReport.emptyReasons[0]!.unknownIssueCount > 0);
for (const query of ["from=2026-02-30&to=2026-03-04", "from=2026-10-08&to=2026-10-01",
  "from=2020-01-01&to=2026-10-01", "from=oops&to=2026-10-01", "from=2026-10-01", "to=2026-10-01"]) {
  assert.throws(() => parseCoverageWindow(new URLSearchParams(query)), "reject invalid or incomplete windows");
}
console.log("verify-production-coverage: required/drawn/empty conservation, unknowns, exact diagnostic tuples, privacy and UTC windows");
