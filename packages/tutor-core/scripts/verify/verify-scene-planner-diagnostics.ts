import assert from "node:assert/strict";
import { planSceneDocument, scenePlannerCandidateDiagnostics, type ScenePlannerRequestOutcome } from "../../src/planners/scenePlannerV2";

const document = {
  visualDecision: { mode: "text_only", reason: "missing symbolic construction" },
  constructions: [
    { id: "kit", operator: "chem_skeletal_molecule", inputs: { smiles: "🙂".repeat(900) } },
    { id: "point", operator: "point", inputs: { x: 0, y: 1, coordinateSpace: "world" } },
  ],
};
const diagnostics = scenePlannerCandidateDiagnostics(document, false);
assert.equal(diagnostics.declineReason, "missing symbolic construction");
assert.equal(diagnostics.rejectedCalls.length, 2);
assert.ok(diagnostics.rejectedCalls[0]?.truncated);
assert.ok(new TextEncoder().encode(diagnostics.rejectedCalls[0]?.rawArguments).length <= 2048);
assert.equal(diagnostics.rejectedCalls[1]?.rawArguments, JSON.stringify(document.constructions[1]?.inputs));
assert.equal(scenePlannerCandidateDiagnostics(document, true).rejectedCalls.length, 0);
assert.equal(scenePlannerCandidateDiagnostics({ visualDecision: { mode: "scene", reason: "setup" } }, false).declineReason, null);
assert.equal(scenePlannerCandidateDiagnostics({
  visualDecision: "text_only", source: { visualLimitation: "no supplied original figure" },
}, false).declineReason, "no supplied original figure");
assert.equal(scenePlannerCandidateDiagnostics({
  visualDecision: { mode: "text_only", reason: "" }, declineReason: "missing operator",
}, false).declineReason, "missing operator");
assert.equal(scenePlannerCandidateDiagnostics({
  visualDecision: { mode: "scene" }, source: { visualLimitation: "qualitative only" },
}, false).declineReason, null);
const fetchOriginal = globalThis.fetch;
const outcomes: ScenePlannerRequestOutcome[] = [];
globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(document) } }] }));
try {
  await planSceneDocument("symbolic question", { proxyUrl: "http://planner.test", onRequestOutcome: (outcome) => outcomes.push(outcome) });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]?.declineReason, diagnostics.declineReason);
} finally { globalThis.fetch = fetchOriginal; }
console.log("scene planner diagnostics: refusals and every rejected call retained with 2 KB UTF-8 bound");
