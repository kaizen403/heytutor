import { strict as assert } from "node:assert";
import type { ProblemIR, TurnPlanV3 } from "@heytutor/scene-engine";
import { planAndSolveProblemV1, normalizeProblemIRModelOutput } from "../../src/planners/problemPlannerV1";

const question = "An ideal DC circuit has nodes A and B. Source S connects A to B, V(A)-V(B)=12 V. Resistor R connects A to B, R=6 ohm. Find current I through R.";
const fact = (id: string, quote: string, kind: "given" | "requested" = "given") => ({ id, kind, statement: quote, evidence: { source: "question" as const, start: question.indexOf(quote), end: question.indexOf(quote) + quote.length, quote } });
const problem: ProblemIR = {
  schemaVersion: "problem-ir/v1", id: "dc", question,
  facts: [fact("model", "ideal DC"), fact("sourceConnection", "Source S connects A to B"), fact("resistorConnection", "Resistor R connects A to B"), fact("voltage", "12 V"), fact("resistance", "6 ohm"), fact("sourceLaw", "V(A)-V(B)=12 V"), fact("resistorLaw", "R=6 ohm"), fact("currentRequest", "Find current I through R", "requested")],
  entities: [
    { id: "A", kind: "point", evidenceFactIds: ["sourceConnection", "resistorConnection"] },
    { id: "B", kind: "point", evidenceFactIds: ["sourceConnection", "resistorConnection"] },
    { id: "S", kind: "component", evidenceFactIds: ["sourceConnection", "voltage"] },
    { id: "R", kind: "component", evidenceFactIds: ["resistorConnection", "resistance"] },
  ],
  expressions: [
    { id: "E", valueType: "scalar", root: { kind: "number", value: 12 }, evidenceFactIds: ["voltage"] },
    { id: "r", valueType: "scalar", root: { kind: "number", value: 6 }, evidenceFactIds: ["resistance"] },
  ],
  constraints: [
    { id: "sourceLink", kind: "connected", entityIds: ["S", "A", "B"], evidenceFactIds: ["sourceConnection"] },
    { id: "resistorLink", kind: "connected", entityIds: ["R", "A", "B"], evidenceFactIds: ["resistorConnection"] },
  ], representationIntents: [{ id: "networkPicture", kind: "network", entityIds: ["A", "B", "S", "R"], evidenceFactIds: ["sourceConnection", "resistorConnection"] }],
  solveRequests: [{
    id: "currentSolve", kind: "dc_network", output: { kind: "branch_current", id: "R" },
    network: { model: "ideal_dc", modelFactId: "model", nodes: ["A", "B"], referenceNode: "B", branches: [
      { id: "S", kind: "voltage_source", from: "A", to: "B", connectionConstraintId: "sourceLink", lawFactId: "sourceLaw", quantityExpressionId: "E", quantityFactId: "voltage", unit: "V" },
      { id: "R", kind: "resistor", from: "A", to: "B", connectionConstraintId: "resistorLink", lawFactId: "resistorLaw", quantityExpressionId: "r", quantityFactId: "resistance", unit: "ohm" },
    ] },
    resultBinding: { turnPlanQuantityId: "current", symbol: "I", unit: "A", evidenceFactIds: ["currentRequest"] },
  }],
};
const plan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question,
  givens: [
    { id: "emf", symbol: "E", value: 12, unit: "V", provenance: "given", sourceText: "12 V" },
    { id: "resistance", symbol: "R", value: 6, unit: "ohm", provenance: "given", sourceText: "6 ohm" },
  ],
  unknowns: [{ id: "current", symbol: "I", unit: "A" }],
  derived: [{ id: "current", symbol: "I", value: 2, unit: "A", provenance: "derived", sourceText: "I = 12 / 6 = 2" }],
  qualitativeClaims: [], lawIds: ["ohms_law", "kirchhoff_current_law"], assumptions: [], visualRequirement: "required",
};
const normalized = normalizeProblemIRModelOutput(problem, question, plan) as ProblemIR;
assert.equal(normalized.solveRequests.length, 1, "The real model boundary must not discard a typed network request");
const options = (response: ProblemIR) => ({
  proxyUrl: "http://localhost/api/chat", timeoutMs: 2000,
  fetchImpl: (async (_input, init) => {
    const payload = JSON.parse(String(init?.body));
    assert.ok(payload.messages[0].content.includes("dc_network"));
    return Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] });
  }) as typeof fetch,
});
const result = await planAndSolveProblemV1(question, plan, options(problem));
assert.equal(result?.solverResult.values[0]?.approximate, 2);
assert.equal(result?.audit.status, "verified", JSON.stringify(result?.audit));
assert.ok(result?.projection);
const contradiction = structuredClone(plan);
contradiction.derived[0].value = 3;
const contradicted = await planAndSolveProblemV1(question, contradiction, options(problem));
assert.equal(contradicted?.audit.status, "contradiction");
assert.equal(contradicted?.projection, null);
const unsupported = structuredClone(problem);
if (unsupported.solveRequests[0].kind !== "dc_network") throw new Error("Missing circuit fixture");
unsupported.solveRequests[0].network.branches[0].from = "B";
unsupported.solveRequests[0].network.branches[0].to = "A";
assert.equal(await planAndSolveProblemV1(question, plan, options(unsupported)), null);
console.log("DCP05 network planner transport: source-bound current, contradiction and incorrect polarity rejection pass; no live LLM/scene/replay claim");
