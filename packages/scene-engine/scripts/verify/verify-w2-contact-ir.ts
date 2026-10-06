/** Authored full-IR cases, independent formulas/oracles; no frozen worker gate. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { checkVisualObligations, deriveVisualObligations } from "../../src/synthesize/visualObligations";
import { staticContactTriangleDocument, validateStaticContactTriangleSource } from "../../src/ir/staticContactTriangle";
import { validateProblemIR, type ProblemIR, type ExpressionNodeIR as Node } from "../../src/ir/problemIR";
import { LocalDeterministicSolverProvider } from "../../src/ir/solver";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import { renderSceneSvg } from "../lib/renderSceneSvg";
import type { SceneDocument } from "../../src/types";

const out = resolve(process.argv[2] ?? "/tmp/w2-contact-ir-20261006/final");
mkdirSync(out, { recursive: true });
const n = (value: number): Node => ({ kind: "number", value });
const b = (operator: "+" | "-" | "*" | "/" | "^", left: Node, right: Node): Node => ({ kind: "binary", operator, left, right });
const sqrt = (argument: Node): Node => ({ kind: "call", function: "sqrt", argument });
const sq = (root: Node) => b("^", root, n(2));
const hyp = (l: Node, d: Node) => sqrt(b("-", sq(l), sq(d)));
const expectedLabels: Record<string, string[]> = {
  height_metres: ["L=13 m", "d=5 m", "h=1200 cm"], distance_top: ["L=10 m", "h=8 m", "d=6 m"],
  two_legs_left_mixed: ["d=500 cm", "h=12 m", "L=13 m"], angle_centimetres: ["L=500 cm", "d=300 cm", "θ≈53.1°"],
  cosine_kilometres_right: ["d=1 km", "h=750 m", "cosθ=0.8"],
};
const results: Array<{ name: string; ok: boolean; failure?: string }> = [];
const check = async (name: string, run: () => unknown | Promise<unknown>) => {
  try { await run(); results.push({ name, ok: true }); }
  catch (error) { results.push({ name, ok: false, failure: error instanceof Error ? error.stack : String(error) }); }
};
interface ContactCase { id: string; question: string; givens: readonly (readonly [string, number, string])[]; symbol: string; unit: string; value: number; root: Node; L: number; d: number; h: number; side: number }
const cases: ContactCase[] = [
  { id: "height_metres", question: "A ladder of length 13 m leans against a vertical wall. Its foot is 5 m from the wall on a horizontal floor. Find the height reached.",
    givens: [["eL", 13, "m"], ["eD", 5, "m"]] as const, symbol: "h", unit: "cm", value: 1200, root: b("/", hyp(n(13), n(5)), n(.01)), L: 13, d: 5, h: 12, side: 1 },
  { id: "distance_top", question: "A ladder of length 10 m leans against a vertical wall. Its top is 8 m above the horizontal floor. Find the foot distance.",
    givens: [["eL", 10, "m"], ["eH", 8, "m"]] as const, symbol: "d", unit: "m", value: 6, root: hyp(n(10), n(8)), L: 10, d: 6, h: 8, side: 1 },
  { id: "two_legs_left_mixed", question: "A ladder leans against a vertical wall with its foot 500 cm to the left of the wall on a horizontal floor. Its top is 12 m above the floor. Find its length.",
    givens: [["eD", 500, "cm"], ["eH", 12, "m"]] as const, symbol: "L", unit: "m", value: 13, root: sqrt(b("+", sq(b("*", n(500), n(.01))), sq(n(12)))), L: 13, d: 5, h: 12, side: -1 },
  { id: "angle_centimetres", question: "A 500 cm long ladder leans against a vertical wall. Its foot is 300 cm from the wall on a horizontal floor. Find the angle with the floor.",
    givens: [["eL", 500, "cm"], ["eD", 300, "cm"]] as const, symbol: "theta", unit: "degree", value: 53.13010235415598,
    root: b("/", b("*", { kind: "call", function: "atan", argument: b("/", hyp(b("*", n(500), n(.01)), b("*", n(300), n(.01))), b("*", n(300), n(.01))) }, n(180)), { kind: "constant", name: "pi" }), L: 5, d: 3, h: 4, side: 1 },
  { id: "cosine_kilometres_right", question: "A ladder leans against a vertical wall with its foot 1 km to the right of the wall on a horizontal floor. Its top is 750 m above the floor. Calculate the cosine of the angle to the horizontal.",
    givens: [["eD", 1, "km"], ["eH", 750, "m"]] as const, symbol: "cosTheta", unit: "1", value: .8, root: b("/", b("*", n(1), n(1000)), sqrt(b("+", sq(b("*", n(1), n(1000))), sq(n(750))))), L: 1250, d: 1000, h: 750, side: 1 },
];
function fullIR(c: typeof cases[number]): ProblemIR {
  const requestStart = c.question.search(/(?:Find|Calculate)\b/);
  const setup = c.question.slice(0, requestStart).trim(), ask = c.question.slice(requestStart);
  const facts: ProblemIR["facts"] = [{ id: "source", kind: "given", statement: setup, evidence: { source: "question", start: 0, end: setup.length, quote: setup } },
    { id: "ask", kind: "requested", statement: ask, evidence: { source: "question", start: requestStart, end: c.question.length, quote: ask } }];
  return { schemaVersion: "problem-ir/v1", id: c.id, question: c.question, facts,
    entities: [
      { id: "physicalLadder", kind: "body", label: "ladder", evidenceFactIds: ["source"] },
      { id: "physicalWall", kind: "line", label: "wall", evidenceFactIds: ["source"] },
      { id: "physicalFloor", kind: "line", label: "floor", evidenceFactIds: ["source"] },
      { id: "physicalFoot", kind: "point", label: "foot", evidenceFactIds: ["source"] },
      { id: "physicalTop", kind: "point", label: "top", evidenceFactIds: ["source"] },
      { id: "physicalCorner", kind: "point", label: "corner", evidenceFactIds: ["source"] },
    ],
    expressions: [...c.givens.map(([id, value]) => ({ id, valueType: "scalar" as const, root: n(value), evidenceFactIds: ["source"] })),
      { id: "answerExpression", valueType: "scalar", root: structuredClone(c.root), evidenceFactIds: ["source", "ask"] }],
    constraints: [{ id: "wallFloor", kind: "perpendicular", entityIds: ["physicalWall", "physicalFloor"], evidenceFactIds: ["source"] },
      { id: "footContact", kind: "incident", entityIds: ["physicalFoot", "physicalFloor"], evidenceFactIds: ["source"] },
      { id: "topContact", kind: "incident", entityIds: ["physicalTop", "physicalWall"], evidenceFactIds: ["source"] }],
    representationIntents: [{ id: "wholeContact", kind: "conceptual", entityIds: ["physicalLadder", "physicalWall", "physicalFloor", "physicalFoot", "physicalTop", "physicalCorner"], evidenceFactIds: ["source"] }],
    solveRequests: [{ id: "computeAnswer", kind: "evaluate", expressionId: "answerExpression", resultBinding: { turnPlanQuantityId: "requestedAnswer", symbol: c.symbol, unit: c.unit, evidenceFactIds: ["ask"] } }],
  };
}
const planFor = (c: typeof cases[number]): TurnPlanV3 => ({ schemaVersion: "turn-plan/v3", question: c.question,
  givens: c.givens.map(([id, value, unit]) => ({ id: id.slice(1), symbol: id.slice(1), value, unit, provenance: "given" })),
  derived: [], unknowns: [{ id: "requestedAnswer", symbol: c.symbol, unit: c.unit }],
  qualitativeClaims: [], assumptions: [], lawIds: [], visualRequirement: "required" });
for (const c of cases) {
  const problem = fullIR(c), plan = planFor(c), before = JSON.stringify({ problem, plan });
  writeFileSync(resolve(out, `${c.id}.input.json`), JSON.stringify({ problem, plan }, null, 2));
  await check(`${c.id}: complete numeric source join`, async () => {
    assert.ok(validateProblemIR(problem, c.question).valid);
    const scene = synthesizeFamilyScene({ question: c.question, problemIR: problem, turnPlan: plan });
    assert.ok(scene, "Normal full-IR synthesis declined");
    const document = staticContactTriangleDocument(c.question, plan, problem)!;
    assert.deepEqual(document, scene.document);
    const compiled = compileSceneDocument(document, { sourceAuthority: { question: c.question, problemIR: problem } });
    writeFileSync(resolve(out, `${c.id}.output.json`), JSON.stringify({ document, compiled }, null, 2));
    assert.equal(compiled.ok, true, JSON.stringify(compiled.report.issues));
    if (compiled.renderScene) writeFileSync(resolve(out, `${c.id}.svg`), renderSceneSvg(compiled.renderScene));
    for (const text of expectedLabels[c.id]!) {
      const label = document.entities.find(row => row.id.startsWith("contact_value_") && row.label === text);
      assert.ok(label, `Missing actual numeric label ${text}`);
      assert.ok(document.requiredEntityIds.includes(label.id));
      assert.ok(document.revealGroups.some(group => group.entityIds.includes(label.id)));
      assert.ok(compiled.renderScene?.primitives.some(primitive => primitive.kind === "label" && primitive.text === text), `Numeric label did not render: ${text}`);
    }
    assert.deepEqual(validateStaticContactTriangleSource(document, c.question, problem), []);
    assert.ok(checkVisualObligations(deriveVisualObligations(problem), document, problem).satisfied);
    for (const [id, value, unit] of c.givens) {
      const quantity = document.quantities.find(row => row.id === id)!;
      assert.equal(quantity.value, value); assert.equal(quantity.unit, unit); assert.equal(quantity.provenance, "given");
      assert.ok(document.annotations.some(row => row.quantityId === id && row.targetIds.length === 1));
    }
    assert.ok(Math.abs(Number(document.quantities.find(row => row.id === "requestedAnswer")!.value) - c.value) < 1e-10);
    assert.equal(document.quantities.find(row => row.id === "requestedAnswer")!.unit, c.unit);
    for (const [id, label] of [["ladder", "ladder"], ["wall", "wall"], ["floor", "floor"], ["A", "foot"], ["B", "top"], ["corner", "corner"]]) {
      assert.equal(document.entities.find(row => row.id === id)!.label, label);
      assert.ok(document.requiredEntityIds.includes(id));
      assert.ok(document.revealGroups.some(group => group.entityIds.includes(id)));
    }
    assert.equal(document.constructions.find(row => row.outputs.includes("A"))!.inputs.x, c.side * c.d);
    assert.equal(document.constructions.find(row => row.outputs.includes("B"))!.inputs.y, c.h);
    const solver = await new LocalDeterministicSolverProvider().solve(problem);
    assert.equal(solver.status, "solved");
    assert.ok(Math.abs(Number(solver.values[0]!.approximate) - c.value) < 1e-9);
    assert.equal(JSON.stringify({ problem, plan }), before, "Caller IR/plan changed");
  });
}
const c = cases[0]!, base = fullIR(c), plan = planFor(c);
const rejectIR = async (name: string, mutate: (problem: ProblemIR) => void) => check(name, () => {
  const problem = structuredClone(base); mutate(problem);
  writeFileSync(resolve(out, `${name}.input.json`), JSON.stringify(problem, null, 2));
  assert.equal(staticContactTriangleDocument(c.question, plan, problem), null);
  assert.equal(synthesizeFamilyScene({ question: c.question, problemIR: problem, turnPlan: plan }), null);
});
await rejectIR("wrong_ast_same_answer", p => p.expressions.at(-1)!.root = b("/", b("-", n(13), b("/", n(5), n(5))), n(.01)));
await rejectIR("constant_same_answer", p => p.expressions.at(-1)!.root = n(1200));
await rejectIR("wrong_unknown_unit", p => p.solveRequests[0]!.resultBinding!.unit = "s");
await rejectIR("foreign_entity_binding", p => p.solveRequests[0]!.resultBinding!.turnPlanQuantityId = "physicalWall");
await rejectIR("foreign_binding_index", p => p.solveRequests[0]!.resultBinding!.turnPlanQuantityId = "unplannedAnswer");
await rejectIR("wrong_binding_role", p => p.solveRequests[0]!.resultBinding!.symbol = "d");
await rejectIR("wrong_binding_evidence", p => p.solveRequests[0]!.resultBinding!.evidenceFactIds = ["source"]);
await rejectIR("hidden_expression", p => p.expressions.push({ id: "hidden", valueType: "scalar", root: n(12), evidenceFactIds: ["source"] }));
await rejectIR("orphan_fact", p => p.facts.push({ id: "orphan", kind: "given", statement: "ladder", evidence: { source: "question", start: 2, end: 8, quote: "ladder" } }));
await rejectIR("wrong_given_role", p => p.expressions[0]!.id = "eH");
await rejectIR("wrong_given_raw_unit_value", p => p.expressions[0]!.root = n(1300));
await rejectIR("missing_given_carrier", p => p.expressions.splice(0, 1));
await rejectIR("missing_request", p => p.solveRequests = []);
await rejectIR("missing_source_entity", p => { p.entities = p.entities.filter(row => row.id !== "physicalWall"); p.constraints = []; p.representationIntents[0]!.entityIds = p.entities.map(row => row.id); });
await rejectIR("wrong_point_truth", p => p.entities.find(row => row.label === "foot")!.kind = "body");
await rejectIR("unsupported_condition", p => p.facts[0]!.statement += " The wall is tilted.");
await rejectIR("unsupported_relation", p => p.constraints[0]!.kind = "parallel");
await rejectIR("unsupported_equation", p => p.constraints.push({ id: "hiddenEquation", kind: "equation", leftExpressionId: "eL", rightExpressionId: "eD", evidenceFactIds: ["source"] }));
await rejectIR("unsupported_intent", p => p.representationIntents[0]!.kind = "free_body");
await rejectIR("wrong_incidence", p => { const constraint = p.constraints[1]!; if (constraint.kind === "incident") constraint.entityIds = ["physicalFoot", "physicalWall"]; });
await rejectIR("missing_formula_source_evidence", p => p.expressions.at(-1)!.evidenceFactIds = ["ask"]);
await rejectIR("foreign_solve_kind", p => p.solveRequests[0] = { id: "roots", kind: "roots", expressionId: "answerExpression", variable: "x", domain: { min: 0, max: 1 } });
for (const [name, mutate] of [
  ["parent_S1_conflicting_id_symbol", (p: TurnPlanV3) => { p.givens[0]!.id = "length"; p.givens[0]!.symbol = "height"; }],
  ["stale_plan", (p: TurnPlanV3) => p.derived.push({ id: "h", symbol: "h", unit: "cm", value: 999, provenance: "derived" })],
  ["stale_cos_plan", (p: TurnPlanV3) => p.derived.push({ id: "cosTheta", symbol: "cosTheta", unit: "1", value: .5, provenance: "derived" })],
  ["wrong_plan_unknown_unit", (p: TurnPlanV3) => { p.unknowns[0]!.unit = "s"; }],
  ["duplicate_plan_index", (p: TurnPlanV3) => p.unknowns.push({ ...p.unknowns[0]! })],
] as const) await check(name, () => { const bad = structuredClone(plan); mutate(bad); assert.equal(staticContactTriangleDocument(c.question, bad, base), null); });

const document = staticContactTriangleDocument(c.question, plan, base);
const mutations: Array<[string, (scene: SceneDocument) => void]> = [
  ["required_entity", scene => { scene.requiredEntityIds = scene.requiredEntityIds.filter(id => id !== "A"); }],
  ["required_reveal", scene => { scene.revealGroups[0]!.entityIds = scene.revealGroups[0]!.entityIds.filter(id => id !== "B"); }],
  ["numeric_carrier", scene => { scene.quantities.find(row => row.id === "eL")!.value = 99; }],
  ["raw_unit", scene => { scene.quantities.find(row => row.id === "eL")!.unit = "cm"; }],
  ["answer_value", scene => { scene.quantities.find(row => row.id === "requestedAnswer")!.value = 999; }],
  ["physical_name", scene => { scene.entities.find(row => row.id === "A")!.label = "wall"; }],
  ["geometry", scene => { scene.constructions.find(row => row.outputs.includes("A"))!.inputs.x = 10; }],
  ["proof", scene => { scene.assertions = scene.assertions.filter(row => row.id !== "wall_floor_perpendicular"); }],
  ["quantity_owner", scene => { scene.annotations.find(row => row.quantityId === "eL")!.targetIds = ["wall"]; }],
  ["numeric_label", scene => { scene.entities.find(row => row.id === "contact_value_requestedAnswer")!.label = "h=999 cm"; }],
  ["numeric_label_reveal", scene => { scene.revealGroups[1]!.entityIds = scene.revealGroups[1]!.entityIds.filter(id => id !== "contact_value_requestedAnswer"); }],
  ["text_only", scene => { scene.visualDecision.mode = "text_only"; }],
];
for (const [name, mutate] of mutations) await check(`candidate_${name}`, () => {
  assert.ok(document); const bad = structuredClone(document); mutate(bad);
  bad.source = { question: c.question, contactProblemVerified: true };
  for (const entity of bad.entities) entity.provenance = { sourceVerified: true };
  const compiled = compileSceneDocument(bad, { sourceAuthority: { question: c.question, problemIR: base } });
  writeFileSync(resolve(out, `candidate_${name}.output.json`), JSON.stringify(compiled, null, 2));
  assert.equal(compiled.ok, false); assert.equal(compiled.renderScene, null);
});
await check("metadata_is_not_authority", () => {
  assert.ok(document); const plain = structuredClone(document); plain.source = { question: c.question };
  assert.deepEqual(validateStaticContactTriangleSource(plain, c.question, base), []);
  assert.equal(compileSceneDocument(plain, { sourceAuthority: { question: c.question, problemIR: base } }).ok, true);
  const invalid = structuredClone(base); invalid.expressions.at(-1)!.root = n(1200);
  assert.equal(compileSceneDocument(plain, { sourceAuthority: { question: c.question, problemIR: invalid } }).ok, false);
});
await check("reserved_quantity_role_binding", () => {
  const problem = structuredClone(base), matchingPlan = structuredClone(plan);
  problem.solveRequests[0]!.resultBinding!.turnPlanQuantityId = "height";
  matchingPlan.unknowns[0]!.id = "height";
  const scene = synthesizeFamilyScene({ question: c.question, problemIR: problem, turnPlan: matchingPlan });
  assert.ok(scene); assert.equal(scene.document.quantities.find(row => row.id === "height")!.value, 1200);
  assert.equal(scene.document.quantities.find(row => row.id === "height")!.unit, "cm");
});
await check("generated_caption_is_foreign_binding", () => {
  const problem = structuredClone(base), matchingPlan = structuredClone(plan);
  problem.solveRequests[0]!.resultBinding!.turnPlanQuantityId = "floor_source_name";
  matchingPlan.unknowns[0]!.id = "floor_source_name";
  assert.equal(staticContactTriangleDocument(c.question, matchingPlan, problem), null);
});
await check("canonical_commuted_product_and_sum", () => {
  const sample = cases[2]!, problem = fullIR(sample);
  const root = problem.expressions.at(-1)!.root;
  assert.equal(root.kind, "call");
  if (root.kind !== "call" || root.argument.kind !== "binary") throw new Error("test fixture shape");
  [root.argument.left, root.argument.right] = [root.argument.right, root.argument.left];
  assert.ok(synthesizeFamilyScene({ question: sample.question, problemIR: problem, turnPlan: planFor(sample) }));
});
await check("equivalent_ast_is_deliberately_bounded", () => {
  const problem = structuredClone(base);
  problem.expressions.at(-1)!.root = b("/", sqrt(b("*", b("-", n(13), n(5)), b("+", n(13), n(5)))), n(.01));
  assert.equal(staticContactTriangleDocument(c.question, plan, problem), null);
});
await check("ambiguous_equal_role_literals_decline", () => {
  const sample = { ...cases[2]!, question: "A ladder leans against a vertical wall with its foot 5 m to the left of the wall on a horizontal floor. Its top is 5 m above the floor. Find its length.",
    givens: [["eD", 5, "m"], ["eH", 5, "m"]] as const, root: sqrt(b("+", sq(n(5)), sq(n(5)))), value: Math.sqrt(50) };
  assert.ok(staticContactTriangleDocument(sample.question));
  assert.equal(staticContactTriangleDocument(sample.question, undefined, fullIR(sample)), null);
});
await check("raw_literal_dimension_carrier_collision", () => {
  const sample = cases[3]!, problem = fullIR(sample);
  problem.expressions[0]!.id = "length";
  const scene = synthesizeFamilyScene({ question: sample.question, problemIR: problem, turnPlan: planFor(sample) });
  assert.ok(scene); assert.equal(scene.document.quantities.find(row => row.id === "length")!.value, 500);
  assert.equal(scene.document.quantities.find(row => row.id === "length")!.unit, "cm");
});
await check("initial_inline_length_distance_decline", () => {
  assert.equal(staticContactTriangleDocument("A ladder of length 13 m leans against a vertical wall with its foot 5 m to the right of the wall on a horizontal floor. Find the height."), null);
});
await check("source_only_and_initial_prose", () => {
  assert.ok(staticContactTriangleDocument(c.question));
  const prose = structuredClone(base); prose.expressions = []; prose.solveRequests = []; prose.constraints = [];
  prose.entities = prose.entities.filter(row => row.kind !== "point"); prose.representationIntents[0]!.entityIds = prose.entities.map(row => row.id);
  assert.ok(synthesizeFamilyScene({ question: c.question, problemIR: prose }));
});
for (const suffix of [" Another ladder is present.", " The wall is tilted.", " The foot is not on the floor.", " If the wall moves, find the speed."])
  await check(`whole_source_decline_${suffix.trim()}`, () => assert.equal(staticContactTriangleDocument(c.question + suffix), null));
writeFileSync(resolve(out, "results.json"), JSON.stringify({ parentHEAD: "f9b590b12bf7ca3319969a6686eef7dfc00baee6", offline: true, ready: 0, countDelta: 0, results }, null, 2));
for (const result of results) if (!result.ok) console.error(`FAIL ${result.name}\n${result.failure}`);
console.log(`W2 contact full IR: ${results.length} checks, ${results.filter(row => !row.ok).length} failures; offline READY=0 countDelta=0`);
if (results.some(row => !row.ok)) process.exitCode = 1;
