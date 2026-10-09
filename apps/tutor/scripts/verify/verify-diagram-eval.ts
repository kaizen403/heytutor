import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  compileSceneDocument,
  validateSceneDocument,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import {
  assertEvaluationCostAllowed,
  classifyDiagramEmptyCause,
  combineDiagramEvalRows,
  evaluationAllowsFallback,
  evaluationPlansChemistry,
  evaluationRunFastMode,
  evaluationSelectionOrder,
  evaluationUsesStandardModelHeader,
  evaluationUsesExamples,
  estimateEvaluationCostUsd,
  formatDiagramFailureCounts,
  assertRoundPlannerStarted,
  parseDiagramEvalJsonl,
  PlannerUsageTracker,
  sampleDiagramEvalRows,
  supplementCandidateErrorCodes,
  summarizeDiagramFailures,
  type DiagramEvalRow,
} from "../lecture-lab/diagramEval";
import {
  buildComparisonGalleryHtml,
  buildGalleryHtml,
  buildMultiComparisonGalleryHtml,
  type GalleryEntry,
} from "../lecture-lab/gallery";
import {
  buildJudgeSummary,
  findMissingDiagramLabels,
  needsHumanReview,
  normalizeDiagramLabel,
  ruleJudgmentForNoFigure,
} from "../lecture-lab/judging";
import { correctedEmptyCauseForStoredRun } from "../lecture-lab/regrade-empty-causes";
import {
  LECTURE_LAB_HEADER,
  LECTURE_LAB_STANDARD_MODEL_HEADER,
  shouldUseLectureLabStandardModel,
} from "../../lib/billing/flags";
import { resolvePlannerModels } from "../../lib/llm/plannerTransport";
import { planSceneDocument } from "@heytutor/tutor-core";
import { buildSceneDocumentPlannerPrompt } from "@heytutor/tutor-core";
import {
  buildDiagramExampleCatalogue,
  buildDiagramExemplarDepicts,
  filterDiagramExemplarsForEvaluation,
  loadDiagramExemplarLibrary,
  retrieveDiagramExemplars,
  type DiagramExemplar,
} from "../lecture-lab/diagramExamples";
import {
  DIAGRAM_EXAMPLE_PICKER_TIMEOUT_MS,
  parseDiagramExamplePickerResponse,
  pickDiagramExamples,
} from "../lecture-lab/diagramExamplePicker";
import {
  runScenePlanningOverlap,
  type SceneGateCore,
} from "../../features/tutor-session/lib/scene/planningOverlap";
import { sampleDiagramRowsAcrossChapters } from "../lecture-lab/retrieval-check";
import { sampleDiagramRoundRows } from "../lecture-lab/roundSample";

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
const chapterSampleRows = [
  { ...rows[0]!, id: "physics|1|a", topic_id: "physics|1|a" },
  { ...rows[0]!, id: "physics|1|b", topic_id: "physics|1|b" },
  { ...rows[0]!, id: "physics|2|a", topic_id: "physics|2|a" },
  { ...rows[0]!, id: "maths|1|a", topic_id: "maths|1|a", subject: "maths" },
];
const chapterSample = sampleDiagramRowsAcrossChapters(chapterSampleRows, 3, 91);
assert.equal(chapterSample.length, 3);
assert.equal(new Set(chapterSample.map((row) => `${row.subject}|${row.topic_id.split("|")[1]}`)).size, 3);
assert.deepEqual(chapterSample, sampleDiagramRowsAcrossChapters(chapterSampleRows, 3, 91));
const roundSource = Array.from({ length: 3 }, (_, chapterIndex) =>
  Array.from({ length: 10 }, (_, rowIndex): DiagramEvalRow => ({
    ...rows[0]!,
    id: `subject|${chapterIndex + 1}|topic|q${rowIndex + 1}`,
    topic_id: `subject|${chapterIndex + 1}|topic`,
    subject: chapterIndex === 0 ? "physics" : chapterIndex === 1 ? "maths" : "chemistry",
    ask_style: rowIndex < 7 ? "exam_stem" : rowIndex === 9 ? "vague_or_misspelled" : "topic_ask",
    trap: rowIndex === 0 ? "near_miss_topic" : null,
  })),
).flat();
const roundPrivate: DiagramEvalRow[] = [{
  ...rows[0]!,
  id: "real|q1",
  topic_id: "physics|eval|real-student",
  kind: "homework",
  ask_style: "topic_ask",
}];
const roundSample = sampleDiagramRoundRows(roundSource, roundPrivate, {
  publicCount: 15,
  seed: 20261009,
});
assert.equal(roundSample.rows.length, 16);
assert.equal(roundSample.publicRows.length, 15);
assert.deepEqual(
  roundSample.manifest.ids,
  sampleDiagramRoundRows(roundSource, roundPrivate, { publicCount: 15, seed: 20261009 }).manifest.ids,
  "the 300-row manifest must be reproducible from its fixed seed",
);
for (const chapter of ["1", "2", "3"]) {
  const selected = roundSample.publicRows.filter((row) => row.topic_id.split("|")[1] === chapter);
  assert.equal(selected.length, 5);
  assert.ok(selected.some((row) => row.ask_style === "exam_stem"));
  assert.ok(selected.some((row) => row.ask_style !== "exam_stem"));
}
assert.equal(roundSample.publicRows.filter((row) => row.trap !== null).length, 2);
assert.equal(roundSample.rows.filter((row) => row.id === "real|q1").length, 1);
assert.ok(estimateEvaluationCostUsd(20, "planner_first") > estimateEvaluationCostUsd(20, "current"));
assert.equal(estimateEvaluationCostUsd(20, "current"), 0.768, "preflight uses measured current-arm tokens at Kimi K3 rates");
assert.equal(estimateEvaluationCostUsd(20, "planner_first"), 0.783, "preflight uses measured planner-first tokens at Kimi K3 rates");
assert.equal(
  estimateEvaluationCostUsd(20, "planner_examples"),
  1.317192,
  "planner-examples preflight includes measured Kimi tokens and the bounded DeepSeek picker call",
);
assert.equal(
  estimateEvaluationCostUsd(300, "current") +
    estimateEvaluationCostUsd(300, "planner_first") +
    estimateEvaluationCostUsd(300, "planner_examples"),
  43.02288,
  "the approved 300-row three-arm round stays below the US$55 stop threshold",
);
assert.equal(evaluationRunFastMode(true), false, "evaluation requests must explicitly disable Fast mode");
assert.equal(evaluationRunFastMode(true, "fast"), true, "Fast evaluation requests must use the production router");
assert.equal(evaluationRunFastMode(false), undefined, "ordinary lecture-lab requests keep their current model default");
assert(evaluationUsesStandardModelHeader(true, "standard"));
assert(!evaluationUsesStandardModelHeader(true, "fast"));
assert(!evaluationUsesStandardModelHeader(false, "standard"));
assert.equal(evaluationSelectionOrder("current"), "current");
assert.equal(evaluationSelectionOrder("planner_first"), "planner_first");
assert.equal(evaluationSelectionOrder("planner_examples"), "planner_first");
assert.equal(evaluationSelectionOrder("planner_examples_strict"), "planner_first");
assert(evaluationUsesExamples("planner_examples_strict"));
assert(evaluationPlansChemistry("planner_examples_strict"));
assert(!evaluationPlansChemistry("planner_examples"));
assert(evaluationAllowsFallback("planner_examples_strict", "chemistry_family"));
assert(!evaluationAllowsFallback("planner_examples_strict", "family"));
assert(!evaluationAllowsFallback("planner_examples_strict", "source_grounded"));
assert(evaluationAllowsFallback("current", "family"));
assert.equal(
  Math.round((
    estimateEvaluationCostUsd(300, "current", "fast") +
    estimateEvaluationCostUsd(300, "planner_examples_strict", "fast")
  ) * 1_000_000) / 1_000_000,
  41.98788,
  "the two-arm K3 Fast preflight uses Fast prices and stays below the US$45 stop threshold",
);
assert.doesNotThrow(() => assertEvaluationCostAllowed(4.99, false));
assert.throws(
  () => assertEvaluationCostAllowed(5.01, false),
  /--yes/,
  "rounds above the guard must require explicit confirmation",
);
assert.doesNotThrow(() => assertRoundPlannerStarted([
  {
    calls: 1,
    usageCalls: 1,
    inputTokens: 120,
    outputTokens: 30,
    totalTokens: 150,
    cachedInputTokens: 0,
    estimatedCostUsd: 0.001,
    modelCalls: [{
      model: "accounts/fireworks/models/kimi-k3",
      status: 200,
      ok: true,
      usageKnown: true,
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      cachedInputTokens: 0,
      estimatedCostUsd: 0.001,
    }],
  },
], 5));
assert.throws(
  () => assertRoundPlannerStarted(Array.from({ length: 5 }, () => ({
    calls: 0,
    usageCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    estimatedCostUsd: 0,
    modelCalls: [],
  })), 5),
  /no successful planner call with measured token usage after the first 5 rows/,
  "a paid round must abort before silently continuing on deterministic fallbacks",
);
assert.doesNotThrow(
  () => assertRoundPlannerStarted(Array.from({ length: 4 }, () => ({
    calls: 0,
    usageCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    estimatedCostUsd: 0,
    modelCalls: [],
  })), 5),
  "the guard waits for five completed rows",
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
  emptyCause: "candidates_invalid",
  examplesUsed: [{
    id: "vector-right",
    sourceKind: "curated",
    question: "Draw a rightward force.",
    depicts: "force vector labelled F",
    figureKind: "vectors_fbd",
    family: "vector_diagram",
    archetype: null,
  }],
  judgment: {
    id: "physics|1|vectors|q1",
    verdict: "right",
    missing: [],
    wrong_items: [],
    confidence: 0.9,
    reason: "Correct force arrow and label.",
    by: "codex",
  },
  needsHuman: true,
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
  "Needs human",
  "Correct force arrow and label.",
  'option value="right" selected',
  "candidates_invalid",
  "vector-right",
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
const threeArmComparison = buildMultiComparisonGalleryHtml([
  { label: "current", entries: [galleryEntry] },
  { label: "planner_first", entries: [{ ...galleryEntry, png: null }] },
  { label: "planner_examples", entries: [{ ...galleryEntry, figureSource: "planner_examples" }] },
]);
for (const label of ["current", "planner_first", "planner_examples"]) {
  assert.ok(threeArmComparison.includes(label), `multi-arm comparison must include ${label}`);
}
assert.equal(
  threeArmComparison.match(/Draw a 3 N force to the right\./g)?.length,
  1,
  "multi-arm comparison must key all arms by row id",
);
assert.match(
  threeArmComparison,
  /style="grid-template-columns:repeat\(3,minmax\(0,1fr\)\)"/,
);
assert.ok(
  threeArmComparison.includes('id="physics|1|vectors|q1"'),
  "comparison rows must be directly linkable from the report",
);

const exemplarDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "force vector" },
  source: { question: "Draw a rightward force.", synthesizedFamily: true },
  quantities: [],
  entities: [
    { id: "o", kind: "point", role: "construction helper", provenance: { engineOwned: true } },
    { id: "f", kind: "vector", label: "F" },
  ],
  constructions: [
    { id: "point-o", operator: "point", inputs: { x: 12, y: 30, coordinateSpace: "world" }, outputs: ["o"] },
    { id: "force", operator: "vector", inputs: { start: "o", direction: [1, 0], length: 1 }, outputs: ["f"] },
  ],
  relations: [],
  assertions: [],
  annotations: [],
  requiredEntityIds: ["f"],
  revealGroups: [],
  teachingTimeline: [],
};
const exemplars: DiagramExemplar[] = [
  { id: "vector-right", sourceKind: "curated", question: "Draw a rightward force of 3 N on the block.", depicts: "force vector labelled F", figureKind: "vectors_fbd", family: "vector_diagram", archetype: null, document: exemplarDocument },
  { id: "vector-left", sourceKind: "synthesized", question: null, depicts: "velocity vector labelled v", figureKind: "vectors_fbd", family: "vector_diagram", archetype: null, document: exemplarDocument },
  { id: "circuit-series", sourceKind: "curated", question: "Draw two resistors connected in series.", depicts: "battery with two resistors in series", figureKind: "circuit", family: "circuit_network", archetype: null, document: exemplarDocument },
  { id: "graph-line", sourceKind: "curated", question: "Sketch a straight velocity time graph.", depicts: "straight velocity time graph", figureKind: "function_plot", family: "state_plot", archetype: "linear_graph", document: exemplarDocument },
];
assert.deepEqual(
  filterDiagramExemplarsForEvaluation(exemplars, ["Sketch the rightward force of 3 N acting on the block."]).map((entry) => entry.id),
  ["vector-left", "circuit-series", "graph-line"],
  "exact and near-duplicate evaluation questions must never enter retrieval",
);
const retrieved = retrieveDiagramExemplars(exemplars, {
  question: "Show the force and velocity vectors on an object.",
  families: ["vector_diagram"],
  archetypeId: null,
});
assert.deepEqual(retrieved.map((entry) => entry.id), ["vector-left", "vector-right"]);
assert.deepEqual(
  retrieveDiagramExemplars(exemplars, {
    question: "Explain why a salt dissolves in water.",
    families: [],
    archetypeId: null,
  }),
  [],
  "the word fallback must not inject unrelated default examples",
);
const planRetrieved = retrieveDiagramExemplars(exemplars, {
  question: "Show the velocity.",
  families: [],
  archetypeId: null,
  limit: 1,
  plan: {
    schemaVersion: "turn-plan/v3",
    question: "Show the velocity.",
    givens: [
      { id: "r1", symbol: "R1", value: 4.7, unit: "kΩ", provenance: "given" },
      { id: "supply", symbol: "V", value: 9, unit: "V", provenance: "given" },
    ],
    unknowns: [{ id: "midpoint", symbol: "V_mid", unit: "V" }],
    derived: [],
    qualitativeClaims: [{
      id: "series",
      claim: "two resistors form one series path",
      expected: true,
      relatedEntityHints: ["battery", "resistor", "midpoint node"],
    }],
    lawIds: ["voltage_divider", "series_resistance"],
    assumptions: [],
    visualRequirement: "required",
  },
});
assert.equal(planRetrieved[0]?.id, "circuit-series", "turn-plan evidence must steer retrieval");
const examplePrompt = buildSceneDocumentPlannerPrompt("Show a force vector.", { workedExamples: retrieved });
assert.ok(examplePrompt.includes("WORKED SCENE EXAMPLES"));
assert.ok(examplePrompt.includes("Figure: velocity vector labelled v"));
assert.ok(!examplePrompt.includes("QUESTION\nnull"));
assert.ok(!examplePrompt.includes('"x":12') && !examplePrompt.includes('"y":30'));
assert.ok(!examplePrompt.includes("provenance") && !examplePrompt.includes("synthesizedFamily"));
assert.match(
  buildDiagramExemplarDepicts(exemplarDocument, "vector_diagram", null),
  /vector diagram.*vector.*F/i,
  "synthesized descriptions must come from family, entity kinds, and readable labels",
);
assert.match(
  buildDiagramExemplarDepicts(exemplarDocument, "chem_cft", null),
  /crystal field theory/i,
  "family identifiers must be expressed in plain subject language",
);
const catalogue = buildDiagramExampleCatalogue([
  ...exemplars,
  {
    ...exemplars[0]!,
    id: "vector-right-near-duplicate",
    question: "This entire curated question must not enter the catalogue.",
    depicts: "force vector labelled F",
  },
]);
assert.ok(catalogue.estimatedTokens < 6_000, "picker catalogue must stay below its prompt budget");
assert.equal(catalogue.entries.length, 4, "near-duplicate descriptions must be merged");
assert.ok(catalogue.text.includes("vector-right | vectors_fbd | force vector labelled F"));
assert.ok(!catalogue.text.includes("This entire curated question"), "catalogue uses depicts, never curated questions");
assert.ok(catalogue.entries.every((entry) => entry.depicts.split(/\s+/).length <= 20));
assert.deepEqual(
  parseDiagramExamplePickerResponse('Picker result:\n```json\n{"ids":["vector-left","circuit-serie"]}\n```', catalogue),
  ["vector-left", "circuit-series"],
  "the first JSON object and one unambiguous near-miss id must be accepted",
);
assert.deepEqual(
  parseDiagramExamplePickerResponse('{"ids":["vector"]}', catalogue),
  [],
  "ambiguous shortened ids must be dropped",
);
assert.deepEqual(
  parseDiagramExamplePickerResponse('{"ids":["not-in-catalogue"]}', catalogue),
  [],
  "unknown ids must be dropped rather than failing the whole response",
);
assert.equal(DIAGRAM_EXAMPLE_PICKER_TIMEOUT_MS, 4_000);
const pickerVerification = (async () => {
  const pickerRequests: Record<string, unknown>[] = [];
  const picked = await pickDiagramExamples(exemplars, catalogue, {
    question: "Show a resistor circuit.",
    plan: null,
    families: ["circuit_network"],
    archetypeId: null,
    apiKey: "test-key",
    fetchImpl: async (_input, init) => {
      pickerRequests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({
        choices: [{ message: { content: '{"ids":["circuit-series"]}' } }],
        usage: { prompt_tokens: 120, completion_tokens: 9, total_tokens: 129 },
      });
    },
  });
  assert.deepEqual(picked.examples.map((entry) => entry.id), ["circuit-series"]);
  assert.equal(picked.record.method, "model");
  assert.equal(picked.record.status, "picked");
  assert.ok(picked.record.estimatedCostUsd > 0);
  assert.equal(pickerRequests[0]?.temperature, 0);
  assert.equal(pickerRequests[0]?.max_tokens, 60);
  assert.deepEqual(pickerRequests[0]?.response_format, { type: "json_object" });
  let retryCalls = 0;
  const retried = await pickDiagramExamples(exemplars, catalogue, {
    question: "Show a resistor circuit.",
    plan: null,
    families: ["circuit_network"],
    archetypeId: null,
    apiKey: "test-key",
    fetchImpl: async () => {
      retryCalls += 1;
      return Response.json({
        choices: [{ message: { content: retryCalls === 1 ? "not json" : '{"ids":["circuit-series"]}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 },
      });
    },
  });
  assert.equal(retryCalls, 2, "invalid JSON gets one retry while deadline remains");
  assert.equal(retried.record.attempts, 2);
  assert.equal(retried.record.inputTokens, 200);
  assert.deepEqual(retried.examples.map((entry) => entry.id), ["circuit-series"]);
  const fellBack = await pickDiagramExamples(exemplars, catalogue, {
    question: "Show the force and velocity vectors on an object.",
    plan: null,
    families: ["vector_diagram"],
    archetypeId: null,
    apiKey: "test-key",
    fetchImpl: async () => new Response("unavailable", { status: 503 }),
  });
  assert.equal(fellBack.record.method, "word_fallback");
  assert.equal(fellBack.record.status, "failed");
  assert.deepEqual(fellBack.examples.map((entry) => entry.id), ["vector-left", "vector-right"]);
})();

const repoRoot = resolve(process.cwd(), "../..");
const exemplarRoot = resolve(repoRoot, "data/diagram-eval/v1/exemplars");
const builtLibrary = loadDiagramExemplarLibrary(resolve(exemplarRoot, "_library.jsonl"), []);
assert.deepEqual(
  retrieveDiagramExemplars(builtLibrary, {
    question: "In thin layer chromatography a compound travels 3.6 cm while the solvent front travels 12.0 cm.",
    families: [],
    archetypeId: null,
  }),
  [],
  "a few generic words and units must not select unrelated maths or optics defaults",
);
const curatedQuestions = readdirSync(resolve(exemplarRoot, "chemistry"))
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(resolve(exemplarRoot, "chemistry", file), "utf8")) as { question: string })
  .map((entry) => entry.question);
assert.equal(curatedQuestions.length, 26);
for (const question of curatedQuestions) {
  assert.ok(builtLibrary.some((entry) => entry.question === question), `library must include curated exemplar: ${question}`);
}
const curatedMathsQuestions = readdirSync(resolve(exemplarRoot, "maths"))
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(resolve(exemplarRoot, "maths", file), "utf8")) as { question: string })
  .map((entry) => entry.question);
assert.equal(curatedMathsQuestions.length, 10);
for (const question of curatedMathsQuestions) {
  assert.ok(builtLibrary.some((entry) => entry.question === question), `library must include curated exemplar: ${question}`);
}
const curatedPhysicsQuestions = readdirSync(resolve(exemplarRoot, "physics"))
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(resolve(exemplarRoot, "physics", file), "utf8")) as { question: string })
  .map((entry) => entry.question);
assert.equal(curatedPhysicsQuestions.length, 9);
for (const question of curatedPhysicsQuestions) {
  assert.ok(builtLibrary.some((entry) => entry.question === question), `library must include curated exemplar: ${question}`);
}
const builtCatalogue = buildDiagramExampleCatalogue(builtLibrary);
assert.ok(builtCatalogue.estimatedTokens < 6_000);
assert.ok(builtCatalogue.entries.length < builtLibrary.length, "catalogue must merge near-duplicate examples");
assert.ok(
  builtLibrary.filter((entry) => entry.sourceKind === "synthesized").every((entry) => entry.question === null),
  "synthesized source questions must not survive in the runtime library",
);
for (const exemplar of builtLibrary) {
  assert.ok(exemplar.depicts.trim(), `library exemplar ${exemplar.id} must describe what it draws`);
  assert.ok(exemplar.figureKind, `library exemplar ${exemplar.id} must map to one figure_kind`);
  const validated = validateSceneDocument(exemplar.document);
  assert.ok(validated.document, `library exemplar ${exemplar.id} must validate`);
  const compiled = compileSceneDocument(validated.document!);
  assert.ok(compiled.ok && compiled.renderScene, `library exemplar ${exemplar.id} must compile`);
  assert.ok(compiled.renderScene!.primitives.some((primitive) =>
    (primitive.kind === "label" || primitive.kind === "dimension") && Boolean(primitive.text?.trim())),
  `library exemplar ${exemplar.id} must carry readable labels`);
}

const emptyInput = {
  committed: false,
  visualRequirement: "required" as const,
  declinedUnreadable: false,
  primitiveCount: 0,
  plannerCalls: 0,
  deadlineRemainingMs: 10_000,
  candidateCount: 0,
  candidateErrorCodes: [] as string[],
};
assert.equal(classifyDiagramEmptyCause({ ...emptyInput, committed: true }), null);
assert.equal(classifyDiagramEmptyCause({ ...emptyInput, visualRequirement: "none" }), "not_needed");
assert.equal(
  classifyDiagramEmptyCause({ ...emptyInput, visualRequirement: "optional" }),
  "not_attempted",
);
assert.equal(classifyDiagramEmptyCause(emptyInput), "not_attempted");
assert.equal(
  classifyDiagramEmptyCause({ ...emptyInput, plannerCalls: 2 }),
  "planner_no_output",
);
assert.equal(
  classifyDiagramEmptyCause({ ...emptyInput, plannerCalls: 2, candidateCount: 1 }),
  "planner_no_output",
  "a candidate without a retained failure code must not be called invalid",
);
assert.deepEqual(supplementCandidateErrorCodes({
  committed: false,
  visualRequirement: "required",
  primitiveCount: 0,
  candidateCount: 1,
  candidateErrorCodes: [],
}), ["planner_declined_required_scene"]);
assert.equal(
  classifyDiagramEmptyCause({
    ...emptyInput,
    plannerCalls: 2,
    candidateCount: 2,
    candidateErrorCodes: ["invalid_id"],
  }),
  "candidates_invalid",
);
assert.equal(
  classifyDiagramEmptyCause({
    ...emptyInput,
    plannerCalls: 2,
    candidateCount: 1,
    declinedUnreadable: true,
    primitiveCount: 3,
  }),
  "declined_unreadable",
);
assert.equal(
  classifyDiagramEmptyCause({
    ...emptyInput,
    plannerCalls: 2,
    candidateErrorCodes: ["invalid_id"],
    declinedUnreadable: true,
    primitiveCount: 3,
    deadlineRemainingMs: 1_000,
  }),
  "deadline",
);
assert.equal(
  classifyDiagramEmptyCause({
    ...emptyInput,
    declinedUnreadable: true,
    primitiveCount: 0,
  }),
  "not_attempted",
  "an empty compile is not an unreadable compiled figure",
);
const failureSummary = summarizeDiagramFailures([
  { emptyCause: "not_attempted", candidateErrorCodes: ["invalid_id", "label_duplicate"] },
  { emptyCause: "candidates_invalid", candidateErrorCodes: ["invalid_id"] },
  { emptyCause: "not_attempted", candidateErrorCodes: [] },
]);
assert.deepEqual(failureSummary.emptyCauseCounts, { not_attempted: 2, candidates_invalid: 1 });
assert.deepEqual(failureSummary.candidateErrorCodeCounts, { invalid_id: 2, label_duplicate: 1 });
assert.equal(
  formatDiagramFailureCounts(failureSummary.emptyCauseCounts),
  "not_attempted=2 candidates_invalid=1",
);
assert.equal(correctedEmptyCauseForStoredRun({
  timings: { planMs: 59_250, stages: { plannerCalls: 2 } },
  plan: { visualRequirement: "required" },
  diagram: {
    committed: false,
    declinedUnreadable: true,
    primitiveCount: 0,
    candidateErrorCodes: ["invalid_id"],
  },
}), "deadline");
assert.equal(correctedEmptyCauseForStoredRun({
  timings: { planMs: 4_000, stages: { plannerCalls: 0 } },
  plan: { visualRequirement: "required" },
  diagram: { committed: false, declinedUnreadable: true, primitiveCount: 0, candidateErrorCodes: [] },
}), "not_attempted");
assert.equal(correctedEmptyCauseForStoredRun({
  timings: { planMs: 4_000, stages: { plannerCalls: 2 } },
  plan: { visualRequirement: "required" },
  diagram: { committed: false, declinedUnreadable: true, primitiveCount: 0, candidateErrorCodes: [] },
}), "planner_no_output");

assert.equal(
  normalizeDiagramLabel("3 Ω × 10^−2"),
  normalizeDiagramLabel("3 ohm x 10^-2"),
  "label checks must normalize spaces, ohms, multiplication, powers, and unicode minus",
);
assert.deepEqual(
  findMissingDiagramLabels(["A", "a", "3 Ω"], ["A", "3 ohm"]),
  ["a"],
  "label matching must preserve meaningful case while normalizing notation",
);
assert.equal(ruleJudgmentForNoFigure("none").verdict, "empty_ok");
assert.equal(ruleJudgmentForNoFigure("optional").verdict, "empty_ok");
assert.equal(ruleJudgmentForNoFigure("required").verdict, "empty_bad");
assert(needsHumanReview(galleryEntry.judgment!, ["3 N"]), "a right verdict with rule-detected missing labels needs a human");
assert(!needsHumanReview({ ...galleryEntry.judgment!, verdict: "wrong" }, []), "a confident wrong verdict is not doubtful");
assert(needsHumanReview({ ...galleryEntry.judgment!, confidence: 0.69 }, []), "low confidence needs a human");
const judgeSummary = buildJudgeSummary([
  ruleJudgmentForNoFigure("none", "empty"),
  galleryEntry.judgment!,
], new Map([[galleryEntry.id, ["3 N"]]]));
assert.deepEqual(judgeSummary.counts, { empty_ok: 1, right: 1 });
assert.equal(judgeSummary.ruleDecided, 1);
assert.equal(judgeSummary.subagentJudged, 1);
assert.equal(judgeSummary.needsHuman, 1);

const modelEnv = {
  LECTURE_LAB_TOKEN: "lab-secret",
  FIREWORKS_MODEL: "accounts/fireworks/models/kimi-k3",
} as unknown as NodeJS.ProcessEnv;
const authenticatedStandard = new Request("http://localhost/api/chat", { headers: {
  [LECTURE_LAB_HEADER]: "lab-secret",
  [LECTURE_LAB_STANDARD_MODEL_HEADER]: "1",
} });
const unauthenticatedStandard = new Request("http://localhost/api/chat", { headers: {
  [LECTURE_LAB_HEADER]: "wrong",
  [LECTURE_LAB_STANDARD_MODEL_HEADER]: "1",
} });
assert(shouldUseLectureLabStandardModel(authenticatedStandard, modelEnv));
assert(!shouldUseLectureLabStandardModel(unauthenticatedStandard, modelEnv), "a request without the valid lab token must not override ProblemIR");
assert.deepEqual(resolvePlannerModels({
  semanticSceneV2: false,
  turnPlanV3: false,
  problemIRV1: true,
  plannerPhase: "plan",
  problemIRModelOverride: shouldUseLectureLabStandardModel(authenticatedStandard, modelEnv)
    ? modelEnv.FIREWORKS_MODEL
    : undefined,
  env: modelEnv,
}), ["accounts/fireworks/models/kimi-k3"]);

void (async () => {
  await pickerVerification;
  const nativeFetch = globalThis.fetch;
  const requestOutcomes: Array<{
    httpStatus: number | null;
    error: string | null;
    bodyParsed: boolean;
    promptChars: number;
  }> = [];
  globalThis.fetch = async () => Response.json({
    choices: [{ message: { content: "not a scene document" } }],
  });
  const unparsed = await planSceneDocument("Draw a force arrow.", {
    proxyUrl: "http://localhost/api/chat",
    onRequestOutcome: (outcome) => requestOutcomes.push(outcome),
  });
  globalThis.fetch = nativeFetch;
  assert.equal(unparsed, null);
  assert.equal(requestOutcomes.length, 1);
  assert.equal(requestOutcomes[0]?.httpStatus, 200);
  assert.equal(requestOutcomes[0]?.bodyParsed, false);
  assert.equal(requestOutcomes[0]?.error, "invalid_scene_json");
  assert.ok((requestOutcomes[0]?.promptChars ?? 0) > 0);

  const tracker = new PlannerUsageTracker();
  tracker.recordRequest("trace-1");
  await tracker.recordResponse("trace-1", Response.json({
    usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
  }, { headers: { "x-heytutor-planner-model": "accounts/fireworks/models/kimi-k3" } }));
  const usage = tracker.finish("trace-1");
  assert.equal(usage.modelCalls[0]?.model, "accounts/fireworks/models/kimi-k3");
  assert.equal(usage.modelCalls[0]?.estimatedCostUsd, 18, "each call must be priced at its actual model rate");
  assert.equal(usage.estimatedCostUsd, 18);

  const noFamilyPlan = {
    schemaVersion: "turn-plan/v3",
    question: "Show the triangle for the cosine rule.",
    givens: [],
    unknowns: [],
    derived: [],
    qualitativeClaims: [],
    lawIds: ["cosine_rule"],
    assumptions: [],
    visualRequirement: "required",
  } as unknown as TurnPlanV3;
  const plannerCallsFor = async (selectionOrder: "current" | "planner_first") => {
    let plannerCalls = 0;
    await runScenePlanningOverlap<null, SceneGateCore, never, {
      candidates: unknown[];
      validation: { valid: boolean };
    }>({
      turnPlan: noFamilyPlan,
      problemAuthority: null,
      speculationAllowed: false,
      selectionOrder,
      plannerStartedAt: 0,
      deadlineMs: 60_000,
      now: () => 0,
      deriveGate: () => ({
        shouldPlanExactScene: true,
        shouldAttemptLlmScene: false,
        families: [],
        archetypeId: null,
        request: { conversationContext: "no matched family" },
      }),
      applyAuthority: (turnPlan) => ({ turnPlan, authority: null }),
      fastFigureBlocked: () => false,
      selectFast: () => null,
      planScene: async (gate) => {
        plannerCalls += 1;
        assert.deepEqual(gate.families, [], "planner-first must not invent a family");
        return null;
      },
      revalidate: async (result) => result,
    });
    return plannerCalls;
  };
  assert.equal(await plannerCallsFor("current"), 0, "current keeps the family/archetype gate");
  assert.equal(await plannerCallsFor("planner_first"), 1, "planner-first tries an unmatched required figure");
  console.log("diagram evaluation judging and Kimi K3 verification passed");
})();
