import assert from "node:assert/strict";
import type { DiagramEvalRow } from "../lecture-lab/diagramEval";
import { sampleDiagramTopicCoverageRows } from "../lecture-lab/topicCoverageSample";

const row = (
  id: string,
  topic: string,
  figureNeed: DiagramEvalRow["figure_need"],
  askStyle: string,
  question = id,
): DiagramEvalRow => ({
  id,
  topic_id: topic,
  subject: topic.split("|")[0]!,
  difficulty: "medium",
  question,
  source: { kind: "authored", ref: null },
  figure_need: figureNeed,
  figure_kind: "vectors_fbd",
  must_show: [],
  must_label: [],
  must_not_show: [],
  trap: null,
  notes: "",
  ask_style: askStyle,
});

const source = [
  row("physics-required-exam", "physics|1|forces", "required", "exam_stem"),
  row("physics-required-student", "physics|1|forces", "required", "topic_ask"),
  row("physics-optional-student", "physics|1|forces", "optional", "topic_ask"),
  row("maths-leaked", "maths|2|lines", "required", "topic_ask", "Draw the line through A and B"),
  row("maths-vague", "maths|2|lines", "required", "vague_or_misspelled"),
  row("maths-exam", "maths|2|lines", "required", "exam_stem"),
  row("ignored-none", "physics|3|scalar", "none", "topic_ask"),
  row("ignored-chemistry", "chemistry|1|atoms", "required", "topic_ask"),
];

const sample = sampleDiagramTopicCoverageRows(
  source,
  ["Draw the line through A and B"],
  20261009,
);
assert.deepEqual(sample.rows.map((entry) => entry.id), [
  "maths-vague",
  "physics-required-student",
]);
assert.equal(sample.manifest.totalRows, 2);
assert.deepEqual(sample.manifest.subjectTopics, { maths: 1, physics: 1 });
assert.equal(sample.manifest.leakExcludedRows, 1);
assert.deepEqual(
  sample,
  sampleDiagramTopicCoverageRows(source, ["Draw the line through A and B"], 20261009),
  "the fixed seed must reproduce the exact topic sample",
);

console.log("topic coverage sample verification passed");
