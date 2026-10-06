import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { solveDcNetwork, DcNetworkError, type DcBranch, type DcNetwork } from "../../src/ir/circuitNetwork";
import { validateProblemIR, type ProblemIR } from "../../src/ir/problemIR";
import { LocalDeterministicSolverProvider, validateSolverResult } from "../../src/ir/solver";

const question = "An ideal DC circuit has nodes A and B. Source S connects A to B, V(A)-V(B)=12 V. Resistor R connects A to B, R=6 ohm.";
const fact = (id: string, quote: string) => ({ id, kind: "given" as const, statement: quote, evidence: { source: "question" as const, start: question.indexOf(quote), end: question.indexOf(quote) + quote.length, quote } });
const problem: ProblemIR = {
  schemaVersion: "problem-ir/v1", id: "dc", question,
  facts: [fact("model", "ideal DC"), fact("sourceConnection", "Source S connects A to B"), fact("resistorConnection", "Resistor R connects A to B"), fact("voltage", "12 V"), fact("resistance", "6 ohm"), fact("sourceLaw", "V(A)-V(B)=12 V"), fact("resistorLaw", "R=6 ohm")],
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
  ], representationIntents: [], solveRequests: [],
};
const network = {
  model: "ideal_dc" as const, modelFactId: "model", nodes: ["A", "B"], referenceNode: "B",
  branches: [
    { id: "S", kind: "voltage_source" as const, from: "A", to: "B", connectionConstraintId: "sourceLink", lawFactId: "sourceLaw", quantityExpressionId: "E", quantityFactId: "voltage", unit: "V" },
    { id: "R", kind: "resistor" as const, from: "A", to: "B", connectionConstraintId: "resistorLink", lawFactId: "resistorLaw", quantityExpressionId: "r", quantityFactId: "resistance", unit: "ohm" },
  ],
};
const result = solveDcNetwork(problem, network);
assert.equal(result.voltages.A.exact, "12");
assert.equal(result.currents.R.exact, "2");
assert.equal(result.currents.S.exact, "-2");
assert.equal(result.residual, 0);
console.log("DCP05 DC network first independent 12 V / 6 ohm oracle passed");


type Element = { id: string; kind: DcBranch["kind"]; from: string; to: string; amount?: string; unit?: string };
function fixture(nodes: string[], elements: Element[], referenceNode = nodes.at(-1)!) {
  const clauses = ["ideal DC", `Nodes ${nodes.join(" ")}`];
  for (const e of elements) {
    const q = `${e.amount} ${e.unit}`;
    clauses.push(`${e.id} connects ${e.from} to ${e.to}`);
    clauses.push(e.kind === "resistor" ? `${e.id}=${q}` : e.kind === "voltage_source" ? `V(${e.from})-V(${e.to})=${q}` : e.kind === "current_source" ? `I(${e.from}->${e.to})=${q}` : e.kind === "wire" ? `V(${e.from})-V(${e.to})=0 V` : `I(${e.from}->${e.to})=0 A`);
  }
  const q = clauses.join(". ");
  const f = (id: string, quote: string) => ({ id, kind: "given" as const, statement: quote, evidence: { source: "question" as const, start: q.indexOf(quote), end: q.indexOf(quote) + quote.length, quote } });
  const facts = [f("model", clauses[0]), f("nodes", clauses[1])];
  const entities: ProblemIR["entities"] = nodes.map((id) => ({ id, kind: "point", evidenceFactIds: ["nodes"] }));
  const expressions: ProblemIR["expressions"] = [];
  const constraints: ProblemIR["constraints"] = [];
  const branches: DcBranch[] = [];
  for (const [index, e] of elements.entries()) {
    const connectionId = `link${index}`;
    const lawFactId = `law${index}`;
    const quantityFactId = `value${index}`;
    const quantityExpressionId = `expr${index}`;
    facts.push(f(connectionId, clauses[2 + 2 * index]), f(lawFactId, clauses[3 + 2 * index]));
    const given = e.kind !== "wire" && e.kind !== "open";
    if (given) {
      facts.push(f(quantityFactId, `${e.amount} ${e.unit}`));
      const multiplier = e.unit === "kohm" || e.unit === "kΩ" ? 1000 : e.unit === "Mohm" || e.unit === "MΩ" ? 1000000 : e.unit === "mA" || e.unit === "mV" ? 0.001 : e.unit === "µA" ? 0.000001 : 1;
      expressions.push({ id: quantityExpressionId, valueType: "scalar", root: { kind: "number", value: Number(e.amount) * multiplier }, evidenceFactIds: [quantityFactId] });
    }
    entities.push({ id: e.id, kind: "component", evidenceFactIds: [connectionId, lawFactId, ...(given ? [quantityFactId] : [])] });
    constraints.push({ id: connectionId, kind: "connected", entityIds: [e.id, e.from, e.to], evidenceFactIds: [connectionId] });
    branches.push({ id: e.id, kind: e.kind, from: e.from, to: e.to, connectionConstraintId: connectionId, lawFactId, ...(given ? { quantityExpressionId, quantityFactId, unit: e.unit } : {}) });
  }
  const p: ProblemIR = { schemaVersion: "problem-ir/v1", id: "dcFixture", question: q, facts, entities, expressions, constraints, representationIntents: [], solveRequests: [] };
  const n: DcNetwork = { model: "ideal_dc", modelFactId: "model", nodes, referenceNode, branches };
  return { problem: p, network: n };
}
function expectError(p: ProblemIR, n: DcNetwork, code?: string) {
  assert.throws(() => solveDcNetwork(p, n), (error: unknown) => error instanceof DcNetworkError && (code === undefined || error.code === code));
}
const bridgeElements: Element[] = [
  { id: "S", kind: "voltage_source", from: "A", to: "D", amount: "12", unit: "V" },
  { id: "R1", kind: "resistor", from: "A", to: "B", amount: "2", unit: "ohm" },
  { id: "R2", kind: "resistor", from: "B", to: "D", amount: "4", unit: "ohm" },
  { id: "R3", kind: "resistor", from: "A", to: "C", amount: "3", unit: "ohm" },
  { id: "R4", kind: "resistor", from: "C", to: "D", amount: "3", unit: "ohm" },
  { id: "R5", kind: "resistor", from: "B", to: "C", amount: "6", unit: "ohm" },
];
const bridge = fixture(["A", "B", "C", "D"], bridgeElements);
const bridgeResult = solveDcNetwork(bridge.problem, bridge.network);
assert.equal(bridgeResult.voltages.B.exact, "408/53");
assert.equal(bridgeResult.voltages.C.exact, "336/53");
assert.equal(bridgeResult.currents.R5.exact, "12/53");
assert.equal(bridgeResult.currents.S.exact, "-214/53");
const permuted = structuredClone(bridge.network);
permuted.nodes.reverse(); permuted.branches.reverse();
assert.deepEqual(solveDcNetwork(bridge.problem, permuted), bridgeResult);
const groundedElsewhere = { ...bridge.network, referenceNode: "B" };
const shifted = solveDcNetwork(bridge.problem, groundedElsewhere);
assert.equal(shifted.currents.S.exact, bridgeResult.currents.S.exact);
assert.equal(shifted.voltages.A.exact, "228/53");

const balanced = fixture(["A", "B", "C", "D"], bridgeElements.map((e) => e.id === "R2" ? { ...e, amount: "2" } : e));
assert.equal(solveDcNetwork(balanced.problem, balanced.network).currents.R5.exact, "0");
const reversedBridge = fixture(["A", "B", "C", "D"], bridgeElements.map((e) => e.id === "R5" ? { ...e, from: "C", to: "B" } : e));
assert.equal(solveDcNetwork(reversedBridge.problem, reversedBridge.network).currents.R5.exact, "-12/53");
const negativeSource = fixture(["A", "B", "C", "D"], bridgeElements.map((e) => e.id === "S" ? { ...e, amount: "-12" } : e));
assert.equal(solveDcNetwork(negativeSource.problem, negativeSource.network).currents.R5.exact, "-12/53");

const driven = fixture(["A", "B"], [
  { id: "J", kind: "current_source", from: "A", to: "B", amount: "2", unit: "A" },
  { id: "R", kind: "resistor", from: "A", to: "B", amount: "6", unit: "ohm" },
]);
assert.equal(solveDcNetwork(driven.problem, driven.network).voltages.A.exact, "-12");
assert.equal(solveDcNetwork(driven.problem, driven.network).currents.R.exact, "-2");
const wired = fixture(["A", "B", "C"], [
  { id: "S", kind: "voltage_source", from: "A", to: "B", amount: "12", unit: "V" },
  { id: "W", kind: "wire", from: "A", to: "C" },
  { id: "R", kind: "resistor", from: "C", to: "B", amount: "6", unit: "ohm" },
  { id: "O", kind: "open", from: "A", to: "B" },
], "B");
const wiredResult = solveDcNetwork(wired.problem, wired.network);
assert.equal(wiredResult.voltages.C.exact, "12");
assert.equal(wiredResult.currents.W.exact, "2");
assert.equal(wiredResult.currents.O.exact, "0");
const prefixed = fixture(["A", "B"], [
  { id: "S", kind: "voltage_source", from: "A", to: "B", amount: "12000", unit: "mV" },
  { id: "R", kind: "resistor", from: "A", to: "B", amount: "0.006", unit: "kohm" },
]);
assert.equal(solveDcNetwork(prefixed.problem, prefixed.network).currents.R.exact, "2");

const parallelSources = (amount: string) => fixture(["A", "B"], [
  { id: "S1", kind: "voltage_source", from: "A", to: "B", amount: "12", unit: "V" },
  { id: "S2", kind: "voltage_source", from: "A", to: "B", amount, unit: "V" },
  { id: "R", kind: "resistor", from: "A", to: "B", amount: "6", unit: "ohm" },
]);
const conflicting = parallelSources("10");
expectError(conflicting.problem, conflicting.network, "incompatible_network");
const redundant = parallelSources("12");
expectError(redundant.problem, redundant.network, "underdetermined_network");
const floating = fixture(["A", "B", "C"], bridgeElements.slice(0, 1).map((e) => ({ ...e, to: "B" })));
expectError(floating.problem, floating.network, "underdetermined_network");
for (const value of ["0", "-6", "1e-24", "1e24"]) {
  const invalidResistance = fixture(["A", "B"], [
    { id: "S", kind: "voltage_source", from: "A", to: "B", amount: "12", unit: "V" },
    { id: "R", kind: "resistor", from: "A", to: "B", amount: value, unit: "ohm" },
  ]);
  expectError(invalidResistance.problem, invalidResistance.network);
}
for (const mutate of [
  (p: ProblemIR, _n: DcNetwork) => { p.expressions[0].root = { kind: "number", value: 99 }; },
  (p: ProblemIR, _n: DcNetwork) => { p.facts.find((f) => f.id === "value0")!.evidence.start += 1; },
  (p: ProblemIR, n: DcNetwork) => { n.branches[0].from = "B"; n.branches[0].to = "A"; },
  (p: ProblemIR, n: DcNetwork) => { n.branches[0].connectionConstraintId = "link1"; },
  (p: ProblemIR, n: DcNetwork) => { n.branches[0].quantityFactId = "value1"; },
  (p: ProblemIR, n: DcNetwork) => { n.modelFactId = "value0"; },
  (p: ProblemIR, n: DcNetwork) => { n.branches[0].unit = "v"; },
  (p: ProblemIR, n: DcNetwork) => { n.branches.push(n.branches[0]); },
  (p: ProblemIR, n: DcNetwork) => { n.referenceNode = "undeclared"; },
]) {
  const changed = structuredClone(bridge); mutate(changed.problem, changed.network);
  expectError(changed.problem, changed.network);
}

expectError(bridge.problem, Object.create(bridge.network), "invalid_network_input");
const pollutedChild = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
  import { strict as assert } from "node:assert";
  import { solveDcNetwork } from ${JSON.stringify(new URL("../../src/ir/circuitNetwork.ts", import.meta.url).href)};
  const data = ${JSON.stringify(bridge)};
  const saved = new Map(Reflect.ownKeys(data.network).map(key => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)]));
  try {
    for (const [key, value] of Object.entries(data.network)) Object.defineProperty(Object.prototype, key, { value, configurable: true });
    assert.throws(() => solveDcNetwork(data.problem, {}), /own source fields/);
  } finally {
    for (const [key, descriptor] of saved) descriptor ? Object.defineProperty(Object.prototype, key, descriptor) : delete Object.prototype[key];
  }
`], { encoding: "utf8" });
assert.equal(pollutedChild.status, 0, pollutedChild.stderr);

const sourceSeries = fixture(["A", "B", "C"], [
  { id: "S", kind: "voltage_source", from: "A", to: "B", amount: "12", unit: "V" },
  { id: "R", kind: "resistor", from: "A", to: "C", amount: "6", unit: "ohm" },
  { id: "T", kind: "resistor", from: "C", to: "B", amount: "6", unit: "ohm" },
], "B");
assert.equal(solveDcNetwork(sourceSeries.problem, sourceSeries.network).currents.R.exact, "1");
assert.equal(solveDcNetwork(sourceSeries.problem, sourceSeries.network).voltages.C.exact, "6");
const falseTopology = structuredClone(sourceSeries);
falseTopology.problem.question = falseTopology.problem.question.replace("R connects A to C", "R connects A to C, not B");
for (const f of falseTopology.problem.facts) {
  if (f.id === "link1") f.evidence.quote = "R connects A to C, not B";
  f.evidence.start = falseTopology.problem.question.indexOf(f.evidence.quote);
  f.evidence.end = f.evidence.start + f.evidence.quote.length;
}
falseTopology.network.branches[1].to = "B";
const falseConnection = falseTopology.problem.constraints.find((c) => c.id === "link1");
if (!falseConnection || falseConnection.kind !== "connected") throw new Error("Missing topology fixture");
falseConnection.entityIds = ["R", "A", "B"];
const correctPositiveQuote = structuredClone(falseTopology.problem);
correctPositiveQuote.constraints = structuredClone(sourceSeries.problem.constraints);
const positiveFact = correctPositiveQuote.facts.find((f) => f.id === "link1")!;
positiveFact.evidence.quote = "R connects A to C";
positiveFact.evidence.start = correctPositiveQuote.question.indexOf(positiveFact.evidence.quote);
positiveFact.evidence.end = positiveFact.evidence.start + positiveFact.evidence.quote.length;
assert.equal(solveDcNetwork(correctPositiveQuote, sourceSeries.network).currents.R.exact, "1");
assert.equal(solveDcNetwork(correctPositiveQuote, sourceSeries.network).voltages.C.exact, "6");
const positiveQuoteWrongRelation = structuredClone(correctPositiveQuote);
positiveQuoteWrongRelation.constraints = structuredClone(falseTopology.problem.constraints);
expectError(positiveQuoteWrongRelation, falseTopology.network, "source_topology_mismatch");
expectError(falseTopology.problem, falseTopology.network, "source_topology_mismatch");
const duplicateOwner = structuredClone(sourceSeries.problem);
duplicateOwner.entities.find((e) => e.id === "C")!.label = "B";
expectError(duplicateOwner, sourceSeries.network, "ambiguous_network_owner");
falseTopology.problem.solveRequests = [{ id: "falseCurrent", kind: "dc_network", network: falseTopology.network, output: { kind: "branch_current", id: "R" } }];
assert.equal(validateProblemIR(falseTopology.problem).valid, false);
const deniedTopology = await new LocalDeterministicSolverProvider().solve(falseTopology.problem);
assert.equal(deniedTopology.status, "failed");
assert.deepEqual(deniedTopology.values, []);

const requestProblem = structuredClone(bridge.problem);
requestProblem.solveRequests = [
  { id: "bridgeCurrent", kind: "dc_network", network: bridge.network, output: { kind: "branch_current", id: "R5" } },
  { id: "nodeVoltage", kind: "dc_network", network: bridge.network, output: { kind: "node_voltage", id: "C" } },
];
assert.equal(validateProblemIR(requestProblem).valid, true, JSON.stringify(validateProblemIR(requestProblem).issues));
const provider = new LocalDeterministicSolverProvider();
const solved = await provider.solve(requestProblem);
assert.equal(solved.status, "solved", JSON.stringify(solved.issues));
assert.equal(solved.values[0].exact && !Array.isArray(solved.values[0].exact) && solved.values[0].exact.value, "12/53");
assert.equal(validateSolverResult(solved, requestProblem).valid, true, JSON.stringify(validateSolverResult(solved, requestProblem).issues));
const stale = structuredClone(solved);
stale.values[0].approximate = 2; stale.values[0].exact = { kind: "integer", value: "2" };
assert.equal(validateSolverResult(stale, requestProblem).valid, false);
const wrongProof = structuredClone(solved);
wrongProof.proofs[0].method = "exact_arithmetic";
assert.equal(validateSolverResult(wrongProof, requestProblem).valid, false);
const noReference = structuredClone(requestProblem);
noReference.facts.push({ id: "potentialRequest", kind: "requested", statement: "Nodes", evidence: { source: "question", start: noReference.question.indexOf("Nodes"), end: noReference.question.indexOf("Nodes") + 5, quote: "Nodes" } });
if (noReference.solveRequests[1].kind !== "dc_network") throw new Error("Missing node request");
noReference.solveRequests[1].resultBinding = { turnPlanQuantityId: "potential", symbol: "VC", unit: "V", evidenceFactIds: ["potentialRequest"] };
assert.equal(validateProblemIR(noReference).valid, false);
const sourcedReference = structuredClone(noReference);
sourcedReference.question += ". V(D)=0 V";
const referenceStart = sourcedReference.question.indexOf("V(D)=0 V");
sourcedReference.facts.push({ id: "reference", kind: "given", statement: "V(D)=0 V", evidence: { source: "question", start: referenceStart, end: referenceStart + 8, quote: "V(D)=0 V" } });
if (sourcedReference.solveRequests[1].kind !== "dc_network") throw new Error("Missing node request");
sourcedReference.solveRequests[1].network = { ...sourcedReference.solveRequests[1].network, referenceFactId: "reference" };
assert.equal(validateProblemIR(sourcedReference).valid, true, JSON.stringify(validateProblemIR(sourcedReference).issues));

const invalidRequest = structuredClone(requestProblem);
invalidRequest.solveRequests[0] = { id: "bad", kind: "dc_network", network: conflicting.network, output: { kind: "branch_current", id: "S1" } };
Object.assign(invalidRequest, { question: conflicting.problem.question, facts: conflicting.problem.facts, entities: conflicting.problem.entities, expressions: conflicting.problem.expressions, constraints: conflicting.problem.constraints, solveRequests: [invalidRequest.solveRequests[0]] });
const rejected = await provider.solve(invalidRequest);
assert.equal(rejected.status, "failed");
assert.deepEqual(rejected.values, []);
assert.deepEqual(rejected.proofs, []);

const holdout = Array.from({ length: 40 }, (_, index) => ({
  voltage: (index % 2 === 0 ? 1 : -1) * (7 + index),
  r1: 2 + index % 7, r2: 3 + index % 11, r3: 5 + index % 13,
}));
for (const h of holdout) {
  const total = h.r1 + h.r2 + h.r3;
  const serial = fixture(["A", "B", "C", "D"], [
    { id: "S", kind: "voltage_source", from: "A", to: "D", amount: String(h.voltage), unit: "V" },
    { id: "R1", kind: "resistor", from: "A", to: "B", amount: String(h.r1), unit: "ohm" },
    { id: "R2", kind: "resistor", from: "B", to: "C", amount: String(h.r2), unit: "ohm" },
    { id: "R3", kind: "resistor", from: "C", to: "D", amount: String(h.r3), unit: "ohm" },
  ]);
  const out = solveDcNetwork(serial.problem, serial.network);
  assert.ok(Math.abs(out.currents.R1.approximate - h.voltage / total) < 1e-14);
  assert.deepEqual(out.currents.R1, out.currents.R2);
  assert.deepEqual(out.currents.R2, out.currents.R3);
  assert.ok(Math.abs(out.voltages.B.approximate - h.voltage * (h.r2 + h.r3) / total) < 1e-13);
  assert.ok(Math.abs(out.voltages.C.approximate - h.voltage * h.r3 / total) < 1e-13);
}
console.log(JSON.stringify({ gate: "DCP05-source-grounded-DC", independentOracles: ["unbalanced/zero bridge", "signed source", "current source", "wire/open", "SI prefixes", "reference/permutation"], sourceMutations: 9, syntheticHoldoutCases: holdout.length, atomicInvalidValues: rejected.values.length, liveSceneCoverage: "not_claimed" }));
