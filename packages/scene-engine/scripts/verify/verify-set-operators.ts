import assert from "node:assert/strict";
import { SET_OPERATORS, evaluateSetConstruction, validateSetConstruction, validateEvaluatedSetLabels, setGeometryLabel, type SetEvaluationContext, type SetGeometry } from "../../src/compile/setGeometry";
import type { SceneConstruction, SceneDocument, SceneIssue } from "../../src/types";

let checks = 0;
const geometry = new Map<string, unknown>();
const quantities = new Map<string, number>([["nA", 7], ["nB", 5], ["nAB", 2]]);
const context: SetEvaluationContext = {
  number(value) { if (typeof value === "object" && value !== null && "value" in value) return context.number(value.value); const result = typeof value === "string" && quantities.has(value) ? quantities.get(value)! : Number(value); if (!Number.isFinite(result)) throw new Error("invalid number"); return result; },
  point(value) { if (typeof value === "string") { const source = geometry.get(value); if (typeof source === "object" && source !== null && "point" in source) return source.point as { x: number; y: number }; } throw new Error("invalid point"); },
  geometry(value) { return typeof value === "string" ? geometry.get(value) : undefined; },
};
const twoInputs = { sets: [{ name: "A", count: 7 }, { name: "B", count: 5 }], intersections: [{ sets: ["A", "B"], count: 2 }], universeCount: 20, displayScale: 2, origin: [10, -4] };
function evaluate(operator: string, inputs: Record<string, unknown>): SetGeometry[] { return evaluateSetConstruction(operator, inputs, context); }
function reject(operator: string, inputs: Record<string, unknown>): void { assert.throws(() => evaluate(operator, inputs)); checks++; }
const two = evaluate("set_partition", twoInputs); assert.equal(two.length, 6); checks++;
const first = two[0]!; if (!("setPartition" in first)) throw new Error("partition authority missing"); const definition = first.setPartition;
assert.deepEqual(definition.exclusiveCounts, [10, 5, 3, 2]); checks++;
assert.equal(definition.inclusiveCounts[3], 2); checks++;
for (const output of two) {
  if ("setAtom" in output) {
    for (let index = 0; index < 2; index++) { const circle = definition.circles[index]!; const inside = Math.hypot(output.point.x - circle.center.x, output.point.y - circle.center.y) < circle.radius; assert.equal(inside, Boolean(output.setAtom.mask & 1 << index)); checks++; }
    assert.equal(output.setAtom.representation, "count_anchor"); checks++;
  }
}
geometry.set("partition", two[0]);
const selection = evaluate("set_select", { partition: "partition", expression: { union: [{ set: "A" }, { set: "B" }] } });
assert.equal(selection.length, 1); assert("setSelection" in selection[0]!); assert.equal(selection[0].setSelection.count, 10); assert.deepEqual(selection[0].setSelection.masks, [1, 2, 3]); checks += 3;
const threeInputs = { sets: [{ name: "A", count: 9 }, { name: "B", count: 8 }, { name: "C", count: 6 }], intersections: [{ sets: ["A", "B"], count: 4 }, { sets: ["A", "C"], count: 3 }, { sets: ["B", "C"], count: 2 }, { sets: ["A", "B", "C"], count: 1 }], universeCount: 20, displayScale: 3, origin: [-20, 11] };
const three = evaluate("set_partition", threeInputs); const firstThree = three[0]!; if (!("setPartition" in firstThree)) throw new Error("partition authority missing"); const threeDefinition = firstThree.setPartition;
assert.deepEqual(threeDefinition.exclusiveCounts, [5, 3, 3, 3, 2, 2, 1, 1]); checks++;
assert.equal(threeDefinition.exclusiveCounts.slice(1).reduce<number>((sum, count) => sum + count!, 0), 15); checks++;
for (const inputs of [twoInputs, threeInputs]) for (const displayScale of [0.25, 1, 8]) for (const rotationRadians of [0, Math.PI / 2, Math.PI, -0.719]) {
  const outputs = evaluate("set_partition", { ...inputs, displayScale, rotationRadians, origin: [71, -49] }); const first = outputs[0]!; if (!("setPartition" in first)) throw new Error("partition missing");
  const definition = first.setPartition;
  assert.equal(definition.nonmetric, true); checks++;
  outputs.forEach((output) => { if (!("setAtom" in output)) return;
    for (let setIndex = 0; setIndex < definition.names.length; setIndex++) { const circle = definition.circles[setIndex]!; const distance = Math.hypot(output.point.x - circle.center.x, output.point.y - circle.center.y); assert.equal(distance < circle.radius, Boolean(output.setAtom.mask & 1 << setIndex)); assert(Math.abs(distance - circle.radius) > circle.radius * 0.1); checks += 2; }
  });
  for (let setIndex = 0; setIndex < definition.names.length; setIndex++) { let inclusive = 0; for (let mask = 1; mask < definition.exclusiveCounts.length; mask++) if (mask & 1 << setIndex) inclusive += definition.exclusiveCounts[mask]!; assert.equal(inclusive, inputs.sets[setIndex]!.count); checks++; }
}
geometry.set("three_partition", three[0]);
type Expression = { set: string } | { union: Expression[] } | { intersection: Expression[] } | { difference: Expression[] } | { complement: Expression };
function truth(expression: Expression, membership: readonly boolean[]): boolean {
  if ("set" in expression) return membership[["A", "B", "C"].indexOf(expression.set)]!;
  if ("union" in expression) return expression.union.some((child) => truth(child, membership));
  if ("intersection" in expression) return expression.intersection.every((child) => truth(child, membership));
  if ("difference" in expression) return truth(expression.difference[0]!, membership) && !truth(expression.difference[1]!, membership);
  return !truth(expression.complement, membership);
}
const A = { set: "A" }; const B = { set: "B" }; const C = { set: "C" };
const expressions: Expression[] = [A, B, C, { union: [A, B, C] }, { intersection: [A, B, C] }, { difference: [A, B] }, { complement: A }, { intersection: [{ complement: A }, { complement: B }] }, { union: [{ difference: [A, B] }, { difference: [B, A] }] }, { complement: { intersection: [A, B] } }, { difference: [A, A] }, { intersection: [A, { union: [B, C] }] }];
for (const expression of expressions) {
  const result = evaluate("set_select", { partition: "three_partition", expression })[0]!; assert("setSelection" in result);
  const expectedMasks: number[] = []; let expectedCount = 0;
  for (let mask = 0; mask < 8; mask++) { const expected = truth(expression, [Boolean(mask & 1), Boolean(mask & 2), Boolean(mask & 4)]); assert.equal(result.setSelection.masks.includes(mask), expected); checks++; if (expected) { expectedMasks.push(mask); expectedCount += [5, 3, 3, 3, 2, 2, 1, 1][mask]!; } }
  assert.deepEqual(result.setSelection.masks, expectedMasks); assert.equal(result.setSelection.count, expectedCount); checks += 2;
}
const unknownUniverseInputs = { sets: twoInputs.sets, intersections: twoInputs.intersections, displayScale: 1 };
const unknownUniverse = evaluate("set_partition", unknownUniverseInputs); const firstUnknown = unknownUniverse[0]!; if (!("setPartition" in firstUnknown)) throw new Error("partition missing");
assert.equal(unknownUniverse.length, 5); assert.equal(firstUnknown.setPartition.exclusiveCounts[0], null); geometry.set("unknown_universe", firstUnknown); checks += 2;
reject("set_select", { partition: "unknown_universe", expression: { complement: A } });
assert.equal(evaluate("set_select", { partition: "unknown_universe", expression: { difference: [A, B] } })[0]!.kind, "point"); checks++;
for (const [key, value] of [["sets", []], ["sets", [{ name: "A", count: 1 }]], ["intersections", []], ["universeCount", 9], ["displayScale", 0], ["displayScale", undefined], ["displayScale", 1e-14], ["displayScale", 1e10], ["rotationRadians", Infinity], ["probability", 0.5], ["origin", [true, 0]]] as const) reject("set_partition", { ...twoInputs, [key]: value });
for (const count of [-1, 2.5, 1e10, undefined, true, null, NaN, "1e-999", " "]) reject("set_partition", { ...twoInputs, sets: [{ name: "A", count }, { name: "B", count: 5 }] });
reject("set_partition", { ...twoInputs, intersections: [{ sets: ["A", "B"], count: 8 }] });
reject("set_partition", { ...threeInputs, intersections: [{ sets: ["A", "B"], count: 4 }, { sets: ["A", "C"], count: 3 }, { sets: ["A", "C"], count: 2 }, { sets: ["A", "B", "C"], count: 1 }] });
reject("set_partition", { ...twoInputs, intersections: [{ sets: ["A", "A"], count: 2 }] });
reject("set_partition", { ...twoInputs, intersections: [{ sets: ["A", "X"], count: 2 }] });
reject("set_partition", { ...twoInputs, sets: [{ name: "A", count: 7 }, { name: "A", count: 5 }] });
reject("set_partition", { ...twoInputs, sets: [{ name: "A=99", count: 7 }, { name: "B", count: 5 }] });
reject("set_partition", { ...twoInputs, origin: [1e12, 0], displayScale: 1e-3 });
reject("set_partition", { ...twoInputs, sets: [{ name: "A", count: { value: 7, unit: "m" } }, { name: "B", count: 5 }] });
for (const expression of [{ set: "X" }, "A union B", { union: [A] }, { difference: [A, B, C] }, { set: "A", complement: B }, { inverse: A }, {}]) reject("set_select", { partition: "partition", expression });
const cyclic: { complement?: unknown } = {}; cyclic.complement = cyclic; reject("set_select", { partition: "partition", expression: cyclic });
let deep: unknown = A; for (let index = 0; index < 20; index++) deep = { complement: deep }; reject("set_select", { partition: "partition", expression: deep });
reject("set_select", { partition: "missing", expression: A }); reject("set_select", { partition: "partition", expression: A, area: 100 });
const tampered = structuredClone(firstThree); tampered.setPartition.exclusiveCounts[1] = 999; geometry.set("tampered", tampered); reject("set_select", { partition: "tampered", expression: A });
function documentFor(): SceneDocument {
  const ids = ["setA", "setB", "atom1", "atom2", "atom3", "atom0", "selected"];
  return { schemaVersion: "scene-document/v2", source: {}, visualDecision: { mode: "scene", reason: "explicit finite-set counts and Boolean selection" }, quantities: [], entities: ids.map((id, index) => ({ id, kind: index < 2 ? "circle" : "label", role: index < 2 ? "nonmetric set boundary" : "finite-set count anchor" })), constructions: [{ id: "partition", operator: "set_partition", inputs: structuredClone(twoInputs), outputs: ids.slice(0, -1) }, { id: "select", operator: "set_select", inputs: { partition: "setA", expression: { union: [A, B] } }, outputs: ["selected"] }], relations: [], assertions: [], annotations: [], requiredEntityIds: ids, revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "show finite-set topology" }], teachingTimeline: [] };
}
function issuesFor(document: SceneDocument): SceneIssue[] { const issues: SceneIssue[] = []; const byOutput = new Map(document.constructions.flatMap((construction) => construction.outputs.map((id) => [id, construction] as const))); document.constructions.forEach((construction, index) => validateSetConstruction(construction, index, document, byOutput, issues)); return issues; }
assert.deepEqual(issuesFor(documentFor()), []); checks++;
const invalidDocuments: SceneDocument[] = [];
function malformed(change: (document: SceneDocument) => void): void { const document = documentFor(); change(document); invalidDocuments.push(document); assert(issuesFor(document).some((issue) => issue.severity === "fatal")); checks++; }
malformed((document) => { document.constructions[0]!.outputs.pop(); });
malformed((document) => { document.entities[2]!.kind = "point"; });
malformed((document) => { document.constructions[0]!.inputs.universeCount = 9; });
malformed((document) => { document.constructions[1]!.inputs.partition = "selected"; });
malformed((document) => { document.constructions[0]!.inputs.displayScale = { value: 2, unit: "N" }; });
malformed((document) => { document.quantities.push({ id: "physical_count", value: 7, unit: "cm" }); document.constructions[0]!.inputs.sets = [{ name: "A", count: "physical_count" }, { name: "B", count: 5 }]; });
malformed((document) => { document.entities[0]!.label = "n(A)=999"; });
malformed((document) => { document.entities[2]!.label = "n(A\\B)=999"; });
malformed((document) => { document.entities[6]!.label = "n(expr)=999"; });
for (const kind of ["label", "callout", "badge", "brace", "narration"]) malformed((document) => { document.annotations.push({ id: "false_count", kind, targetIds: ["setA"], text: "n(A)=999" }); });
malformed((document) => { document.quantities.push({ id: "false_quantity", symbol: "n(A)", value: 999, unit: "1" }); document.annotations.push({ id: "false_quantity_label", kind: "label", targetIds: ["setA"], quantityId: "false_quantity" }); });
malformed((document) => { document.entities[0]!.label = "r=2"; });
malformed((document) => { document.entities[0]!.label = "7 m"; });
const labelIssues: SceneIssue[] = []; const badLabels = documentFor(); badLabels.entities[2]!.label = "999"; validateEvaluatedSetLabels(badLabels.constructions[0]!, 0, badLabels, two, labelIssues); assert(labelIssues.some((issue) => issue.severity === "fatal")); checks++;
assert.equal(setGeometryLabel(two[0]), "A"); assert.equal(setGeometryLabel(two[2]), "A\\B"); assert.equal(setGeometryLabel(selection[0]), "n(expr)"); checks += 3;
const explicitUniverse = ["outside", "a0", "a1", "b0", "ab0", "c0", "ac0", "bc0", "abc0"];
const explicitMembership = [new Set(["a0", "a1", "ab0", "ac0", "abc0"]), new Set(["b0", "ab0", "bc0", "abc0"]), new Set(["c0", "ac0", "bc0", "abc0"])];
const explicitInput = { sets: ["A", "B", "C"].map((name, index) => ({ name, count: explicitMembership[index]!.size })), intersections: [[0, 1], [0, 2], [1, 2], [0, 1, 2]].map((indices) => ({ sets: indices.map((index) => ["A", "B", "C"][index]), count: explicitUniverse.filter((element) => indices.every((index) => explicitMembership[index]!.has(element))).length })), universeCount: explicitUniverse.length, displayScale: 1 };
const explicitOutput = evaluate("set_partition", explicitInput)[0]!; assert("setPartition" in explicitOutput);
for (let mask = 0; mask < 8; mask++) { const expected = explicitUniverse.filter((element) => explicitMembership.every((members, index) => members.has(element) === Boolean(mask & 1 << index))).length; assert.equal(explicitOutput.setPartition.exclusiveCounts[mask], expected); checks++; }
const exactLabels = documentFor(); exactLabels.entities[0]!.label = "n(A)=7"; exactLabels.entities[2]!.label = "n(A\\B)=5"; exactLabels.entities[6]!.label = "n(expr)=10";
exactLabels.quantities.push({ id: "true_A", symbol: "n(A)", value: 7, unit: "1" }, { id: "true_atom", symbol: "n(A\\B)", value: 5, unit: "dimensionless" });
exactLabels.annotations.push({ id: "true_circle_count", kind: "label", targetIds: ["setA"], quantityId: "true_A" }, { id: "true_atom_count", kind: "callout", targetIds: ["atom1"], quantityId: "true_atom" });
assert.deepEqual(issuesFor(exactLabels), []); checks++;
const quantitySources = documentFor(); quantitySources.quantities.push({ id: "nA", value: 7, unit: "1" }, { id: "nB", value: 5, unit: "dimensionless" }, { id: "nAB", value: { value: 2, unit: "1" }, unit: "1" }, { id: "rotation", value: 0.72, unit: "rad" });
quantitySources.constructions[0]!.inputs.sets = [{ name: "A", count: "nA" }, { name: "B", count: "nB" }]; quantitySources.constructions[0]!.inputs.intersections = [{ sets: ["A", "B"], count: "nAB" }]; quantitySources.constructions[0]!.inputs.rotationRadians = "rotation";
assert.deepEqual(issuesFor(quantitySources), []); checks++;
malformed((document) => { document.annotations.push({ id: "false_area", kind: "brace", targetIds: ["setA"], text: "7 m^2" }); });
malformed((document) => { document.quantities.push({ id: "false_metric", symbol: "n(A)", value: 7, unit: "m^2" }); document.annotations.push({ id: "false_dimension", kind: "label", targetIds: ["setA"], quantityId: "false_metric" }); });
malformed((document) => { document.entities.push({ id: "false_label", kind: "label", role: "false count claim" }); document.constructions.push({ id: "false_label_construction", operator: "label", inputs: { target: "atom1", text: "999" }, outputs: ["false_label"] }); });
if (!process.argv.includes("--unit-only")) {
  const { compileSceneDocument } = await import("../../src/compile/compiler");
  const valid = documentFor(); valid.constructions.reverse(); const result = compileSceneDocument(valid); assert.equal(result.ok, true, JSON.stringify(result.report.issues)); assert(result.renderScene); assert.equal(result.renderScene.primitives.filter((primitive) => primitive.kind === "point").length, 0, "count anchors never draw fake members"); checks++;
  for (const document of [exactLabels, quantitySources]) { const result = compileSceneDocument(document); assert.equal(result.ok, true, JSON.stringify(result.report.issues)); assert(result.renderScene); checks++; }
  for (const document of invalidDocuments) { const result = compileSceneDocument(document); assert.equal(result.ok, false); assert.equal(result.renderScene, null); checks++; }
  for (const [predicate, entities, expected] of [["inside", ["atom1", "setA"], true], ["inside", ["atom1", "setB"], false], ["inside", ["atom3", "setB"], true], ["inside", ["atom0", "setA"], false]] as const) {
    const document = documentFor(); document.assertions.push({ id: "membership", predicate, entities: [...entities], expected, severity: "fatal" }); const result = compileSceneDocument(document); assert.equal(result.ok, true, JSON.stringify(result.report.issues)); checks++;
  }
  for (const [predicate, entities] of [["angle_between", ["atom1", "atom2"]], ["distance_ratio", ["atom1", "atom2", "atom3", "atom0"]], ["equal_length", ["setA", "setB"]]] as const) for (const expected of [true, false]) {
    const document = documentFor(); document.assertions.push({ id: "false_metric", predicate, entities: [...entities], expected, severity: "fatal" }); const result = compileSceneDocument(document); assert.equal(result.ok, false); assert.equal(result.renderScene, null); assert(result.report.issues.some((issue) => issue.code === "invalid_nonmetric_assertion")); checks++;
  }
  for (const [operator, inputs, kind] of [["dimension", { start: "atom1", end: "atom2" }, "dimension"], ["translate", { point: "atom1", vector: [1, 0] }, "point"], ["circle_tangent_at", { circle: "setA", point: [11, -4], span: 4 }, "line"]] as const) {
    const document = documentFor(); const construction: SceneConstruction = { id: "false_metric_construction", operator, inputs, outputs: ["false_metric_mark"] }; document.constructions.push(construction); document.entities.push({ id: "false_metric_mark", kind, role: "forbidden normalized-layout metric" }); document.requiredEntityIds.push("false_metric_mark"); document.revealGroups[0]!.entityIds.push("false_metric_mark");
    const result = compileSceneDocument(document); assert.equal(result.ok, false); assert.equal(result.renderScene, null); checks++;
  }
}
assert.deepEqual([...SET_OPERATORS], ["set_partition", "set_select"]);
console.log(`set operators verified: ${checks} finite-set and rejection checks`);
