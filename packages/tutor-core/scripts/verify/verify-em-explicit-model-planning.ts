import { strict as assert } from "node:assert";
import { validateProblemIR } from "@heytutor/scene-engine";
import { normalizeProblemIRModelOutput } from "../../src/planners/problemPlannerV1";
import { physicalModelPlanningGuidance } from "../../src/planners/physicalModelGuidance";

const guidance = physicalModelPlanningGuidance();
assert(guidance.includes('"model":"dc.wheatstone"'), "planner prompt must expose the admitted model name");
assert(guidance.includes('["emf","source emf","V",null]'), "planner prompt must expose exact source role/unit bindings");
assert(guidance.includes("never emit more than one explicit physical-model request"), "planner prompt must refuse ambiguous multi-model transport");

const question = "A balanced Wheatstone bridge has source emf 12 V, source internal resistance 1 ohm, upper left arm resistance 2 ohm, upper right arm resistance 4 ohm, lower left arm resistance 2 ohm, lower right arm resistance 4 ohm, and galvanometer resistance 5 ohm. Find source current.";
const facts = [
  ["balanced", "assumption", "balanced"],
  ["emf", "given", "12 V"],
  ["r", "given", "1 ohm"],
  ["P", "given", "upper left arm resistance 2 ohm"],
  ["Q", "given", "upper right arm resistance 4 ohm"],
  ["R", "given", "lower left arm resistance 2 ohm"],
  ["S", "given", "lower right arm resistance 4 ohm"],
  ["Rg", "given", "galvanometer resistance 5 ohm"],
  ["asked", "requested", "source current"],
].map(([id, kind, quote]) => ({
  id,
  kind,
  statement: ({
    emf: "The source emf is stated in V.",
    r: "The source internal resistance is stated in ohm.",
    P: "The left arm resistance is stated in ohm.",
    Q: "The right arm resistance is stated in ohm.",
    Rg: "The galvanometer resistance is stated in ohm.",
  } as Record<string, string>)[id] ?? quote,
  quote,
}));
const expressions = [
  ["emf", "12", "emf"], ["r", "1", "r"], ["P", "2", "P"], ["Q", "4", "Q"],
  ["R", "2", "R"], ["S", "4", "S"], ["Rg", "5", "Rg"],
].map(([id, expr, fact]) => ({ id, valueType: "scalar", expr, evidenceFactIds: [fact] }));
const roles = {
  emf: ["source emf", "V"], r: ["source internal resistance", "ohm"],
  P: ["left arm resistance", "ohm"], Q: ["right arm resistance", "ohm"],
  Rg: ["galvanometer resistance", "ohm"],
} as const;
const request = {
  id: "explicitModel",
  kind: "explicit_physical_model",
  model: "dc.wheatstone",
  bindings: Object.entries(roles).map(([key, [role, unit]]) => ({ key, role, unit, expressionId: key, evidenceFactId: key })),
  evidenceFactIds: ["asked"],
  resultBinding: { turnPlanQuantityId: "sourceCurrent", symbol: "I_S", unit: "A", evidenceFactIds: ["asked"] },
};
const raw = { facts, entities: [], expressions, constraints: [], representationIntents: [], solveRequests: [request] };
const normalized = normalizeProblemIRModelOutput(raw, question, null) as { solveRequests?: unknown[] };
assert.equal(normalized.solveRequests?.length, 1, "normalizer must retain a complete explicit physical-model request");
assert.equal((normalized.solveRequests?.[0] as { kind?: unknown }).kind, "explicit_physical_model");
const validation = validateProblemIR(normalized, question);
assert(validation.problem, `retained request must pass the source-grounded ProblemIR boundary: ${JSON.stringify(validation.issues)}`);

for (const mutate of [
  (candidate: typeof request) => { candidate.bindings[0]!.expressionId = "missing"; },
  (candidate: typeof request) => { candidate.bindings[0]!.evidenceFactId = "missing"; },
]) {
  const bad = structuredClone(request);
  mutate(bad);
  const result = normalizeProblemIRModelOutput({ ...raw, solveRequests: [bad] }, question, null) as { solveRequests?: unknown[] };
  assert.equal(result.solveRequests?.length, 0, "normalizer must atomically drop malformed physical-model requests");
}

const wrongRole = structuredClone(request);
wrongRole.bindings[0]!.role = "unrelated quantity";
const wrongRoleResult = normalizeProblemIRModelOutput({ ...raw, solveRequests: [wrongRole] }, question, null);
assert.equal(validateProblemIR(wrongRoleResult, question).problem, null, "source-role mismatch must reject the complete normalized IR");

console.log("explicit physical-model planning transport checks passed");
