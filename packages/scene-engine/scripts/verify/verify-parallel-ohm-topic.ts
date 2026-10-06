import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { solveDcNetwork, DcNetworkError, type DcBranch, type DcNetwork } from "../../src/ir/circuitNetwork";
import { validateProblemIR, type ProblemIR } from "../../src/ir/problemIR";
import { LocalDeterministicSolverProvider } from "../../src/ir/solver";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import { SCENE_DOCUMENT_VERSION, type SceneDocument } from "../../src/types";
import { renderSceneSvg } from "../lib/renderSceneSvg";

const out = resolve(process.argv[2] ?? "/Users/kaizen/.capy/work/HEY83-parallel-topics/ohms-law-and-resistance");
mkdirSync(out, { recursive: true });
type Element = { id: string; kind: DcBranch["kind"]; from: string; to: string; amount?: string; unit?: string };
function fixture(elements: Element[]) {
  const clauses = ["ideal DC", "Nodes A B"];
  for (const e of elements) {
    clauses.push(`${e.id} connects ${e.from} to ${e.to}`);
    clauses.push(e.kind === "resistor" ? `${e.id}=${e.amount} ${e.unit}`
      : e.kind === "voltage_source" ? `V(${e.from})-V(${e.to})=${e.amount} ${e.unit}`
      : e.kind === "current_source" ? `I(${e.from}->${e.to})=${e.amount} ${e.unit}`
      : e.kind === "wire" ? `V(${e.from})-V(${e.to})=0 V` : `I(${e.from}->${e.to})=0 A`);
  }
  const question = clauses.join(". ");
  const fact = (id: string, quote: string) => ({ id, kind: "given" as const, statement: quote,
    evidence: { source: "question" as const, start: question.indexOf(quote), end: question.indexOf(quote) + quote.length, quote } });
  const facts = [fact("model", "ideal DC"), fact("nodes", "Nodes A B")];
  const entities: ProblemIR["entities"] = ["A", "B"].map((id) => ({ id, kind: "point", evidenceFactIds: ["nodes"] }));
  const expressions: ProblemIR["expressions"] = [];
  const constraints: ProblemIR["constraints"] = [];
  const branches: DcBranch[] = [];
  for (const [i, e] of elements.entries()) {
    const given = e.kind !== "wire" && e.kind !== "open";
    facts.push(fact(`link${i}`, clauses[2 + 2 * i]), fact(`law${i}`, clauses[3 + 2 * i]));
    if (given) {
      facts.push(fact(`value${i}`, `${e.amount} ${e.unit}`));
      const scale = e.unit === "kΩ" ? 1000 : e.unit === "mV" || e.unit === "mA" ? 0.001 : 1;
      expressions.push({ id: `expr${i}`, valueType: "scalar", root: { kind: "number", value: Number(e.amount) * scale }, evidenceFactIds: [`value${i}`] });
    }
    entities.push({ id: e.id, kind: "component", evidenceFactIds: [`link${i}`, `law${i}`, ...(given ? [`value${i}`] : [])] });
    constraints.push({ id: `link${i}`, kind: "connected", entityIds: [e.id, e.from, e.to], evidenceFactIds: [`link${i}`] });
    branches.push({ id: e.id, kind: e.kind, from: e.from, to: e.to, connectionConstraintId: `link${i}`, lawFactId: `law${i}`,
      ...(given ? { quantityExpressionId: `expr${i}`, quantityFactId: `value${i}`, unit: e.unit } : {}) });
  }
  const problem: ProblemIR = { schemaVersion: "problem-ir/v1", id: "ohmContract", question, facts, entities, expressions, constraints,
    representationIntents: [{ id: "view", kind: "network", entityIds: entities.map((e) => e.id), evidenceFactIds: ["nodes"] }], solveRequests: [] };
  const network: DcNetwork = { model: "ideal_dc", modelFactId: "model", nodes: ["A", "B"], referenceNode: "B", branches };
  return { problem, network };
}
const source = (amount: string, kind: "voltage_source" | "current_source" = "voltage_source", unit = kind === "voltage_source" ? "V" : "A"): Element => ({ id: "S", kind, from: "A", to: "B", amount, unit });
const load = (amount: string, from = "A", to = "B", unit = "ohm"): Element => ({ id: "R", kind: "resistor", from, to, amount, unit });
const cases = [
  { id: "finite", elements: [source("12"), load("6")], voltage: "12", current: "2" },
  { id: "negative-polarity", elements: [source("-9"), load("3")], voltage: "-9", current: "-3" },
  { id: "reversed-reference", elements: [source("12"), load("6", "B", "A")], voltage: "12", current: "-2" },
  { id: "prefix", elements: [source("12000", "voltage_source", "mV"), load("0.006", "A", "B", "kΩ")], voltage: "12", current: "2" },
  { id: "zero-voltage-finite", elements: [source("0"), load("6")], voltage: "0", current: "0" },
  { id: "ideal-open", elements: [source("12"), { id: "R", kind: "open", from: "A", to: "B" } satisfies Element], voltage: "12", current: "0" },
  { id: "ideal-short-current-drive", elements: [source("2", "current_source"), { id: "R", kind: "wire", from: "A", to: "B" } satisfies Element], voltage: "0", current: "-2" },
  { id: "holdout-current-drive", elements: [source("-3", "current_source"), load("7")], voltage: "21", current: "3" },
  { id: "holdout-rational", elements: [source("7"), load("3")], voltage: "7", current: "7/3" },
];
const rejected = [
  { id: "short-nonzero-voltage", elements: [source("12"), { id: "R", kind: "wire", from: "A", to: "B" } satisfies Element], code: "incompatible_network" },
  { id: "short-zero-voltage", elements: [source("0"), { id: "R", kind: "wire", from: "A", to: "B" } satisfies Element], code: "underdetermined_network" },
  { id: "open-nonzero-current", elements: [source("2", "current_source"), { id: "R", kind: "open", from: "A", to: "B" } satisfies Element], code: "incompatible_network" },
  { id: "literal-zero-resistor", elements: [source("12"), load("0")], code: "invalid_network_resistance" },
  { id: "literal-infinite-resistor", elements: [source("12"), load("Infinity")], code: "unsupported_source_context" },
];
writeFileSync(resolve(out, "frozen-checklist.json"), JSON.stringify({ schema: "ohm-contract-audit/v1", scope: "physics|12|ohms-law-and-resistance", sourceClass: "authored complete contract declarations, not exam bank", cases, rejected,
  oracle: "Finite: oriented V(A)-V(B)=IR; current-source I(A->B) has passive load current -I. Wire imposes V=0, open imposes I=0. Conflicting ideal laws are incompatible; redundant voltage constraints do not fix individual current." }, null, 2));
const evidence: unknown[] = [];
for (const c of cases) {
  const { problem, network } = fixture(c.elements);
  const solution = solveDcNetwork(problem, network);
  assert.equal(solution.voltages.A.exact, c.voltage, c.id);
  assert.equal(solution.currents.R.exact, c.current, c.id);
  assert.equal(solution.residual, 0);
  problem.solveRequests = [{ id: "current", kind: "dc_network", network, output: { kind: "branch_current", id: "R" } }];
  assert.equal(validateProblemIR(problem).valid, true, c.id);
  const solved = await new LocalDeterministicSolverProvider().solve(problem);
  assert.equal(solved.status, "solved", JSON.stringify(solved));
  assert.deepEqual(solved.values[0].exact, { kind: c.current.includes("/") ? "rational" : "integer", value: c.current });
  writeFileSync(resolve(out, `${c.id}.source.json`), JSON.stringify({ problem, network, solution, solved }, null, 2));
  const exact = synthesizeFamilyScene({ question: problem.question, families: ["circuit_network"], problemIR: problem });
  const schematic = synthesizeLastResortScene({ question: problem.question, families: ["circuit_network"], problemIR: problem });
  const unstructured = synthesizeLastResortScene({ question: problem.question, families: ["circuit_network"] });
  for (const scene of [exact, schematic]) {
    assert.ok(scene, `${c.id}: grounded DC scene must compile`);
    assert.equal(scene.tier, "question_representation");
    assert.equal(scene.nonMetric, true);
    assert.equal(scene.document.source.groundedSchematic, "two-terminal-dc/v1");
    assert.equal(scene.document.source.question, problem.question);
    assert.deepEqual(scene.document.source.network, network);
    assert.deepEqual(scene.document.entities.filter((entity) => entity.kind !== "label").map((entity) => entity.id).sort(), problem.entities.map((entity) => entity.id).sort());
    assert.deepEqual(scene.document.constructions.filter((construction) => construction.operator === "point").flatMap((construction) => construction.outputs).sort(), network.nodes.slice().sort());
    const symbols = scene.document.constructions.filter((construction) => construction.operator === "symbol");
    assert.deepEqual(symbols.flatMap((construction) => construction.outputs).sort(), network.branches.map((branch) => branch.id).sort());
    for (const branch of network.branches) {
      const symbol = symbols.find((construction) => construction.outputs[0] === branch.id)!;
      const reverse = branch.kind === "voltage_source" && solution.voltages[branch.from].approximate < solution.voltages[branch.to].approximate;
      assert.equal(symbol.inputs.start, reverse ? branch.to : branch.from);
      assert.equal(symbol.inputs.end, reverse ? branch.from : branch.to);
      assert.equal(symbol.inputs.symbol, branch.kind === "voltage_source" ? "battery" : branch.kind === "current_source" ? "dc_current_source" : branch.kind);
    }
    const loadLabels = scene.document.entities.filter((entity) => entity.kind === "label" && entity.provenance?.problemEntityId === "R").map((entity) => entity.label);
    const orientedLoad = network.branches.find((branch) => branch.id === "R")!;
    assert.ok(loadLabels.includes(`I(${orientedLoad.from}→${orientedLoad.to})=${c.current} A`));
    const expectedDrop = orientedLoad.from === "A" || c.voltage === "0" ? c.voltage : c.voltage.startsWith("-") ? c.voltage.slice(1) : `-${c.voltage}`;
    assert.ok(loadLabels.includes(`V(${orientedLoad.from})-V(${orientedLoad.to})=${expectedDrop} V`));
    assert.equal(scene.document.revealGroups.length, 3);
    assert.deepEqual(scene.document.revealGroups.flatMap((group) => group.entityIds).sort(), scene.document.requiredEntityIds.slice().sort());
    assert.ok(scene.document.entities.filter((entity) => entity.kind === "label").every((entity) => scene.renderScene.primitives.some((primitive) => primitive.kind === "label" && primitive.text === entity.label)));
    const terminalPoints = network.nodes.map((id) => scene.renderScene.primitives.find((primitive) => primitive.entityId === id && primitive.kind === "point")!.points[0]);
    const left = Math.min(...terminalPoints.map((point) => point.x));
    const right = Math.max(...terminalPoints.map((point) => point.x));
    const bodyHeight = (id: string) => {
      const points = scene.renderScene.primitives.filter((primitive) => primitive.entityId === id && primitive.kind !== "label" && !primitive.provenance?.annotation)
        .flatMap((primitive) => [...primitive.points, ...primitive.points.slice(1).map((point, index) => ({ x: (point.x + primitive.points[index].x) / 2, y: (point.y + primitive.points[index].y) / 2 }))])
        .filter((point) => point.x > left + (right - left) * 0.3 && point.x < left + (right - left) * 0.7);
      assert.ok(points.length > 0, `${c.id}: ${id} body must have ink`);
      return points.reduce((sum, point) => sum + point.y, 0) / points.length;
    };
    assert.ok(Math.abs(bodyHeight("R") - bodyHeight("S")) > 1, `${c.id}: declared parallel component bodies must not overlap after reversing reference terminals`);
  }
  for (const [path, scene] of [["structured", schematic ?? exact], ["unstructured", unstructured]] as const) {
    const rendered = scene?.renderScene ?? { engineVersion: "ohm-audit-null/v1", primitives: [], revealGroups: [], timeline: [], entityBounds: {} };
    writeFileSync(resolve(out, `${c.id}.${path}.svg`), renderSceneSvg(rendered, { title: c.id,
      subtitle: scene ? `${path}: ${scene.tier}; ${path === "structured" ? "grounded DC/v1; offline only, not live/student acceptance" : "legacy diagnostic only, not source-consistency credit"}` : `${path}: candidate is null; no partial ink; required visual remains unsupported` }));
    writeFileSync(resolve(out, `${c.id}.${path}.json`), JSON.stringify(scene, null, 2));
  }
  evidence.push({ id: c.id, numeric: "pass", exact: exact?.tier ?? null, structured: schematic?.tier ?? null,
    unstructured: unstructured ? { tier: unstructured.tier, entities: unstructured.document.entities } : null });
}
for (const c of rejected) {
  const f = fixture(c.elements);
  assert.throws(() => solveDcNetwork(f.problem, f.network), (e: unknown) => e instanceof DcNetworkError && e.code === c.code, c.id);
  f.problem.solveRequests = [{ id: "current", kind: "dc_network", network: f.network, output: { kind: "branch_current", id: "R" } }];
  const denied = await new LocalDeterministicSolverProvider().solve(f.problem);
  assert.equal(denied.status, "failed", c.id);
  assert.deepEqual(denied.values, [], c.id);
  assert.equal(synthesizeFamilyScene({ question: f.problem.question, problemIR: f.problem }), null, c.id);
  assert.equal(synthesizeLastResortScene({ question: f.problem.question, problemIR: f.problem }), null, c.id);
  writeFileSync(resolve(out, `${c.id}.source.json`), JSON.stringify({ ...f, denied }, null, 2));
  writeFileSync(resolve(out, `${c.id}.rejected.svg`), renderSceneSvg({ engineVersion: "ohm-audit-null/v1", primitives: [], revealGroups: [], timeline: [], entityBounds: {} },
    { title: c.id, subtitle: `Numeric candidate rejected: ${c.code}; no scene is authorized by this result` }));
  evidence.push({ id: c.id, rejection: c.code });
}
const base = fixture(cases[0].elements);
const mismatchedQuestion: ProblemIR = { ...base.problem, solveRequests: [{ id: "current", kind: "dc_network", network: base.network, output: { kind: "branch_current", id: "R" } }] };
assert.equal(synthesizeFamilyScene({ question: `${base.problem.question}. This is a different submitted question`, problemIR: mismatchedQuestion }), null, "submitted question mismatch must not fall through");
const outsideScope = fixture([source("12"), load("6"), { ...load("3"), id: "T" }]);
outsideScope.problem.solveRequests = [{ id: "current", kind: "dc_network", network: outsideScope.network, output: { kind: "branch_current", id: "R" } }];
assert.equal(synthesizeFamilyScene({ question: outsideScope.problem.question, problemIR: outsideScope.problem }), null, "multi-load scope must not fall through");
assert.equal(synthesizeLastResortScene({ question: outsideScope.problem.question, problemIR: outsideScope.problem }), null, "multi-load fallback must not invent a topic scene");
const mutations: Array<[string, (p: ProblemIR, n: DcNetwork) => void]> = [
  ["stale-scalar", (p) => { p.expressions[1].root = { kind: "number", value: 99 }; }],
  ["wrong-polarity", (_p, n) => { n.branches[0].from = "B"; n.branches[0].to = "A"; }],
  ["wrong-owner", (_p, n) => { n.branches[1].quantityFactId = "value0"; }],
  ["missing-connection", (p) => { p.constraints.pop(); }],
  ["full-options-residual", (p) => { p.question += ". Options: 1 A, 2 A, 3 A, 4 A"; }],
  ["contradictory-current-residual", (p) => { p.question += ". I(R)=1 A"; }],
];
for (const [id, mutate] of mutations) {
  const f = structuredClone(base);
  mutate(f.problem, f.network);
  assert.throws(() => solveDcNetwork(f.problem, f.network), DcNetworkError, id);
  f.problem.solveRequests = [{ id: "current", kind: "dc_network", network: f.network, output: { kind: "branch_current", id: "R" } }];
  const denied = await new LocalDeterministicSolverProvider().solve(f.problem);
  assert.equal(denied.status, "failed", id);
  assert.deepEqual(denied.values, [], id);
  assert.equal(synthesizeFamilyScene({ question: f.problem.question, problemIR: f.problem }), null, id);
  assert.equal(synthesizeLastResortScene({ question: f.problem.question, problemIR: f.problem }), null, id);
  evidence.push({ id, mutation: "rejected atomically by solver" });
}
for (const symbol of ["dc_current_source", "wire", "open", "resistor", "battery"]) {
  for (const end of [[4, 0], [0, 4], [-4, 0]]) {
    const document: SceneDocument = { schemaVersion: SCENE_DOCUMENT_VERSION, visualDecision: { mode: "scene", reason: "Generic terminal-relative symbol control" },
      source: {}, quantities: [], entities: [{ id: "A", kind: "point", role: "terminal", label: "A" }, { id: "B", kind: "point", role: "terminal", label: "B" }, { id: "G", kind: "component", role: "generic symbol" }],
      constructions: [{ id: "a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["A"] }, { id: "b", operator: "point", inputs: { x: end[0], y: end[1] }, outputs: ["B"] },
        { id: "g", operator: "symbol", inputs: { symbol, start: "A", end: "B" }, outputs: ["G"] }], relations: [], assertions: [], annotations: [], requiredEntityIds: ["A", "B", "G"],
      revealGroups: [{ id: "symbols", entityIds: ["A", "B", "G"], dependsOn: [], narrationCue: "Symbol geometry control" }], teachingTimeline: [] };
    const compiled = compileSceneDocument(document);
    assert.equal(compiled.ok, true, `${symbol} ${end}`);
    const ink = compiled.renderScene!.primitives.filter((primitive) => primitive.entityId === "G" && primitive.kind !== "label");
    const a = compiled.renderScene!.primitives.find((primitive) => primitive.entityId === "A" && primitive.kind === "point")!.points[0];
    const b = compiled.renderScene!.primitives.find((primitive) => primitive.entityId === "B" && primitive.kind === "point")!.points[0];
    assert.ok(ink.some((primitive) => primitive.points.some((point) => Math.hypot(point.x - a.x, point.y - a.y) < 1e-8)));
    assert.ok(ink.some((primitive) => primitive.points.some((point) => Math.hypot(point.x - b.x, point.y - b.y) < 1e-8)));
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (symbol === "open") assert.ok(ink.every((primitive) => primitive.points.every((point) => Math.hypot(point.x - middle.x, point.y - middle.y) > Math.hypot(b.x - a.x, b.y - a.y) * 0.09)));
    if (symbol === "wire") assert.equal(ink.length, 1);
    for (const invalid of ["unrecognized_dc_symbol", symbol]) {
      const changed = structuredClone(document);
      const construction = changed.constructions.at(-1)!;
      construction.inputs.symbol = invalid;
      if (invalid === symbol) construction.inputs.end = "A";
      const denied = compileSceneDocument(changed);
      assert.equal(denied.ok, false);
      assert.equal(denied.renderScene, null);
    }
  }
}
evidence.push({ symbolControls: "15 terminal-relative positive controls, 30 unknown/degenerate negatives", admissionControls: "question mismatch and multi-load exact/fallback rejected" });
writeFileSync(resolve(out, "results.json"), JSON.stringify(evidence, null, 2));
console.log(`Ohm contract audit: ${cases.length} numeric cases, ${rejected.length} ideal/domain negatives, ${mutations.length} mutations passed. Rendering is diagnostic and does not accept the topic.`);
