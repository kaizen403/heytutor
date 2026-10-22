import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CoverageReport } from "../../lib/admin/coverage";
import { CoverageContent, CoverageView, CoverageWindowForm, coverageRequestPending } from "../../features/admin/turns/CoverageView";

const counts = {
  savedLessons: 9, needed: 6, drawn: 4, neededDrawn: 3, neededEmpty: 2,
  neededUnknown: 1, empty: 3, unrecordedNeed: 2, unrecordedOutcome: 2,
};
const report: CoverageReport = {
  window: { from: "2026-10-14", to: "2026-10-21" }, totals: counts,
  subjects: [{ ...counts, subject: "physics", chapterId: null, chapter: "All chapters" }],
  chapters: [{ ...counts, subject: "physics", chapterId: null, chapter: "Unrecorded" }],
  emptyReasons: [{ subject: "physics", chapterId: null, chapter: "Unrecorded", requirement: "required",
    status: "stopped", degradationReason: "required_visual_unavailable", failureCode: "fallback_suppressed",
    issueCodes: ["source_policy_suppressed"], unknownIssueCount: 2, strategy: "strict",
    fallbackSuppressed: "yes", evidence: "validated_without_saved_ink", lessons: 2 }],
  scan: { budget: 5_000, scanned: 9, truncated: false },
};
const noop = () => {};
const render = (data: CoverageReport | null, loading = false, error: string | null = null) =>
  renderToStaticMarkup(<CoverageContent data={data} loading={loading} error={error} onRetry={noop} />);

// Match neighboring standalone JSX verification scripts without changing app config.
const previousReact = Object.getOwnPropertyDescriptor(globalThis, "React");
Object.defineProperty(globalThis, "React", { value: React, configurable: true });
try {
  const markup = render(report);
  for (const label of ["Saved lessons", "Needed figures", "Required drawn", "Required empty",
    "Required unknown", "Unrecorded need", "Unknown outcome", "All drawn", "All confirmed empty",
    "By subject", "By chapter", "Confirmed empty diagnostics", "Unknown issue count", "Fallback suppressed"])
    assert(markup.includes(label), `coverage must name ${label} explicitly`);
  for (const evidence of ["physics", "Unrecorded", "required", "stopped", "required_visual_unavailable",
    "fallback_suppressed", "source_policy_suppressed", "strict", "validated_without_saved_ink", "yes"])
    assert(markup.includes(evidence), `confirmed-empty tuple must include ${evidence}`);
  assert.match(markup, /Full window: 9 saved lessons/);
  assert.match(render({ ...report, scan: { budget: 5_000, scanned: 5_000, truncated: true } }), /Partial scan: the newest 5,000 saved lessons/);
  assert.match(markup, /2026-10-14.*2026-10-21/);
  assert.match(markup, /inclusive.*exclusive/);
  assert.match(markup, /Chapter.*Unrecorded.*not inferred/s);
  assert.match(markup, /Unknown outcomes are separate from confirmed empty/);
  assert.equal((markup.match(/<caption/g) ?? []).length, 3, "each data table has a caption");
  assert.equal((markup.match(/overflow-x-auto/g) ?? []).length, 3, "tables scroll on narrow screens");
  assert.match(markup, /scope="col"/);
  assert.match(markup, /scope="row"/);

  const withPrivateExtras = { ...report, question: "private-question", narration: "private-narration",
    turnId: "private-turn-id", traceUrl: "https://private-trace.invalid" };
  const privateMarkup = render(withPrivateExtras);
  assert.doesNotMatch(privateMarkup, /private-|href=/, "only selected aggregate fields are rendered");

  const zero = Object.fromEntries(Object.keys(counts).map(key => [key, 0]));
  const noLessons: CoverageReport = { ...report, totals: { ...counts, ...zero }, subjects: [], chapters: [], emptyReasons: [],
    scan: { budget: 5_000, scanned: 0, truncated: false } };
  assert.match(render(noLessons), /No saved lessons in this UTC window/);
  assert.match(render(noLessons), /Full window: 0 saved lessons/);
  assert.match(render({ ...report, emptyReasons: [] }), /No confirmed empty figures/);
  assert.match(render(null, true), /Loading saved lesson coverage/);
  assert.match(render(null, false, "unauthorized"), /Admins only/);
  assert.match(render(null, false, "request_failed"), /Could not load coverage/);
  assert.match(render(null, false, "request_failed"), /Try again/);
  assert.doesNotMatch(render(null, false, "request_failed"), /disabled/);
  assert.match(render(null, true, "request_failed"), /disabled/);
  assert.match(render(null, false, "busy"), /Coverage report already running/);
  assert.match(render(null, false, "busy"), /Wait for the current coverage query/);
  assert.equal(coverageRequestPending(true, true, null), true);
  assert.equal(coverageRequestPending(false, true, null), false);
  assert.equal(coverageRequestPending(false, false, null), true);
  assert.equal(coverageRequestPending(false, false, "busy"), false);

  const form = renderToStaticMarkup(<CoverageView />);
  assert.match(form, /type="date"/);
  assert.match(form, /From \(UTC, inclusive\)/);
  assert.match(form, /To \(UTC, exclusive\)/);
  assert.match(form, /Maximum 366 days/);
  assert.match(form, /marks the scan as partial/);
  assert.match(form, /<button(?=[^>]*disabled)[^>]*>Apply window<\/button>/);
  assert.match(form, /<button(?=[^>]*disabled)[^>]*>[\s\S]*?Refresh<\/button>/);
  assert.doesNotMatch(form, /type="search"/, "coverage has no source-text query control");
  const idle = renderToStaticMarkup(<CoverageWindowForm from="2026-10-14" to="2026-10-21" loading={false}
    validationError={null} onFrom={noop} onTo={noop} onSubmit={event => event.preventDefault()} />);
  assert.doesNotMatch(idle, /<button[^>]*disabled/);
  const busyForm = renderToStaticMarkup(<CoverageWindowForm from="2026-10-14" to="2026-10-21" loading
    validationError="Choose an end date after the start date, with a maximum span of 366 days."
    onFrom={noop} onTo={noop} onSubmit={event => event.preventDefault()} />);
  assert.match(busyForm, /<button[^>]*disabled[^>]*>Apply window/);
  assert.match(busyForm, /aria-busy="true"/);
  assert.match(readFileSync(new URL("../../features/admin/shared/hooks/useAdminQuery.ts", import.meta.url), "utf8"),
    /status === 429\) return "busy"/);
  console.log("PASS production coverage UI: aggregate tables, diagnostics, UTC bounds and explicit states");
} finally {
  if (previousReact) Object.defineProperty(globalThis, "React", previousReact);
  else Reflect.deleteProperty(globalThis, "React");
}
