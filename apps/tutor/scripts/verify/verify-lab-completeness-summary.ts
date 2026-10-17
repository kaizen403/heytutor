/**
 * The lab round summary (summary.json, through summarize) and the printed
 * report say what the completeness round did: rounds attempted, accepted and
 * skipped for time, the outcome counts, items missing before, requested and
 * still missing, and the median and p90 time a round that called added.
 *
 * Invented records: a replaced figure, an equally incomplete reply, a reply
 * refused for changing geometry, a round skipped for time, a figure that
 * missed nothing, and a run with no planner figure (no record, not counted).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SceneCompletenessRoundRecord } from "@heytutor/tutor-core";
import type { LectureRun } from "../lecture-lab/lecturePipeline";
import { printSummary, summarize } from "../lecture-lab/summarize";

const items = (count: number, prefix: string) => Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);
const record = (input: {
  outcome: SceneCompletenessRoundRecord["outcome"]; before: number; requested: number; still: number; extraMs: number;
}): SceneCompletenessRoundRecord => ({
  attempted: input.requested > 0,
  accepted: input.outcome === "replaced",
  outcome: input.outcome,
  itemsMissingBefore: items(input.before, "item"),
  itemsRequested: items(input.requested, "item"),
  itemsStillMissing: items(input.still, "item"),
  replyMissingCount: null,
  lostIds: [],
  lostLabels: [],
  changedContent: [],
  replyErrorCodes: [],
  remainingMsAtStart: 40_000,
  extraMs: input.extraMs,
});
let unit = 0;
const run = (completeness: SceneCompletenessRoundRecord | null) => ({
  probeId: `probe-${unit}`, unitId: `unit-${(unit += 1)}`,
  diagram: { committed: completeness !== null, entityIds: [`figure-${unit}`], completeness },
}) as unknown as LectureRun;

const runs = [
  run(record({ outcome: "replaced", before: 3, requested: 3, still: 0, extraMs: 9_000 })),
  run(record({ outcome: "not_more_complete", before: 2, requested: 2, still: 2, extraMs: 12_000 })),
  run(record({ outcome: "changed_content", before: 4, requested: 4, still: 4, extraMs: 15_000 })),
  run(record({ outcome: "skipped_deadline", before: 1, requested: 0, still: 1, extraMs: 0 })),
  run(record({ outcome: "complete", before: 0, requested: 0, still: 0, extraMs: 0 })),
  run(null),
];

const summary = summarize([], runs);
assert.deepEqual(summary.completeness, {
  rounds: 5,
  attempted: 3,
  accepted: 1,
  skippedForTime: 1,
  outcomes: { replaced: 1, not_more_complete: 1, changed_content: 1, skipped_deadline: 1, complete: 1 },
  itemsMissingBefore: 10,
  itemsRequested: 9,
  itemsStillMissing: 7,
  // Over the three rounds that called (9 s, 12 s, 15 s), nearest rank; the two that did not call add nothing.
  extraMs: { median: 12_000, p90: 15_000 },
}, "the round summary carries the completeness round");
assert.deepEqual(summarize([], [run(null)]).completeness.extraMs, { median: null, p90: null }, "no round, no time");

// The printed report states it in one line, for lesson rounds and figure-only rounds alike.
const printed: string[] = [];
const log = console.log;
console.log = (...parts: unknown[]) => { printed.push(parts.map(String).join(" ")); };
try {
  printSummary(summary);
  printSummary({ ...summary, figureOnlyRows: 5, graded: 0 });
} finally {
  console.log = log;
}
const line = "completeness rounds: 3/5 attempted, 1 accepted, 1 skipped for time; items 9 requested, 7 still missing (10 before); extra median 12000 ms, p90 15000 ms";
assert.equal(printed.filter((text) => text === line).length, 2, `the report prints the completeness line: ${JSON.stringify(printed)}`);

// The evaluation branch of the runner prints the same line after its JSON.
const runner = readFileSync(resolve(process.cwd(), "scripts/lecture-lab/run.ts"), "utf8");
assert(/if \(evaluationRows\) \{\s*console\.log\(JSON\.stringify\(summary\.evaluation, null, 2\)\);\s*console\.log\(formatCompletenessSummary\(summary\.completeness\)\);\s*\} else printSummary\(summary\);/.test(runner),
  "evaluation rounds print the completeness line too");

console.log("lab completeness summary: attempted, accepted, skipped for time, items and extra time are in summary.json and the printed report");
