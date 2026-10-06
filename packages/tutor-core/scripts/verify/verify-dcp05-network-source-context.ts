import { strict as assert } from "node:assert";
import type { ProblemIR, TurnPlanV3 } from "@heytutor/scene-engine";
import { planAndSolveProblemV1 } from "../../src/planners/problemPlannerV1";

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
const options = (response: ProblemIR) => ({
  proxyUrl: "http://localhost/api/chat", timeoutMs: 2000,
  fetchImpl: (async (_input, init) => {
    const payload = JSON.parse(String(init?.body));
    assert.ok(payload.messages[0].content.includes("complete supported assertion document"));
    return Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] });
  }) as typeof fetch,
});
const positive = await planAndSolveProblemV1(question, plan, options(problem));
assert.equal(positive?.solverResult.values[0]?.approximate, 2);
assert.equal(positive?.audit.status, "verified");
assert.ok(positive?.projection);
const suffixes = ["The statement 'R connects A to B' is false", "Someone wrote 'R=6 ohm'", "Assume the preceding description is incorrect", "R=12 ohm", "X connects A to B. X=6 ohm"];
for (const suffix of suffixes) {
  const next = structuredClone(problem);
  next.question += `. ${suffix}`;
  const nextPlan = structuredClone(plan);
  nextPlan.question = next.question;
  assert.equal(await planAndSolveProblemV1(next.question, nextPlan, options(next)), null, suffix);
}
const falseValue = structuredClone(problem);
falseValue.question += ". The statement 'R=12 ohm' is false";
for (const [id, quote] of [["resistorLaw", "R=12 ohm"], ["resistance", "12 ohm"]]) {
  const target = falseValue.facts.find((f) => f.id === id)!;
  target.statement = target.evidence.quote = quote;
  target.evidence.start = falseValue.question.lastIndexOf(quote);
  target.evidence.end = target.evidence.start + quote.length;
}
falseValue.expressions[1].root = { kind: "number", value: 12 };
const falsePlan = structuredClone(plan);
falsePlan.question = falseValue.question;
falsePlan.givens[1] = { ...falsePlan.givens[1], value: 12, sourceText: "12 ohm" };
falsePlan.derived[0] = { ...falsePlan.derived[0], value: 1, sourceText: "I = 12 / 12 = 1" };
assert.equal(await planAndSolveProblemV1(falseValue.question, falsePlan, options(falseValue)), null);
console.log(JSON.stringify({ gate: "DCP05-network-source-context-transport", positiveProjection: 2, unsupportedContextDeclines: suffixes.length + 1, liveLLMAndSceneReadiness: "not_claimed" }));
