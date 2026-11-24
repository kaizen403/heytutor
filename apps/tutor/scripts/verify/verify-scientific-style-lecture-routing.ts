import assert from "node:assert/strict";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import { selectProductionNativeSourceRepresentation } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { runScenePlanningOverlap, type ScenePlanningOverlapInput, type SceneGateCore, type SceneResultShape } from "../../features/tutor-session/lib/scene/planningOverlap";

const question = "Solve x + y = 5 and x - y = 1. Plot both lines and label their intersection.";
const plan = createFallbackTurnPlanV3(question);
plan.visualRequirement = "required";
type Figure = NonNullable<ReturnType<typeof selectProductionNativeSourceRepresentation>>;
async function run(options: { enabled: boolean; source?: string; blocked?: boolean; required?: boolean; cancelled?: boolean }) {
  let nativeCalls = 0, legacyCalls = 0, modelCalls = 0;
  const controller = new AbortController();
  if (options.cancelled) controller.abort();
  const input: ScenePlanningOverlapInput<null, SceneGateCore, Figure, SceneResultShape> = {
    turnPlan: plan, problemAuthority: null, speculationAllowed: false, selectionOrder: "planner_first",
    plannerStartedAt: Date.now(), deadlineMs: 60_000, signal: controller.signal,
    deriveGate: () => ({ shouldPlanExactScene: options.required !== false, shouldAttemptLlmScene: options.required !== false,
      families: [], archetypeId: null, request: {} }),
    applyAuthority: (turnPlan, authority) => ({ turnPlan, authority }), fastFigureBlocked: () => options.blocked === true,
    selectFast: () => { legacyCalls++; return null; },
    ...(options.enabled ? { selectNative: () => {
      nativeCalls++;
      return selectProductionNativeSourceRepresentation(options.source ?? question, plan, null);
    } } : {}),
    planScene: async () => { modelCalls++; return null; }, revalidate: async value => value,
  };
  const outcome = await runScenePlanningOverlap(input);
  return { outcome, nativeCalls, legacyCalls, modelCalls };
}
async function main() {
  const ready = await run({ enabled: true });
  assert.equal(ready.outcome.fast?.figureSource, "native_source", "strict lectures must offer the proved native source");
  assert.equal(ready.modelCalls, 0, "fully proved native source suppresses paid scene requests");
  assert.equal(ready.legacyCalls, 0, "enabling native styling must not run legacy fast fallbacks in strict mode");
  assert.equal(ready.outcome.figureSource, "native_source");
  const disabled = await run({ enabled: false });
  assert.equal(disabled.nativeCalls, 0);
  assert.equal(disabled.modelCalls, 1, "default strict routing remains unchanged");
  const decline = await run({ enabled: true, source: "Explain an arbitrary unsupported mechanism." });
  assert.equal(decline.outcome.fast, null);
  assert.equal(decline.modelCalls, 1, "an unsupported source still receives the existing planner and fallback flow");
  assert.equal((await run({ enabled: true, blocked: true })).nativeCalls, 0, "solver contradiction blocks native geometry");
  const noFigure = await run({ enabled: true, required: false });
  assert.equal(noFigure.nativeCalls, 0);
  assert.equal(noFigure.modelCalls, 0);
  await assert.rejects(run({ enabled: true, cancelled: true }), /abort/i);
  console.log("scientific style routing: real native proof in strict, no model on proof, default/decline/solver/no-figure/cancellation pass");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
