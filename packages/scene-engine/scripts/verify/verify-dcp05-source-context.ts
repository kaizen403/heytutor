import { strict as assert } from "node:assert";
import { solveDcNetwork, type DcNetwork } from "../../src/ir/circuitNetwork";
import { validateProblemIR, type ProblemIR } from "../../src/ir/problemIR";
import { LocalDeterministicSolverProvider, validateSolverResult } from "../../src/ir/solver";

const question = "ideal DC. Nodes A B C. V(B)=0 V. S connects A to B. V(A)-V(B)=12 V. R connects A to C, not B. R=6 ohm. T connects C to B. T=6 ohm";
function fact(id: string, quote: string, after = 0): ProblemIR["facts"][number] {
  const start = question.indexOf(quote, after);
  assert.ok(start >= 0);
  return { id, kind: "given", statement: quote, evidence: { source: "question", start, end: start + quote.length, quote } };
}
const network: DcNetwork = {
  model: "ideal_dc", modelFactId: "model", nodes: ["A", "B", "C"], referenceNode: "B", referenceFactId: "reference",
  branches: [
    { id: "S", kind: "voltage_source", from: "A", to: "B", connectionConstraintId: "sourceLink", lawFactId: "sourceLaw", quantityExpressionId: "E", quantityFactId: "voltage", unit: "V" },
    { id: "R", kind: "resistor", from: "A", to: "C", connectionConstraintId: "resistorLink", lawFactId: "resistorLaw", quantityExpressionId: "r", quantityFactId: "resistance", unit: "ohm" },
    { id: "T", kind: "resistor", from: "C", to: "B", connectionConstraintId: "tailLink", lawFactId: "tailLaw", quantityExpressionId: "t", quantityFactId: "tailResistance", unit: "ohm" },
  ],
};
const problem: ProblemIR = {
  schemaVersion: "problem-ir/v1", id: "sourceContext", question,
  facts: [fact("model", "ideal DC"), fact("nodes", "Nodes A B C"), fact("reference", "V(B)=0 V"),
    fact("sourceConnection", "S connects A to B"), fact("sourceLaw", "V(A)-V(B)=12 V"), fact("voltage", "12 V"),
    fact("resistorConnection", "R connects A to C"), fact("resistorLaw", "R=6 ohm"), fact("resistance", "6 ohm", question.indexOf("R=6 ohm")),
    fact("tailConnection", "T connects C to B"), fact("tailLaw", "T=6 ohm"), fact("tailResistance", "6 ohm", question.indexOf("T=6 ohm"))],
  entities: [...["A", "B", "C"].map((id) => ({ id, kind: "point" as const, evidenceFactIds: ["nodes"] })),
    { id: "S", kind: "component", evidenceFactIds: ["sourceConnection", "sourceLaw", "voltage"] },
    { id: "R", kind: "component", evidenceFactIds: ["resistorConnection", "resistorLaw", "resistance"] },
    { id: "T", kind: "component", evidenceFactIds: ["tailConnection", "tailLaw", "tailResistance"] }],
  expressions: [{ id: "E", valueType: "scalar", root: { kind: "number", value: 12 }, evidenceFactIds: ["voltage"] },
    { id: "r", valueType: "scalar", root: { kind: "number", value: 6 }, evidenceFactIds: ["resistance"] },
    { id: "t", valueType: "scalar", root: { kind: "number", value: 6 }, evidenceFactIds: ["tailResistance"] }],
  constraints: [{ id: "sourceLink", kind: "connected", entityIds: ["S", "A", "B"], evidenceFactIds: ["sourceConnection"] },
    { id: "resistorLink", kind: "connected", entityIds: ["R", "A", "C"], evidenceFactIds: ["resistorConnection"] },
    { id: "tailLink", kind: "connected", entityIds: ["T", "C", "B"], evidenceFactIds: ["tailConnection"] }],
  representationIntents: [], solveRequests: [{ id: "current", kind: "dc_network", network, output: { kind: "branch_current", id: "R" } }],
};
const provider = new LocalDeterministicSolverProvider();
const positive = await provider.solve(problem);
assert.equal(validateProblemIR(problem).valid, true);
assert.equal(positive.status, "solved");
assert.equal(positive.values[0].approximate, 1);
assert.equal(solveDcNetwork(problem, network).voltages.C.exact, "6");
assert.equal(validateSolverResult(positive, problem).valid, true);

async function rejects(next: ProblemIR, name: string) {
  const request = next.solveRequests[0];
  if (request.kind !== "dc_network") throw new Error("Missing DC request");
  assert.throws(() => solveDcNetwork(next, request.network), name);
  assert.equal(validateProblemIR(next).valid, false, name);
  const result = await provider.solve(next);
  assert.equal(result.status, "failed", name);
  assert.deepEqual(result.values, [], name);
  assert.deepEqual(result.proofs, [], name);
  assert.equal(validateSolverResult(positive, next).valid, false, `Forged authority: ${name}`);
}
const wrappers = ["The statement 'R connects A to B' is false", "Someone wrote 'R connects A to B'",
  "A student guessed R connects A to B", "If R connects A to B, the answer changes", "Suppose R connects A to B",
  "Do not assume R connects A to B", "R connects A to B?", "'R connects A to B'", '"R connects A to B"', "[R connects A to B]"];
for (const wrapper of wrappers) {
  const next = structuredClone(problem);
  next.question += `. ${wrapper}`;
  const evidence = next.facts.find((f) => f.id === "resistorConnection")!;
  evidence.statement = evidence.evidence.quote = "R connects A to B";
  evidence.evidence.start = next.question.lastIndexOf(evidence.evidence.quote);
  evidence.evidence.end = evidence.evidence.start + evidence.evidence.quote.length;
  const request = next.solveRequests[0];
  if (request.kind !== "dc_network") throw new Error("Missing DC request");
  request.network.branches[1].to = "B";
  next.constraints[1] = { id: "resistorLink", kind: "connected", entityIds: ["R", "A", "B"], evidenceFactIds: ["resistorConnection"] };
  await rejects(next, wrapper);
}
for (const suffix of ["The circuit description is hypothetical", "R connects A to B", "R=12 ohm", "X connects A to B. X=6 ohm", "V(A)-V(B)=18 V", "Nodes A B C D", "ideal DC", "R connects A to C, not C"]) {
  const next = structuredClone(problem);
  next.question += `. ${suffix}`;
  await rejects(next, suffix);
}
for (const quote of ["ideal DC", "V(B)=0 V", "V(A)-V(B)=12 V", "R=6 ohm", "Nodes A B C"]) {
  const next = structuredClone(problem);
  next.question += `. The statement '${quote}' is false`;
  const target = next.facts.find((f) => f.evidence.quote === quote)!;
  target.evidence.start = next.question.lastIndexOf(quote);
  target.evidence.end = target.evidence.start + quote.length;
  await rejects(next, `False context for ${quote}`);
}
const incomplete = structuredClone(problem);
const incompleteRequest = incomplete.solveRequests[0];
if (incompleteRequest.kind !== "dc_network") throw new Error("Missing DC request");
incompleteRequest.network.branches.pop();
await rejects(incomplete, "Omitted source branch");
console.log(JSON.stringify({ gate: "DCP05-affirmative-source-context", correctSeriesCurrent: 1, correctNodeVoltage: 6, fullPipelineAtomicNegatives: wrappers.length + 8 + 5 + 1, sourceCohortAndLiveReadiness: "not_claimed" }));
