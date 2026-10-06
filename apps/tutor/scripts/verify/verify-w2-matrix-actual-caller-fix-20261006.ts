import assert from "node:assert/strict";
import * as engine from "@heytutor/scene-engine";
import { inferSceneCapabilities, planProblemAuthorityV1 } from "@heytutor/tutor-core";
import { planProblemAuthorityV1 as sourceAPI } from "../../../../packages/tutor-core/src/planners/problemPlannerV1";
import { callers, actual, planMutations, irMutations } from "../../../../packages/scene-engine/scripts/verify/fixtures/w2-matrix-actual-caller-fix-20261006/cases";
import { selectVerifiedRepresentation, selectFastVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { selectBestAvailableTurnPlan } from "../../features/tutor-session/lib/scene/diagramGeneration";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { liveSceneSaveFailure } from "../../lib/scene/sceneSaveAdmission";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import type { StoredTurn } from "../../lib/boards/boardsClient";
let checks = 0;
function equal(value: unknown, expected: unknown, label: string) { assert.deepEqual(value, expected, label); checks++; }
async function api(question: string, plan: engine.TurnPlanV3, raw: unknown, source = false) {
  return (source ? sourceAPI : planProblemAuthorityV1)(question, plan, {
    proxyUrl: "https://offline.invalid", timeoutMs: 3000,
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) } }] }), { status: 200 }),
  });
}
async function lifecycle(id: string, question: string, plan: engine.TurnPlanV3 | null, problemIR: engine.ProblemIR | null, document: engine.SceneDocument, expected: boolean) {
  const context = { question, turnPlan: plan, problemIR };
  const before = JSON.stringify(context);
  const compiled = engine.compileSceneDocument(document, { sourceAuthority: context });
  equal(compiled.ok, expected, `${id}: public compiler`);
  if (!expected) equal(compiled.renderScene, null, `${id}: no partial ink`);
  equal(engine.validateSceneDocument(document, { sourceAuthority: context }).report.valid, expected, `${id}: public structural validator`);
  equal(engine.validateSceneSourceAuthority(document, question, problemIR, plan).length === 0, expected, `${id}: public central authority`);
  equal(inferSceneCapabilities(question, { turnPlan: plan ?? undefined, problemIR }).hasSourceProgram, expected, `${id}: executed availability`);
  const selected = selectVerifiedRepresentation({ ...context, exact: null });
  equal(selected.renderScene.primitives.length > 0, expected, `${id}: actual app selector`);
  const unbound = engine.compileSceneDocument(document);
  assert(unbound.ok && unbound.renderScene);
  const supplied = selectVerifiedRepresentation({ ...context, exact: { sceneDocument: document, renderScene: unbound.renderScene, validationReport: unbound.report } });
  equal(supplied.renderScene.primitives.length > 0, expected, `${id}: supplied candidate rechecks the whole caller`);
  if (!expected) equal(selectFastVerifiedRepresentation({ ...context, exact: null }), null, `${id}: fast selector refuses the whole caller`);
  if (expected) equal([selected.tier, selected.nonMetric], ["qualitative_verified", true], `${id}: nonmetric selected tier`);
  equal(liveSceneSaveFailure({ document, ...context, tier: "qualitative_verified" }) === null, expected, `${id}: live save admission`);
  const artifacts: engine.SceneArtifactsV3 = { schemaVersion: "scene-artifacts/v3", turnPlan: plan, problemIR,
    solverResult: problemIR ? await new engine.LocalDeterministicSolverProvider().solve(problemIR) : null, solverAuthority: null, representationTier: "qualitative_verified", nonMetric: true,
    candidates: [], diagramResultStatus: "ready" };
  const turn: StoredTurn = { id, question, rawResponse: "", orderIndex: 0, speedMultiplier: 2, traceId: null, segments: [],
    sceneDocument: document, sceneArtifacts: artifacts, visualStatus: "validated", sceneEngineVersion: null, validationReport: null };
  const saved = await canonicalizeTurnSceneMetadata({ ...turn, segments: [] });
  equal(saved.ok, expected, `${id}: canonical save`);
  equal(sourceCheckedStoredTurn(JSON.parse(JSON.stringify(turn))).visualStatus === "validated", expected, `${id}: serialized read`);
  equal(restoreVerifiedPresentationFromTurn(JSON.parse(JSON.stringify(turn))) !== null, expected, `${id}: serialized restore`);
  if (saved.ok) {
    equal(saved.value.sceneArtifacts?.turnPlan, plan, `${id}: saved entire original Plan`);
    equal(saved.value.sceneArtifacts?.problemIR, problemIR, `${id}: saved entire original IR`);
    const restored = restoreVerifiedPresentationFromTurn(JSON.parse(JSON.stringify({ ...turn, ...saved.value })));
    assert(restored);
    equal(restored.introSegments, buildVerifiedDiagramPresentation(document, compiled.renderScene!).introSegments, `${id}: canonical saved replay`);
  }
  equal(JSON.stringify(context), before, `${id}: caller channels untouched`);
}
async function main() {
  for (const caller of [callers[1]!, callers[0]!, ...callers.slice(2)]) {
    const { id, question, plan, problemIR } = caller;
    const before = JSON.stringify(caller);
    for (const source of [false, true]) {
      const response = await api(question, plan, problemIR, source);
      assert(response && !("status" in response));
      equal(response.problemIR, problemIR, `${id}: source/public normal API full IR`);
      equal([response.solverResult.status, response.solverResult.values.length, response.audit.status, response.projection], ["solved", 0, "not_applicable", null], `${id}: no invented numeric projection`);
      const early = engine.applySourceQuantityAuthority(plan, null, question);
      const final = engine.applySourceQuantityAuthority(early.plan, response.problemIR, question);
      equal(JSON.stringify(final.plan), JSON.stringify(plan), `${id}: every original before/after IR Plan field`);
      equal(early.plan === plan && final.plan === plan, true, `${id}: real before/after IR quantity authority retains original Plan`);
    }
    const prepared = engine.prepareMatrixProductSourceAuthority(question, plan, problemIR); assert(prepared);
    await lifecycle(id, question, plan, problemIR, prepared.document, true);
    equal(JSON.stringify(caller), before, `${id}: original graph and evidence remain intact`);
    if (!id.startsWith("actual")) {
      const falsePlan = structuredClone(plan);
      falsePlan.qualitativeClaims[0]!.expected = `${plan.unknowns[0]!.id}=[[999]]`;
      await lifecycle(`${id}-false-whole-literal`, question, falsePlan, problemIR, prepared.document, false);
    }
  }
  for (const source of [false, true]) {
    const compact = await api(actual.question, actual.plans[1]!, actual.rawProblemResponse, source);
    assert(compact && !("status" in compact));
    for (const key of ["facts", "entities", "expressions", "constraints", "representationIntents", "solveRequests"] as const)
      equal(compact.problemIR[key], actual.problemIR[key], `actual1304: compact original ${key} wire lifting only`);
  }
  const caller = callers[1]!;
  equal(selectBestAvailableTurnPlan(caller.plan, actual.plans[0], actual.plans[0]!), caller.plan, "real alternate selection retains entire alternate");
  const prepared = engine.prepareMatrixProductSourceAuthority(caller.question, caller.plan, caller.problemIR)!;
  for (const [name, mutate] of Object.entries(planMutations)) {
    const plan = structuredClone(caller.plan); mutate(plan);
    const before = JSON.stringify(plan);
    const response = await api(caller.question, plan, caller.problemIR);
    assert(response && !("status" in response));
    equal(response.problemIR, caller.problemIR, `${name}: fact-only normal API retains original IR even when Plan refuses`);
    const outcome = engine.applySourceQuantityAuthority(plan, response.problemIR, caller.question);
    equal(outcome.plan === plan && outcome.outcomes[0]?.declineFigure, true, `${name}: whole caller refusal retains Plan`);
    await lifecycle(name, caller.question, outcome.plan, response.problemIR, prepared.document, false);
    equal(JSON.stringify(plan), before, `${name}: original refused Plan unchanged`);
  }
  for (const [name, mutate] of Object.entries(irMutations)) {
    const problemIR = structuredClone(caller.problemIR); mutate(problemIR);
    for (const source of [false, true]) {
      const response = await api(caller.question, caller.plan, problemIR, source);
      assert(response && "status" in response);
      equal(response.rawProblemIR, problemIR, `${name}: source/public normal API preserves whole refused IR`);
    }
    const outcome = engine.applySourceQuantityAuthority(caller.plan, problemIR, caller.question);
    equal(outcome.plan === caller.plan && outcome.outcomes[0]?.declineFigure, true, `${name}: no surrogate Plan on IR refusal`);
    await lifecycle(name, caller.question, caller.plan, problemIR, prepared.document, false);
  }
  await lifecycle("missingPlan", caller.question, null, caller.problemIR, prepared.document, false);
  await lifecycle("missingIR", caller.question, caller.plan, null, prepared.document, false);
  for (const variant of ["wrongProduct", "falseCue", "extraAssertion", "reverseReveal"] as const) {
    const document = structuredClone(prepared.document);
    if (variant === "wrongProduct") {
      const product = document.constructions.find(c => c.operator === "matrix_product")!;
      [product.inputs.left, product.inputs.right] = [product.inputs.right, product.inputs.left];
    }
    if (variant === "falseCue") document.revealGroups[0]!.narrationCue = "A is singular";
    if (variant === "extraAssertion") document.assertions.push({ id: "hidden", predicate: "symmetric", entities: [], severity: "fatal" });
    if (variant === "reverseReveal") document.revealGroups.reverse();
    const compiled = engine.compileSceneDocument(document, { sourceAuthority: { question: caller.question, turnPlan: caller.plan, problemIR: caller.problemIR } });
    equal([compiled.ok, compiled.renderScene], [false, null], `${variant}: document refuses atomically`);
    equal(liveSceneSaveFailure({ document, question: caller.question, turnPlan: caller.plan, problemIR: caller.problemIR, tier: "qualitative_verified" }) !== null, true, `${variant}: live/save refuses document`);
  }
  console.log(`PASS ${checks} fresh public ESM + app source normal API, selectors, full negatives, save/read/restore checks; student/runtime pending`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
