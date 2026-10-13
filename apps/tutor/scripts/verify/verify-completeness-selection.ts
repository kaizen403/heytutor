/**
 * Among valid candidates, the figure that misses fewer completeness checklist
 * items wins, even when it has more primitives; the existing cost only breaks
 * ties. An invalid candidate is never selected, however complete it is.
 *
 * Runs the live planner search (planSceneDocumentWithRepair with a stubbed
 * proxy), the authority revalidation and the final production selection, all
 * with the shared validateProductionSceneCandidate that live and lab use.
 *
 * Section 7 drives runScenePlanningOverlap, the orchestrator both callers use,
 * with the completeness round: a figure that still misses an item is
 * completed by one more planner call and replaced only through the same
 * production validator; with less than 20 s left, or for a recovered scene,
 * no call is made. The hook and the lab must wire the round identically.
 *
 * Section 8: a completed reply that moves a point, changes an operator, moves
 * a label to another target or swaps vertex labels is refused even though it
 * keeps every id and label text and is more complete; the reply may only add.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  completeScenePlanWithRepairResult, planSceneDocumentWithRepair, revalidateScenePlanWithRepairResult,
  SCENE_COMPLETENESS_MIN_REMAINING_MS,
  type SceneCandidateValidation, type ScenePlanWithRepairResult,
} from "@heytutor/tutor-core";
import { runScenePlanningOverlap, type SceneGateCore } from "../../features/tutor-session/lib/scene/planningOverlap";
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
  // 7. The completeness round inside the shared orchestrator.
  type Result = ScenePlanWithRepairResult<ValidatedSceneCandidate>;
  const productionValidator = (turnPlan: TurnPlanV3) => (candidate: Record<string, unknown>) =>
    validateProductionSceneCandidate({ candidate, question, turnPlan });
  async function overlap(input: { complete: SceneDocument; elapsedMs: number; recover?: boolean; original?: SceneDocument }) {
    const phases: string[] = [];
    globalThis.fetch = async (_input, init) => {
      const phase = new Headers(init?.headers).get("x-scene-planner-phase") ?? "";
      phases.push(phase);
      const body = phase === "complete" ? input.complete : input.original ?? sparse;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }),
        { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      const outcome = await runScenePlanningOverlap<null, SceneGateCore, never, Result>({
        turnPlan: plan, problemAuthority: null, speculationAllowed: false, speculationEnabled: false,
        plannerStartedAt: 0, deadlineMs: 60_000, now: () => input.elapsedMs,
        deriveGate: () => ({ shouldPlanExactScene: true, shouldAttemptLlmScene: true, families: [], archetypeId: null, request: {} }),
        applyAuthority: (turnPlan, authority) => ({ turnPlan, authority }),
        fastFigureBlocked: () => false,
        selectFast: () => null,
        ...(input.recover ? {
          recover: (): Result => ({ response: { document: sparse as unknown as Record<string, unknown>, rawContent: "", phase: "plan", lane: "primary", elapsedMs: 0 },
            validation: sparseValidation, repaired: false, candidates: [] }),
        } : {}),
        planScene: (_gate, planningTurnPlan, run) => planSceneDocumentWithRepair(question, productionValidator(planningTurnPlan), {
          proxyUrl: "http://planner.test", signal: run.signal, timeoutMs: Math.min(run.timeoutMs, 5_000),
          maxConcurrentRequests: run.maxConcurrentRequests, requestBudget: run.requestBudget,
        }).catch(() => null),
        revalidate: (result, turnPlan) => revalidateScenePlanWithRepairResult(result, productionValidator(turnPlan)),
        complete: (_gate, result, turnPlan, round) => completeScenePlanWithRepairResult(question, result, productionValidator(turnPlan), {
          proxyUrl: "http://planner.test", signal: round.signal, remainingMs: round.remainingMs, requestBudget: round.requestBudget,
        }),
      });
      return { outcome, phases };
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  const completed = await overlap({ complete, elapsedMs: 10_000 });
  assert.equal(completed.outcome.completeness?.outcome, "replaced", "50 s left: the round runs and the complete reply replaces the figure");
  assert.deepEqual(completed.phases.filter((phase) => phase === "complete"), ["complete"], "exactly one completeness call");
  assert.equal(completed.outcome.timings.plannerCalls, 3, "two initial candidates plus the round, counted against the turn budget");
  assert.equal(completed.outcome.scene?.response.phase, "complete");
  assert.deepEqual(completed.outcome.completeness?.itemsStillMissing, []);
  const committed = selectProductionScene({ question, turnPlan: plan, problemIR: null, candidateValidation: completed.outcome.scene?.validation });
  assert(committed.representation?.renderScene.primitives.some((primitive) => primitive.kind === "label" && primitive.text === "50°"),
    "the committed figure is the completed one, given angle label included");

  const refused = await overlap({ complete: invalidComplete, elapsedMs: 10_000 });
  assert.equal(refused.outcome.completeness?.outcome, "invalid", "a reply that fails production validation is refused");
  assert.equal(refused.outcome.scene?.response.phase, "plan", "the original valid figure is kept");
  assert(refused.outcome.scene?.validation.valid);

  const late = await overlap({ complete, elapsedMs: 60_000 - SCENE_COMPLETENESS_MIN_REMAINING_MS + 1 });
  assert.equal(late.outcome.completeness?.outcome, "skipped_deadline", "under 20 s left: no round");
  assert.equal(late.phases.filter((phase) => phase === "complete").length, 0, "no completeness call under the floor");
  assert.equal(late.outcome.scene?.response.phase, "plan");

  const recovered = await overlap({ complete, elapsedMs: 10_000, recover: true });
  assert.equal(recovered.outcome.recovered, true);
  assert.equal(recovered.outcome.completeness, null, "a recovered scene is never completed");
  assert.equal(recovered.phases.length, 0, "a recovered scene makes no planner call");

  // 8. The reply may only add: a more complete reply that keeps every id and label text but changes
  // existing geometry or label targets is refused, and the original kept. Every case runs and each
  // failure is named, so a fail-first run shows them all.
  const edit = (document: SceneDocument, change: (copy: SceneDocument) => void): SceneDocument => {
    const copy = structuredClone(document);
    change(copy);
    return copy;
  };
  const construction = (document: SceneDocument, id: string) => {
    const found = document.constructions.find((item) => item.id === id);
    assert(found, `construction ${id}`);
    return found;
  };
  const entity = (document: SceneDocument, id: string) => {
    const found = document.entities.find((item) => item.id === id);
    assert(found, `entity ${id}`);
    return found;
  };
  const withBaseLabel = (document: SceneDocument, target = "ab"): SceneDocument => edit(document, (copy) => {
    copy.annotations.push({ id: "baseLabel", kind: "label", targetIds: [target], text: "base" });
  });
  const labelledSparse = withBaseLabel(sparse);
  const kept = async (reply: SceneDocument, original: SceneDocument, change: string) => {
    for (const [name, document] of [["original", original], ["reply", reply]] as const) {
      const validation = validate(document);
      assert(validation.valid, `the ${name} is valid on its own: ${JSON.stringify(validation.errors.map((error) => error.code))}`);
    }
    const round = await overlap({ complete: reply, elapsedMs: 10_000, original });
    assert.equal(round.outcome.completeness?.outcome, "changed_content", "the round refuses the reply");
    assert.equal(round.outcome.completeness?.accepted, false);
    assert((round.outcome.completeness?.changedContent ?? []).includes(change),
      `the change is named: ${JSON.stringify(round.outcome.completeness?.changedContent)}`);
    assert.equal(round.outcome.scene?.response.phase, "plan", "the original figure is kept");
  };
  const replyCases: Array<readonly [string, () => Promise<void>]> = [
    ["a reply that moves vertex C along BC (same ids, same labels, angle B unchanged)", () =>
      kept(edit(complete, (copy) => { construction(copy, "pC").inputs = { x: 4 * Math.cos(rad), y: 4 * Math.sin(rad) }; }),
        sparse, "construction pC: inputs")],
    ["a reply that draws side CA with another operator", () =>
      kept(edit(complete, (copy) => { construction(copy, "sCA").operator = "connect"; }), sparse, "construction sCA: operator")],
    ["a reply that moves the base label from side AB to side BC", () =>
      kept(withBaseLabel(complete, "bc"), labelledSparse, "annotation baseLabel: targetIds")],
    ["a reply that swaps the labels of vertices A and B", () =>
      kept(edit(complete, (copy) => { entity(copy, "A").label = "B"; entity(copy, "B").label = "A"; }), sparse, "entity A: label")],
    // Controls: a reply that only adds is still accepted, also when it rounds a long float as it copies the document.
    ["control: a reply that only adds the mark, rounding C's coordinates to four places, replaces the figure", async () => {
      const rounded = edit(complete, (copy) => {
        construction(copy, "pC").inputs = { x: Number((3 * Math.cos(rad)).toFixed(4)), y: Number((3 * Math.sin(rad)).toFixed(4)) };
      });
      const round = await overlap({ complete: rounded, elapsedMs: 10_000 });
      assert.equal(round.outcome.completeness?.outcome, "replaced");
      assert.equal(round.outcome.completeness?.changedContent?.length ?? 0, 0, "rounding is not a change");
    }],
    ["control: a reply that keeps the base label on AB and adds the mark replaces the figure", async () => {
      const round = await overlap({ complete: withBaseLabel(complete), elapsedMs: 10_000, original: labelledSparse });
      assert.equal(round.outcome.completeness?.outcome, "replaced");
    }],
  ];
  const replyFailures: string[] = [];
  for (const [name, run] of replyCases) {
    try {
      await run();
    } catch (error) {
      replyFailures.push(`${name}: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`);
    }
  }
  assert.equal(replyFailures.length, 0, `${replyFailures.length} of ${replyCases.length} reply cases fail\n  ${replyFailures.join("\n  ")}`);

  // Live and lab wire the round the same way, with the shared validator bound to the authoritative plan.
  for (const consumer of ["features/tutor-session/hooks/turn/useQuestionHandler.ts", "scripts/lecture-lab/lecturePipeline.ts"]) {
    const source = readFileSync(resolve(process.cwd(), consumer), "utf8");
    assert(/complete: \(gate, sceneResult, authoritativeTurnPlan, round\) =>[\s\S]{0,200}completeScenePlanWithRepairResult\(\s*question,\s*sceneResult,\s*\(candidate\) => validateCandidateAgainstPlan\(candidate, authoritativeTurnPlan/.test(source),
      `${consumer}: the completeness round validates with the shared validator on the authoritative plan`);
    assert(/remainingMs: round\.remainingMs,\s*requestBudget: round\.requestBudget,/.test(source),
      `${consumer}: the round gets the overlap's deadline and the turn's request budget`);
  }
  const lab = readFileSync(resolve(process.cwd(), "scripts/lecture-lab/lecturePipeline.ts"), "utf8");
  assert(/run\.diagram\.completeness = planning\.completeness;/.test(lab), "the lab records the round in the run JSON");
  assert(/completenessMs: planning\.timings\.completenessMs,/.test(lab), "the lab records the time the round added");
  console.log("completeness selection: the more complete valid figure wins, invalid never wins, ties keep the existing order, live and lab share it");
  console.log("completeness round: the overlap completes a valid figure through the production validator, refuses an invalid reply, skips under 20 s and for recovered scenes; live and lab wire it alike");
  console.log("completeness round: a reply that moves a point, changes an operator, moves a label or swaps vertex labels is refused; a reply that only adds is accepted");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
