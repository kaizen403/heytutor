/**
 * The label arrangement search is bounded by work, not time, and fails fast.
 *
 * A planner candidate for an equipotential-surfaces question (four surfaces,
 * a charge, three vectors, seven labels and three callouts in a 0.075 m
 * scene) spent about 5.3 minutes of single-thread CPU in `placeLabels`
 * before it failed `label_overlap_unresolved`. The compile runs on the
 * student's main thread, so the lesson tab froze for the whole search.
 *
 * The search now spends at most `LABEL_SEARCH_WORK_BUDGET` units per call
 * (a unit is one pairwise test or one routed leader), keeps each pair's
 * answer, and narrows candidate domains one placed label at a time. Every
 * search that finished inside the budget before finds the same arrangement.
 *
 * This gate asserts:
 *   - the recorded candidate (its question replaced by a neutral string)
 *     still fails `label_overlap_unresolved`, says the budget ran out, and
 *     compiles in under `LIMIT_MS`; before the budget it took 318 s;
 *   - the outcome is deterministic: a second compile reports the same issues;
 *   - `placeLabels` honours the budget: a crowded but solvable layout solves
 *     under the default budget and fails as `label_overlap_unresolved` when
 *     its budget is one unit.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-label-search-budget.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { compileSceneDocument, validateSceneDocument } from "../../src";
// A namespace import, so the gate still loads, and fails on time, against an engine without the budget.
import * as labelEngine from "../../src/labels/labelEngine";
import type { LabelOwner } from "../../src/labels/labelEngine";

const { LABEL_SEARCH_WORK_BUDGET, placeLabels } = labelEngine;

const LIMIT_MS = 20_000;

const fixture = JSON.parse(readFileSync(new URL("../fixtures/label-search-stall.json", import.meta.url), "utf8"));
assert.equal(fixture.source.question, "Label search budget fixture.", "the fixture must not carry the probe question");

function compileFixture() {
  const started = performance.now();
  const validated = validateSceneDocument(structuredClone(fixture));
  if (!validated.document) throw new Error(`the fixture no longer validates: ${JSON.stringify(validated.report.issues)}`);
  const compiled = compileSceneDocument(validated.document);
  return { compiled, ms: performance.now() - started };
}

const first = compileFixture();
const fatal = first.compiled.report.issues.filter((issue) => issue.severity === "fatal");
assert.ok(first.ms < LIMIT_MS, `the stalled candidate took ${Math.round(first.ms)} ms; the bound is ${LIMIT_MS} ms`);
assert.equal(first.compiled.ok, false, "the stalled candidate must still be rejected");
assert.ok(
  fatal.some((issue) => issue.code === "label_overlap_unresolved" && /label search budget/.test(issue.message)),
  `expected label_overlap_unresolved from the search budget, got ${JSON.stringify(fatal)}`,
);

const second = compileFixture();
assert.deepEqual(second.compiled.report.issues, first.compiled.report.issues, "the budgeted outcome must not vary between compiles");

// Three labels on one point compete for the same slots: the search has to
// test pairs, so a one-unit budget cannot finish it.
const view = { x: 400, y: 0, width: 760, height: 700 };
const crowded: LabelOwner[] = ["A", "B", "C"].map((text) => ({
  entityId: `p${text}`,
  anchor: { x: 700, y: 350 },
  text,
  viewBounds: view,
  useOwnerBounds: false,
}));
const solved = placeLabels(crowded, []);
assert.equal(solved.ok, true, `the crowded layout should solve under the default budget: ${JSON.stringify(solved.issues)}`);
assert.ok(solved.searchWork > 1 && solved.searchWork < LABEL_SEARCH_WORK_BUDGET, `unexpected search work ${solved.searchWork}`);
const starved = placeLabels(crowded, [], { searchWorkBudget: 1 });
assert.equal(starved.ok, false, "a one-unit budget must stop the search");
assert.ok(
  starved.issues.some((issue) => issue.code === "label_overlap_unresolved" && /label search budget/.test(issue.message)),
  `expected a budget failure, got ${JSON.stringify(starved.issues)}`,
);
assert.equal(starved.placements.length, 0, "a search that ran out must not place partial labels");

console.log(
  `label search budget: stalled candidate fails label_overlap_unresolved in ${Math.round(first.ms)} ms ` +
  `and ${Math.round(second.ms)} ms (318 s before the budget); budget ${LABEL_SEARCH_WORK_BUDGET} units`,
);
