/**
 * Among valid candidates, the figure that misses fewer completeness checklist
 * items wins, even when it has more primitives; the existing cost only breaks
 * ties. An invalid candidate is never selected, however complete it is.
 *
 * Runs the live planner search (planSceneDocumentWithRepair with a stubbed
 * proxy), the authority revalidation and the final production selection, all
 * with the shared validateProductionSceneCandidate that live and lab use.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  planSceneDocumentWithRepair, revalidateScenePlanWithRepairResult,
  type SceneCandidateValidation, type ScenePlanWithRepairResult,
} from "@heytutor/tutor-core";
import type { SceneDocument, TurnPlanV3 } from "@heytutor/scene-engine";
import * as selection from "../../features/tutor-session/lib/scene/productionSceneSelection";
import type { ValidatedSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";

const { selectProductionScene, validateProductionSceneCandidate } = selection;

const question = "In triangle ABC, angle B = 50°. Sketch the triangle.";
const plan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
  givens: [{ id: "angB", symbol: "∠B", value: 50, unit: "°", provenance: "given", sourceText: "angle B = 50°" }],
  unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [],
};

const rad = (50 * Math.PI) / 180;
const triangle = (extra: Partial<SceneDocument> & { markAngle?: boolean; failProof?: boolean; decoration?: boolean }): SceneDocument => {
  const entities: SceneDocument["entities"] = [
    { id: "A", kind: "point", role: "vertex", label: "A" },
    { id: "B", kind: "point", role: "vertex", label: "B" },
    { id: "C", kind: "point", role: "vertex", label: "C" },
    { id: "ab", kind: "segment", role: "side" },
    { id: "bc", kind: "segment", role: "side" },
    { id: "ca", kind: "segment", role: "side" },
  ];
  const constructions: SceneDocument["constructions"] = [
    { id: "pA", operator: "point", inputs: { x: 4, y: 0 }, outputs: ["A"] },
    { id: "pB", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["B"] },
    { id: "pC", operator: "point", inputs: { x: 3 * Math.cos(rad), y: 3 * Math.sin(rad) }, outputs: ["C"] },
    { id: "sAB", operator: "segment", inputs: { start: "A", end: "B" }, outputs: ["ab"] },
    { id: "sBC", operator: "segment", inputs: { start: "B", end: "C" }, outputs: ["bc"] },
    { id: "sCA", operator: "segment", inputs: { start: "C", end: "A" }, outputs: ["ca"] },
  ];
  if (extra.markAngle) {
    entities.push({ id: "angB", kind: "angle_mark", role: "given angle", label: "50°" });
    constructions.push({ id: "mB", operator: "angle_mark", inputs: { vertex: "B", a: "A", b: "C" }, outputs: ["angB"] });
  }
  if (extra.decoration) {
    // A drawn, labelled median that no checklist item asks for: equally complete, more ink.
    entities.push({ id: "M", kind: "point", role: "midpoint", label: "M" }, { id: "cm", kind: "segment", role: "median" });
    constructions.push({ id: "pM", operator: "point", inputs: { x: 2, y: 0 }, outputs: ["M"] },
      { id: "sCM", operator: "segment", inputs: { start: "C", end: "M" }, outputs: ["cm"] });
  }
  const ids = entities.map((entity) => entity.id);
  return {
    schemaVersion: "scene-document/v2", source: { question },
    visualDecision: { mode: "scene", reason: "triangle with its given angle" }, quantities: [],
    entities, constructions, relations: [],
    assertions: [{ id: "exists", predicate: "exists", entities: ["ab"], expected: extra.failProof ? false : true, severity: "fatal" }],
    annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "Draw the triangle." }],
    teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Draw the triangle." }],
  };
};

const sparse = triangle({});
const complete = triangle({ markAngle: true });
const invalidComplete = triangle({ markAngle: true, failProof: true });
const decorated = triangle({ decoration: true });
const validate = (document: SceneDocument, turnPlan: TurnPlanV3 = plan) =>
  validateProductionSceneCandidate({ candidate: structuredClone(document) as unknown as Record<string, unknown>, question, turnPlan });
const baseScore = (validation: SceneCandidateValidation<ValidatedSceneCandidate>) =>
  (validation.qualityScore ?? 0) - (validation.value?.completeness?.missing.length ?? 0) * selection.COMPLETENESS_RANK_WEIGHT;

const sparseValidation = validate(sparse);
const completeValidation = validate(complete);
const invalidValidation = validate(invalidComplete);
assert(sparseValidation.valid && sparseValidation.value, JSON.stringify(sparseValidation.errors));
assert(completeValidation.valid && completeValidation.value, JSON.stringify(completeValidation.errors));
assert.equal(invalidValidation.valid, false, "a failed proof stays invalid");
assert.equal(invalidValidation.qualityScore, undefined, "an invalid candidate carries no quality score");
assert(completeValidation.value.report.stats.primitiveCount > sparseValidation.value.report.stats.primitiveCount,
  "the complete figure has more primitives");

// 1. The live planner search selects the complete sibling, and never an invalid one.
const originalFetch = globalThis.fetch;
async function search(byLane: Record<"primary" | "alternate", SceneDocument>) {
  globalThis.fetch = async (_input, init) => {
    const lane = new Headers(init?.headers).get("x-scene-planner-lane") === "alternate" ? "alternate" : "primary";
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(byLane[lane]) } }] }),
      { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    return await planSceneDocumentWithRepair(question,
      (candidate) => validateProductionSceneCandidate({ candidate, question, turnPlan: plan }),
      { proxyUrl: "http://planner.test", timeoutMs: 5_000 });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main(): Promise<void> {
  for (const [primary, alternate] of [[sparse, complete], [complete, sparse]] as const) {
    const result = await search({ primary, alternate });
    assert(result, "the search returns a result");
    assert.equal(result.candidates.length, 2, "both siblings are evaluated");
    assert(result.validation.valid, "a valid candidate is selected");
    assert.equal(result.response.lane, primary === complete ? "primary" : "alternate",
      "the more complete valid sibling is selected whichever lane it came from");
    assert.deepEqual(result.validation.value?.completeness?.missing, []);
  }

  const guarded = await search({ primary: sparse, alternate: invalidComplete });
  assert(guarded?.validation.valid, "the invalid but more complete sibling is never selected");
  assert.equal(guarded.response.lane, "primary");
  assert.equal(guarded.candidates.find((candidate) => candidate.response.lane === "alternate")?.selected, false);

  // 2. Both figures are valid and the old cost alone preferred the sparse one; one missing item outweighs it.
  assert(completeValidation.qualityScore! < sparseValidation.qualityScore!, "fewer missing items rank first");
  assert(baseScore(completeValidation) > baseScore(sparseValidation), "the existing cost prefers the sparser figure");
  assert.deepEqual(sparseValidation.value?.completeness?.missing.map((item) => item.rule), ["stated_angle"],
    "the sparse figure misses the given angle");
  assert.deepEqual(completeValidation.value?.completeness?.missing, [], "the complete figure misses nothing");

  // Equal completeness keeps the existing order: the sparser of two equally complete figures still wins.
  const tie = await search({ primary: decorated, alternate: sparse });
  assert.equal(tie?.response.lane, "alternate", "the existing cost breaks a completeness tie");

  // 3. Authority revalidation re-ranks with the same rule.
  const responses = [sparse, complete].map((document, index) => ({
    document: document as unknown as Record<string, unknown>, rawContent: JSON.stringify(document),
    phase: "plan" as const, lane: index === 0 ? "primary" as const : "alternate" as const, elapsedMs: 1,
  }));
  const previous: ScenePlanWithRepairResult<ValidatedSceneCandidate> = {
    response: responses[0]!, validation: sparseValidation, repaired: false,
    candidates: responses.map((response, index) => ({
      candidateId: response.lane, response, validation: index === 0 ? sparseValidation : completeValidation,
      score: 0, selected: index === 0,
    })),
  };
  const reranked = await revalidateScenePlanWithRepairResult(previous, (document) =>
    validateProductionSceneCandidate({ candidate: document, question, turnPlan: plan }));
  assert.equal(reranked.response.lane, "alternate", "revalidation keeps the more complete figure");

  // 4. The final production selection draws the selected figure, given angle included.
  const selected = selectProductionScene({ question, turnPlan: plan, problemIR: null, candidateValidation: reranked.validation });
  assert(selected.representation, selected.reason);
  assert(selected.representation.renderScene.primitives.some((primitive) => primitive.kind === "label" && primitive.text === "50°"),
    "the committed figure carries the given angle label");

  // 5. Unchanged elsewhere: no figure asked means no completeness term; a decline still ranks below any scene.
  const none = validate(sparse, { ...plan, visualRequirement: "none" });
  assert(none.valid && none.value);
  assert.equal(none.value.completeness, null);
  assert.equal(none.qualityScore, baseScore(sparseValidation), "a no-figure turn keeps the existing cost");
  const decline = validate({ ...sparse, visualDecision: { mode: "text_only", reason: "No faithful figure is available." },
    entities: [], constructions: [], assertions: [], requiredEntityIds: [], revealGroups: [], teachingTimeline: [] });
  assert(decline.valid && decline.qualityScore! > sparseValidation.qualityScore!, "a text-only decline never outranks a scene");

  // 6. Live and lab share this validator for the search and the revalidation.
  for (const consumer of ["features/tutor-session/hooks/turn/useQuestionHandler.ts", "scripts/lecture-lab/lecturePipeline.ts"]) {
    const source = readFileSync(resolve(process.cwd(), consumer), "utf8");
    assert(/validateCandidateAgainstPlan = \([\s\S]{0,400}validateProductionSceneCandidate\(\{ candidate, question, turnPlan: authoritativePlan \}\)/.test(source),
      `${consumer}: candidates are validated (and ranked) by validateProductionSceneCandidate`);
    assert(/planSceneDocumentWithRepair\([\s\S]{0,300}validateCandidateAgainstPlan\(candidate, planningTurnPlan\)/.test(source),
      `${consumer}: the planner search ranks with the shared validator`);
    assert(/revalidateScenePlanWithRepairResult\([\s\S]{0,200}validateCandidateAgainstPlan\(candidate, authoritativeTurnPlan/.test(source),
      `${consumer}: the authority revalidation ranks with the shared validator`);
  }
  console.log("completeness selection: the more complete valid figure wins, invalid never wins, ties keep the existing order, live and lab share it");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
