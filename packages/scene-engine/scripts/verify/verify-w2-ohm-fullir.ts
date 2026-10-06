import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyStatedCircuitAuthority, readCircuitLiterals, readCircuitUnit } from "../../src/ir/statedCircuitAuthority";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import { bindStatedCircuitProblem, checkStatedCircuitProblemBinding } from "../../src/ir/statedCircuitProblemBinding";
import { checkVisualObligations, deriveVisualObligations } from "../../src/synthesize/visualObligations";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateProblemIR, type ProblemIR } from "../../src/ir/problemIR";
import { attemptArchetypeScene } from "../../src/archetypes";
import type { SceneDocument } from "../../src/types";

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/w2-ohm/${name}.json`, import.meta.url), "utf8"));
let checks = 0;
function check(name: string, run: () => void) { run(); checks++; console.log(`ok ${name}`); }
const treePlan = fixture<TurnPlanV3>("w1-ohm-tree-captured-planning-plan");
const authority = applyStatedCircuitAuthority(treePlan.question, treePlan)!;
assert.equal(authority.plan.derived.find(row => row.id === "Rs")?.value, 6, "actual source-computable series intermediate survives");
for (const row of authority.plan.derived) {
  assert.ok(row.dependsOn?.every(id => [...authority.plan.givens, ...authority.plan.derived].some(other => other.id === id)) ?? true, `no dangling dependency from ${row.id}`);
}
const actual = new Map<string, ProblemIR>();
for (const name of ["meters", "tree"]) {
  const problem = fixture<ProblemIR>(`w1-ohm-${name}-normalized-problem-ir`);
  actual.set(name, problem);
  const original = structuredClone(problem);
  assert.equal(validateProblemIR(problem, problem.question).valid, true);
  // Source compile success by itself is deliberately not a full-IR pass.
  const stock = attemptArchetypeScene({ question: problem.question, turnPlan: null }).scene!.document;
  assert.equal(checkVisualObligations(deriveVisualObligations(problem), stock).satisfied, false);
  const binding = bindStatedCircuitProblem(problem.question, problem);
  assert.ok(binding, `${name}: full original IR binds`);
  const obligations = checkVisualObligations(deriveVisualObligations(problem), binding.document, problem);
  assert.equal(obligations.satisfied, true, JSON.stringify(obligations));
  const compiled = compileSceneDocument(binding.document);
  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  assert.deepEqual(checkStatedCircuitProblemBinding(problem.question, problem, binding.document), []);
  assert.deepEqual(problem, original, "the actual full IR is not rewritten");
  assert.equal(binding.problem, problem);
  assert.equal(binding.factBindings.length, problem.facts.length);
  assert.equal(binding.expressionBindings.length, problem.expressions.length);
  assert.equal(binding.entityBindings.length, problem.entities.length);
  checks++;
  console.log(`ok actual ${name} full-IR obligations and source binding`);
}

// Three authored, complete IRs supplement the two untouched student captures.
// These expected numbers are elementary independent Ohm/Kirchhoff oracles.
function core(question: string, ohms: number[], voltage: number, kind: "series" | "parallel"): ProblemIR {
  const problem: ProblemIR = { schemaVersion: "problem-ir/v1", id: "coreCircuit", question,
    facts: [], entities: [], expressions: [], constraints: [], representationIntents: [], solveRequests: [] };
  ohms.forEach((value, index) => {
    const quote = `${value} ohm resistor`;
    problem.facts.push({ id: `fR${index}`, kind: "given", statement: `The resistor has resistance ${value} ohm.`,
      evidence: { source: "question", start: question.indexOf(quote), end: question.indexOf(quote) + quote.length, quote } });
    problem.entities.push({ id: `eR${index}`, kind: "component", label: quote, evidenceFactIds: [`fR${index}`] });
    problem.expressions.push({ id: `exprR${index}`, valueType: "scalar", root: { kind: "number", value }, evidenceFactIds: [`fR${index}`] });
  });
  const quote = `${voltage} V cell`;
  problem.facts.push({ id: "fV", kind: "given", statement: `The cell provides ${voltage} V.`,
    evidence: { source: "question", start: question.indexOf(quote), end: question.indexOf(quote) + quote.length, quote } });
  problem.entities.push({ id: "eCell", kind: "component", label: quote, evidenceFactIds: ["fV"] });
  problem.expressions.push({ id: "exprV", valueType: "scalar", root: { kind: "number", value: voltage }, evidenceFactIds: ["fV"] });
  if (ohms.length > 1) {
    const topology = `connected in ${kind}`;
    problem.facts.push({ id: "fTopology", kind: "given", statement: `The resistors are ${topology}.`,
      evidence: { source: "question", start: question.indexOf(topology), end: question.indexOf(topology) + topology.length, quote: topology } });
    problem.constraints.push({ id: "cConnected", kind: "connected", entityIds: ohms.map((_, index) => `eR${index}`), evidenceFactIds: ["fTopology"] });
  }
  const ask = question.slice(question.indexOf("Find"));
  problem.facts.push({ id: "fAsk", kind: "requested", statement: ask, evidence: { source: "question", start: question.indexOf("Find"), end: question.length, quote: ask } });
  problem.representationIntents.push({ id: "riCircuit", kind: "network", entityIds: problem.entities.map(row => row.id), evidenceFactIds: problem.facts.filter(row => row.kind === "given").map(row => row.id) });
  return problem;
}

const cases = [
  { id: "single", problem: core("A 15 ohm resistor is connected across a 9 V cell. Find the current.", [15], 9, "series"), resistances: [15], equivalent: 15, total: .6, currents: [.6], drops: [9], topology: "series" },
  { id: "series", problem: core("A 7 ohm resistor and a 5 ohm resistor are connected in series across a 24 V cell. Find the total current.", [7, 5], 24, "series"), resistances: [7, 5], equivalent: 12, total: 2, currents: [2, 2], drops: [14, 10], topology: "series" },
  { id: "parallel", problem: core("A 4 ohm resistor and a 12 ohm resistor are connected in parallel across a 6 V cell. Find the total current.", [4, 12], 6, "parallel"), resistances: [4, 12], equivalent: 3, total: 2, currents: [1.5, .5], drops: [6, 6], topology: "parallel" },
  { id: "meters", problem: actual.get("meters")!, resistances: [10], equivalent: 10, total: .5, currents: [.5], drops: [5], topology: "series" },
  { id: "mixed", problem: actual.get("tree")!, resistances: [2, 4, 3], equivalent: 2, total: 3, currents: [1, 1, 2], drops: [2, 4, 6], topology: "tree" },
];
function terminals(document: SceneDocument): Map<string, [string, string]> {
  const parent = new Map<string, string>();
  const root = (id: string): string => parent.has(id) ? root(parent.get(id)!) : id;
  for (const wire of document.constructions.filter(row => row.operator === "connect")) {
    const a = root(String(wire.inputs.start)), b = root(String(wire.inputs.end));
    if (a !== b) parent.set(a, b);
  }
  return new Map(document.constructions.filter(row => row.operator === "symbol").map(row => [row.outputs[0]!, [root(String(row.inputs.start)), root(String(row.inputs.end))]]));
}
for (const item of cases) check(`${item.id}: independent values, electrical topology and full obligations`, () => {
  const binding = bindStatedCircuitProblem(item.problem.question, item.problem);
  assert.ok(binding);
  const solution = binding.solution;
  assert.equal(solution.equivalentResistance.value, item.equivalent);
  assert.equal(solution.sourceCurrent?.value, item.total);
  assert.deepEqual(solution.resistors.map(row => row.resistance.value), item.resistances);
  assert.deepEqual(solution.resistors.map(row => row.current?.value), item.currents);
  assert.deepEqual(solution.resistors.map(row => row.voltage?.value), item.drops);
  assert.equal(solution.topology, item.topology);
  const pairs = terminals(binding.document);
  if (item.id === "series") assert.equal(pairs.get("R1")![1], pairs.get("R2")![0], "actual series joint");
  if (item.id === "parallel") assert.deepEqual(pairs.get("R1"), pairs.get("R2"), "same electrical terminals");
  if (item.id === "mixed") {
    assert.equal(pairs.get("R1")![1], pairs.get("R2")![0]);
    assert.equal(pairs.get("R1")![0], pairs.get("R3")![0]);
    assert.equal(pairs.get("R2")![1], pairs.get("R3")![1]);
    assert.deepEqual(solution.groups.map(row => [row.kind, row.resistorIds, row.resistance.exact]), [
      ["series", ["R1", "R2"], "6"], ["parallel", ["R1", "R2", "R3"], "2"],
    ]);
  }
  if (item.id === "meters") {
    assert.deepEqual(pairs.get("voltmeter"), pairs.get("R1"));
    assert.notDeepEqual(pairs.get("ammeter"), pairs.get("R1"));
    assert.equal(solution.ammeter?.exact, "1/2");
    assert.equal(solution.voltmeter?.exact, "5");
  }
  assert.equal(checkVisualObligations(deriveVisualObligations(item.problem), binding.document, item.problem).satisfied, true);
  const compiled = compileSceneDocument(binding.document);
  assert.ok(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
  for (const entity of binding.entityBindings) assert.ok(compiled.renderScene.primitives.some(primitive => primitive.entityId === entity.sceneEntityId), `visible ${entity.problemEntityId}`);
});

const meters = actual.get("meters")!;
const mixed = actual.get("tree")!;
function rejectIR(name: string, base: ProblemIR, edit: (problem: ProblemIR) => void) {
  check(name, () => { const copy = structuredClone(base); edit(copy); assert.equal(bindStatedCircuitProblem(copy.question, copy), null); });
}
rejectIR("wrong body name", meters, p => { p.entities[0]!.label = "resistor Z"; });
rejectIR("wrong physical role", meters, p => { p.entities[1]!.label = "resistor"; });
rejectIR("a source cell must not acquire an unmentioned body name", meters, p => { p.entities[1]!.label = "battery"; });
rejectIR("wrong meter fact topology", meters, p => { p.facts.find(row => row.id === "fIdealAmmeter")!.statement = "The ammeter is connected in parallel."; });
rejectIR("source dimension value is not another value of same class", meters, p => { p.expressions[0]!.root = { kind: "number", value: 5 }; });
rejectIR("wrong source unit in a fact", meters, p => { p.facts[0]!.statement = "The resistor has resistance 10 kohm."; });
rejectIR("swapped source quantity role", meters, p => { p.facts[1]!.statement = "The resistor provides 5 V."; });
rejectIR("unsupported extra component", meters, p => { p.entities.push({ id: "extra", kind: "component", label: "capacitor", evidenceFactIds: ["fR"] }); });
rejectIR("no physical resistor replaced by a text label", meters, p => { p.entities[0]!.kind = "other"; });
rejectIR("omitted meter entity", meters, p => { p.entities = p.entities.filter(row => row.id !== "ammeter"); p.representationIntents[0]!.entityIds = p.entities.map(row => row.id); });
rejectIR("missing requested current", meters, p => { p.facts = p.facts.filter(row => row.kind !== "requested"); });
rejectIR("unsupported full-IR constraint", meters, p => { p.constraints.push({ id: "perpendicular", kind: "perpendicular", entityIds: ["resistor", "cell"], evidenceFactIds: ["fR"] }); });
rejectIR("wrong tree grouping fact", mixed, p => { p.facts.find(row => row.id === "fSeries")!.statement = "The 2 ohm and 4 ohm resistors are connected in parallel."; });
rejectIR("wrong group member identity", mixed, p => { p.entities.find(row => row.id === "eSeriesComb")!.label = "series combination of R1 and R3"; });
rejectIR("false derived expression", mixed, p => { p.expressions.find(row => row.id === "exprReq")!.root = { kind: "number", value: 3 }; });
rejectIR("same final scalar is not equivalent-resistance authority", mixed, p => { p.expressions.find(row => row.id === "exprReq")!.root = { kind: "number", value: 2 }; });
rejectIR("wrong source formula with coincidentally correct scalar", mixed, p => {
  p.expressions.find(row => row.id === "exprReq")!.root = { kind: "binary", operator: "/", left: {
    kind: "binary", operator: "+", left: { kind: "number", value: 2 }, right: { kind: "number", value: 4 },
  }, right: { kind: "number", value: 3 } }; // (2+4)/3 = 2 but is not P(S(2,4),3).
});
rejectIR("unbound result role", mixed, p => { p.solveRequests[0]!.resultBinding!.symbol = "mystery"; });
rejectIR("wrong request unit", mixed, p => { p.solveRequests[0]!.resultBinding!.unit = "V"; });
rejectIR("unsupported extra expression", meters, p => { p.expressions.push({ id: "extraExpression", root: { kind: "number", value: 77 }, valueType: "scalar", evidenceFactIds: ["fR"] }); });
rejectIR("foreign evidence quote", meters, p => { p.facts[0]!.evidence.quote = "77 ohm resistor"; });
rejectIR("foreign whole source", meters, p => { p.question = p.question.replace("10 ohm", "12 ohm"); });
rejectIR("whole source cannot omit an extra numeric dimension", meters, p => { p.question = p.question.replace("Find", "The wire is 2 m long. Find"); });
rejectIR("whole source cannot omit an extra requested result", meters, p => { p.question = p.question.replace("Find the current.", "Find the current and the power."); });
rejectIR("full-IR fact cannot invent an unsupported assumption", meters, p => { p.facts.push({ ...p.facts[0]!, id: "extraFact", kind: "assumption", statement: "The resistor is superconducting." }); });
rejectIR("ideal-meter fact cannot append an unsupported assertion", meters, p => { p.facts.find(row => row.id === "fIdealAmmeter")!.statement += " The cell is shorted."; });
rejectIR("source ammeter parallel topology is not silently made series", meters, p => {
  p.question = p.question.replace("ammeter in series", "ammeter in parallel");
  p.facts.find(row => row.id === "fIdealAmmeter")!.evidence.quote = "with an ammeter in parallel";
});
rejectIR("source voltmeter cannot be moved across the ammeter", meters, p => {
  p.question = p.question.replace("voltmeter across the resistor", "voltmeter across the ammeter");
  p.facts.find(row => row.id === "fIdealVoltmeter")!.evidence.quote = "and a voltmeter across the ammeter";
});

const boundMeters = bindStatedCircuitProblem(meters.question, meters)!.document;
function rejectCandidate(name: string, edit: (document: SceneDocument) => void) {
  check(name, () => { const copy = structuredClone(boundMeters); edit(copy); assert.ok(checkStatedCircuitProblemBinding(meters.question, meters, copy).some(issue => issue.severity === "fatal")); });
}
rejectCandidate("forged scene component name", d => { d.entities.find(row => row.id === "R1")!.label = "R_unknown"; });
rejectCandidate("forged scene meter topology", d => { const meter = d.constructions.find(row => row.outputs[0] === "ammeter")!; meter.inputs.start = "n0"; meter.inputs.end = "n1"; });
rejectCandidate("forged scene voltage unit", d => { d.quantities.find(row => row.id === "circuit_source_battery")!.unit = "mV"; });
rejectCandidate("forged scene source voltage", d => { d.quantities.find(row => row.id === "circuit_source_battery")!.value = 10; });
rejectCandidate("numeric annotation must not lie", d => { d.annotations.find(row => row.id === "circuit_dimension_R1")!.text = "5 Ω"; });
rejectCandidate("required body cannot be omitted", d => { d.requiredEntityIds = d.requiredEntityIds.filter(id => id !== "voltmeter"); });
rejectCandidate("meter cannot disappear from reveal", d => { for (const group of d.revealGroups) group.entityIds = group.entityIds.filter(id => id !== "voltmeter"); });
check("source markers and provenance confer no permission", () => {
  const copy = structuredClone(boundMeters); copy.source = {};
  for (const entity of copy.entities) delete entity.provenance;
  assert.deepEqual(checkStatedCircuitProblemBinding(meters.question, meters, copy), []);
  copy.entities.find(row => row.id === "battery")!.label = "99 V cell";
  assert.ok(checkStatedCircuitProblemBinding(meters.question, meters, copy).length);
});
check("JSONB object-key reorder survives independent regeneration", () => {
  const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder)
    : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
  assert.deepEqual(checkStatedCircuitProblemBinding(meters.question, reorder(meters), reorder(boundMeters) as SceneDocument), []);
});
check("source SI prefix case and numeric grammar", () => {
  assert.equal(readCircuitUnit("mΩ")?.[1], .001);
  assert.equal(readCircuitUnit("MΩ")?.[1], 1e6);
  assert.equal(readCircuitUnit("MA"), null);
  assert.deepEqual(readCircuitLiterals("1/2 ohm and 250 mV").map(row => row.si), [.5, .25]);
});
check("strict authority preserves valid source dependency chain", () => {
  const result = applyStatedCircuitAuthority(treePlan.question, treePlan, { requireBoundClaims: true })!;
  assert.deepEqual(result.plan.derived.slice(0, 3).map(row => [row.id, row.value, row.dependsOn]), [
    ["Req", 2, ["Rs", "R3"]], ["Itot", 3, ["V", "Req"]], ["Rs", 6, ["R1", "R2"]],
  ]);
  assert.deepEqual(result.plan.qualitativeClaims, treePlan.qualitativeClaims);
});
check("strict intermediate authority recomputes rather than trusting claimed value", () => {
  const plan = structuredClone(treePlan); plan.derived.find(row => row.id === "Rs")!.value = 9;
  assert.equal(applyStatedCircuitAuthority(plan.question, plan, { requireBoundClaims: true })!.plan.derived.find(row => row.id === "Rs")!.value, 6);
});
check("strict role binding never treats a leaf value as an equivalent-resistance result", () => {
  const result = applyStatedCircuitAuthority(treePlan.question, { ...treePlan, derived: [], unknowns: [] }, { requireBoundClaims: true })!;
  assert.equal(result.plan.derived.find(row => row.symbol === "R_eq")?.value, 2);
});
check("strict meter aliases reject an unbound suffix", () => {
  const plan = fixture<TurnPlanV3>("w1-ohm-meters-captured-plan");
  plan.derived.push({ id: "fakeMeter", symbol: "ammeter_unknown", value: .5, unit: "A", provenance: "derived" });
  assert.ok(!applyStatedCircuitAuthority(plan.question, plan, { requireBoundClaims: true })!.plan.derived.some(row => row.id === "fakeMeter"));
});
for (const mode of ["wrong_deps", "wrong_kind", "dangling", "cycle", "unbound", "duplicate"]) check(`authority rejects ${mode} and removes downstream references`, () => {
  const plan = structuredClone(treePlan);
  const subtotal = plan.derived.find(row => row.id === "Rs")!;
  if (mode === "wrong_deps") subtotal.dependsOn = ["R1", "R3"];
  if (mode === "wrong_kind") subtotal.symbol = "R_parallel";
  if (mode === "dangling") subtotal.dependsOn = ["R1", "missing"];
  if (mode === "cycle") subtotal.dependsOn = ["Req"];
  if (mode === "unbound") { subtotal.symbol = "ghost"; delete subtotal.dependsOn; subtotal.value = 2; }
  if (mode === "duplicate") plan.derived.push({ ...subtotal, value: 2 });
  const result = applyStatedCircuitAuthority(plan.question, plan, { requireBoundClaims: true })!;
  for (const id of ["Rs", "Req", "Itot"]) assert.ok(!result.plan.derived.some(row => row.id === id), `${mode}: no ${id}`);
  assert.ok(result.plan.qualitativeClaims.every(claim => !claim.relatedQuantityIds?.includes("Rs")));
});
check("strict total-resistance claim requires the whole source subtree", () => {
  const plan = structuredClone(treePlan);
  plan.derived.find(row => row.id === "Req")!.dependsOn = ["R1", "R2"];
  const result = applyStatedCircuitAuthority(plan.question, plan, { requireBoundClaims: true })!;
  assert.ok(!result.plan.derived.some(row => row.id === "Req" || row.id === "Itot"));
});
check("numberless concept baseline does not acquire numeric authority", () => {
  const question = "Two resistors are connected in series to a cell. Draw a circuit diagram.";
  const scene = attemptArchetypeScene({ question, turnPlan: null }).scene;
  assert.ok(scene);
  assert.equal(scene.document.quantities.length, 0);
  assert.ok(!scene.document.entities.some(row => row.label?.includes("Ω") || /\d+ V/.test(row.label ?? "")));
  assert.equal(applyStatedCircuitAuthority(question, { ...treePlan, question }), null);
});
for (const question of [
  "A cell of emf 6 V and internal resistance 1 ohm is connected to a 3 ohm resistor. Find the current.",
  "A 2 ohm resistor in series with a 4 ohm resistor in parallel with a 3 ohm resistor across a 6 V cell. Find the total current.",
  "Draw a labelled diagram for series and parallel combinations of resistors.",
]) check(`declared gap: ${question}`, () => {
  assert.equal(bindStatedCircuitProblem(question, { ...meters, question }), null);
});
console.log(`Wave2 Ohm full-IR: ${checks} checks passed (offline only; no student/lifecycle claim).`);
