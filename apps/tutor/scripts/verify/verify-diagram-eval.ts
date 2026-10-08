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
  evaluationRunFastMode,
  evaluationSelectionOrder,
  estimateEvaluationCostUsd,
  formatDiagramFailureCounts,
  parseDiagramEvalJsonl,
  PlannerUsageTracker,
  sampleDiagramEvalRows,
  summarizeDiagramFailures,
} from "../lecture-lab/diagramEval";
import {
  buildComparisonGalleryHtml,
  buildGalleryHtml,
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
  filterDiagramExemplarsForEvaluation,
  loadDiagramExemplarLibrary,
  retrieveDiagramExemplars,
  type DiagramExemplar,
} from "../lecture-lab/diagramExamples";
import {
  runScenePlanningOverlap,
  type SceneGateCore,
} from "../../features/tutor-session/lib/scene/planningOverlap";

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
assert.equal(estimateEvaluationCostUsd(20, "current"), 2.25, "preflight must use Kimi K3 rates");
assert.equal(estimateEvaluationCostUsd(20, "planner_first"), 3.75, "planner-first preflight must use Kimi K3 rates");
assert.equal(estimateEvaluationCostUsd(20, "planner_examples"), 3.75, "example retrieval does not add model calls");
assert.equal(evaluationRunFastMode(true), false, "evaluation requests must explicitly disable Fast mode");
assert.equal(evaluationRunFastMode(false), undefined, "ordinary lecture-lab requests keep their current model default");
assert.equal(evaluationSelectionOrder("current"), "current");
assert.equal(evaluationSelectionOrder("planner_first"), "planner_first");
assert.equal(evaluationSelectionOrder("planner_examples"), "planner_first");
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
  emptyCause: "candidates_invalid",
  examplesUsed: [{ id: "vector-right", question: "Draw a rightward force.", family: "vector_diagram", archetype: null }],
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
  { id: "vector-right", question: "Draw a rightward force of 3 N on the block.", family: "vector_diagram", archetype: null, document: exemplarDocument },
  { id: "vector-left", question: "Draw a leftward velocity vector.", family: "vector_diagram", archetype: null, document: exemplarDocument },
  { id: "circuit-series", question: "Draw two resistors connected in series.", family: "circuit_network", archetype: null, document: exemplarDocument },
  { id: "graph-line", question: "Sketch a straight velocity time graph.", family: "state_plot", archetype: "linear_graph", document: exemplarDocument },
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
assert.deepEqual(retrieved.map((entry) => entry.id), ["vector-left", "vector-right", "graph-line"]);
assert.equal(retrieved.length, 3);
const examplePrompt = buildSceneDocumentPlannerPrompt("Show a force vector.", { workedExamples: retrieved });
assert.ok(examplePrompt.includes("WORKED SCENE EXAMPLES"));
assert.ok(examplePrompt.includes("Draw a leftward velocity vector."));
assert.ok(!examplePrompt.includes('"x":12') && !examplePrompt.includes('"y":30'));
assert.ok(!examplePrompt.includes("provenance") && !examplePrompt.includes("synthesizedFamily"));

const repoRoot = resolve(process.cwd(), "../..");
const exemplarRoot = resolve(repoRoot, "data/diagram-eval/v1/exemplars");
const builtLibrary = loadDiagramExemplarLibrary(resolve(exemplarRoot, "_library.jsonl"), []);
const curatedQuestions = readdirSync(resolve(exemplarRoot, "chemistry"))
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(resolve(exemplarRoot, "chemistry", file), "utf8")) as { question: string })
  .map((entry) => entry.question);
assert.equal(curatedQuestions.length, 26);
for (const question of curatedQuestions) {
  assert.ok(builtLibrary.some((entry) => entry.question === question), `library must include curated exemplar: ${question}`);
}
for (const exemplar of builtLibrary) {
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
