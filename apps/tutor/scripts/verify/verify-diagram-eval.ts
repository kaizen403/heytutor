import assert from "node:assert/strict";
import {
  assertEvaluationCostAllowed,
  combineDiagramEvalRows,
  estimateEvaluationCostUsd,
  parseDiagramEvalJsonl,
  sampleDiagramEvalRows,
} from "../lecture-lab/diagramEval";
import {
  buildComparisonGalleryHtml,
  buildGalleryHtml,
  type GalleryEntry,
} from "../lecture-lab/gallery";

const rows = parseDiagramEvalJsonl([
  JSON.stringify({
    id: "physics|1|vectors|q1",
    topic_id: "physics|1|vectors",
    subject: "physics",
    difficulty: "easy",
    question: "Draw a 3 N force to the right.",
    source: { kind: "authored", ref: null },
    figure_need: "required",
    figure_kind: "vectors_fbd",
    must_show: ["one force arrow", "arrow points right"],
    must_label: ["3 N"],
    must_not_show: ["left-pointing arrow"],
    trap: null,
    notes: "",
  }),
  JSON.stringify({
    id: "maths|1|sets|q1",
    topic_id: "maths|1|sets",
    subject: "maths",
    difficulty: "medium",
    question: "Evaluate 2 + 2.",
    source: { kind: "authored", ref: null },
    figure_need: "none",
    figure_kind: "none",
    must_show: [],
    must_label: [],
    must_not_show: ["unrelated graph"],
    trap: "no_figure_needed",
    notes: "",
  }),
].join("\n"));

assert.equal(rows.length, 2);
assert.equal(rows[0]?.topic_id, "physics|1|vectors");
assert.deepEqual(
  sampleDiagramEvalRows(rows, 1, 17),
  sampleDiagramEvalRows(rows, 1, 17),
  "seeded samples must be reproducible",
);
assert.ok(estimateEvaluationCostUsd(20, "planner_first") > estimateEvaluationCostUsd(20, "current"));
assert.doesNotThrow(() => assertEvaluationCostAllowed(4.99, false));
assert.throws(
  () => assertEvaluationCostAllowed(5.01, false),
  /--yes/,
  "rounds above the guard must require explicit confirmation",
);

const studentRows = parseDiagramEvalJsonl(JSON.stringify({
  id: "student|q1",
  subject: "physics",
  question: "A student-authored evaluation question",
  kind: "homework",
  ask_style: "direct",
  figure_need: "required",
  figure_kind: "vectors_fbd",
  must_show: ["force arrows"],
  must_label: [],
  must_not_show: [],
  trap: null,
}));
assert.equal(studentRows[0]?.topic_id, "physics|eval|real-student");
assert.equal(studentRows[0]?.difficulty, "medium");
assert.deepEqual(
  sampleDiagramEvalRows([...rows, ...studentRows], 2, 17).map((row) => row.id),
  ["student|q1", sampleDiagramEvalRows(rows, 1, 17)[0]!.id],
  "real-student rows must remain in every sampled evaluation round",
);
assert.throws(
  () => combineDiagramEvalRows([rows, [rows[0]!]]),
  /duplicate id physics\|1\|vectors\|q1/,
  "repeated --eval inputs must not silently overwrite rows",
);
assert.doesNotThrow(() => assertEvaluationCostAllowed(5.01, true));
assert.throws(
  () => parseDiagramEvalJsonl('{"id":"broken"}'),
  /line 1/,
  "invalid rows must identify their JSONL line",
);

const galleryEntry: GalleryEntry = {
  id: "physics|1|vectors|q1",
  question: "Draw a 3 N force to the right.",
  figureNeed: "required",
  figureKind: "vectors_fbd",
  mustShow: ["one force arrow", "arrow points right"],
  mustLabel: ["3 N"],
  mustNotShow: ["left-pointing arrow"],
  png: "frames/physics_1_vectors_q1.png",
  figureSource: "planner",
  tier: "exact_verified",
  family: "vector_diagram",
  figureCommitMs: 1234,
};
const gallery = buildGalleryHtml([galleryEntry], "round-a");
for (const expected of [
  "Draw a 3 N force to the right.",
  "must show",
  "must label",
  "must not show",
  "empty_ok",
  "empty_bad",
  "localStorage",
  "verdicts.csv",
]) {
  assert.ok(gallery.includes(expected), `gallery must include ${expected}`);
}
const comparison = buildComparisonGalleryHtml([galleryEntry], [{
  ...galleryEntry,
  figureSource: "fast_family",
  png: null,
}], "round-a", "round-b");
assert.ok(comparison.includes("round-a") && comparison.includes("round-b"));
assert.equal(
  comparison.match(/Draw a 3 N force to the right\./g)?.length,
  1,
  "comparison must key by row id instead of duplicating question cards",
);
assert.ok(comparison.includes("no figure"), "comparison must render an empty arm explicitly");

console.log("diagram evaluation input and cost guard verification passed");
