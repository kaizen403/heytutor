import assert from "node:assert/strict";
import {
  deriveProbabilityTree,
  evaluateProbabilityConstruction,
  probabilityTreeOutputLabels,
  validateProbabilityConstruction,
} from "../../src/compile/probabilityGeometry";
import type { RenderPoint, SceneDocument } from "../../src/types";

const conditionalNodes = [
  { id: "start", outcome: "Start" },
  { id: "a", outcome: "A", parent: "start", probability: 0.3 },
  { id: "b", outcome: "B", parent: "start", probability: 0.7 },
  { id: "ay", outcome: "Y", parent: "a", probability: 0.8 },
  { id: "an", outcome: "N", parent: "a", probability: 0.2 },
  { id: "by", outcome: "Y", parent: "b", probability: 0.1 },
  { id: "bn", outcome: "N", parent: "b", probability: 0.9 },
];
const context = {
  number: (value: unknown): number => {
    if (typeof value !== "number" && typeof value !== "string") throw new Error("unresolved value");
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error("nonfinite value");
    return parsed;
  },
  point: (value: unknown): RenderPoint => {
    if (Array.isArray(value) && value.length === 2) return { x: Number(value[0]), y: Number(value[1]) };
    if (typeof value === "object" && value !== null && "x" in value && "y" in value) {
      return { x: Number(value.x), y: Number(value.y) };
    }
    throw new Error("unresolved point");
  },
};

const tree = deriveProbabilityTree({ nodes: conditionalNodes }, context);
const byId = new Map(tree.nodes.map((node) => [node.id, node]));
for (const [id, expected] of [["ay", 0.24], ["an", 0.06], ["by", 0.07], ["bn", 0.63]] as const) {
  near(byId.get(id)!.jointProbability, expected, `${id} multiplies its supplied path conditionals`);
}
near(byId.get("ay")!.jointProbability + byId.get("by")!.jointProbability, 0.31,
  "law of total probability recomputes 0.3×0.8 + 0.7×0.1");
near(byId.get("ay")!.jointProbability / 0.31, 24 / 31,
  "Bayes posterior uses the supplied unequal conditional branches");
near(tree.totalLeafProbability, 1, "complete explicit paths sum to one");
assert.deepEqual(tree.leafIds, ["ay", "an", "by", "bn"]);
assert.notEqual(byId.get("ay")!.conditionalProbability, byId.get("by")!.conditionalProbability,
  "different conditional distributions are preserved without invented independence");
assert.deepEqual(probabilityTreeOutputLabels({ nodes: conditionalNodes }, context),
  ["Start", "A", "B", "Y", "N", "Y", "N", "p=0.3", "p=0.7", "p=0.8", "p=0.2", "p=0.1", "p=0.9",
    "P=0.24", "P=0.06", "P=0.07", "P=0.63"], "node, branch and joint labels derive from the exact input tree");

const geometry = evaluateProbabilityConstruction("probability_tree", { nodes: conditionalNodes }, context);
assert.equal(geometry.length, 17, "7 explicit nodes + 6 branches + 4 leaf label anchors");
for (let index = 0; index < conditionalNodes.length; index += 1) {
  const mark = geometry[index]!;
  assert.equal(mark.kind, "point");
  if (mark.kind === "point") assert.deepEqual(mark.point, tree.nodes[index]!.point);
}
tree.nodes.filter((node) => node.parent !== null).forEach((node, index) => {
  const mark = geometry[tree.nodes.length + index]!;
  assert.equal(mark.kind, "path");
  if (mark.kind === "path") assert.deepEqual(mark.points, [byId.get(node.parent!)!.point, node.point],
    "every branch joins its declared parent and child");
});
const transformed = deriveProbabilityTree({ nodes: conditionalNodes, origin: [4, -3], levelGap: 4, leafGap: 2 }, context);
transformed.nodes.forEach((node, index) => {
  near(node.point.x, 4 + 2 * tree.nodes[index]!.point.x, "explicit horizontal gap and origin");
  near(node.point.y, -3 + 2 * tree.nodes[index]!.point.y, "explicit vertical gap and origin");
  near(node.jointProbability, tree.nodes[index]!.jointProbability, "layout cannot alter probability");
});
assert.deepEqual(deriveProbabilityTree({ nodes: conditionalNodes }, context), tree, "repeat evaluation is deterministic");

const zeroNodes = [
  { id: "s", outcome: "Start" },
  { id: "no", outcome: "Impossible", parent: "s", probability: 0 },
  { id: "yes", outcome: "Certain", parent: "s", probability: 1 },
];
const zero = deriveProbabilityTree({ nodes: zeroNodes }, context);
assert.equal(zero.nodes[1]!.jointProbability, 0);
assert.equal(zero.nodes[2]!.jointProbability, 1);
assert.equal(zero.totalLeafProbability, 1);
assert.equal(evaluateProbabilityConstruction("probability_tree", { nodes: zeroNodes }, context).length, 7,
  "zero-probability supplied branches remain represented");

const tinyNodes = [
  { id: "s", outcome: "Start" },
  { id: "tiny", outcome: "Tiny", parent: "s", probability: Number.MIN_VALUE },
  { id: "other", outcome: "Other", parent: "s", probability: 1 },
];
assert.equal(deriveProbabilityTree({ nodes: tinyNodes }, context).nodes[1]!.jointProbability, Number.MIN_VALUE,
  "the smallest finite supplied probability remains positive");
assert.ok(probabilityTreeOutputLabels({ nodes: tinyNodes }, context).includes("P=5e-324"),
  "tiny nonzero probability labels use exponent notation and never display zero");
const thirds = [{ id: "s", outcome: "Start" }, ...["a", "b", "c"].map((id) => ({ id, outcome: id.toUpperCase(), parent: "s", probability: 1 / 3 }))];
assert.ok(probabilityTreeOutputLabels({ nodes: thirds }, context).includes("P≈0.33333333"),
  "rounded nonterminating values declare approximation in the label");
const capNodes: unknown[] = [{ id: "s", outcome: "Start" }];
for (let index = 0; index < 12; index += 1) {
  capNodes.push({ id: `a${index}`, outcome: "A", parent: "s", probability: 1 / 12 },
    { id: `b${index}`, outcome: "B", parent: `a${index}`, probability: 1 });
  if (index < 6) capNodes.push({ id: `c${index}`, outcome: "C", parent: `b${index}`, probability: 1 });
}
const capTree = deriveProbabilityTree({ nodes: capNodes }, context);
assert.equal(capTree.nodes.length, 31, "the exact documented node cap is accepted");
assert.equal(capTree.leafIds.length, 12, "the exact documented leaf cap is accepted");
near(capTree.totalLeafProbability, 1, "cap-sized tree retains complete probability mass");
assert.equal(evaluateProbabilityConstruction("probability_tree", { nodes: capNodes }, context).length, 73);

const stringNodes = conditionalNodes.map((node) => "probability" in node
  ? { ...node, probability: { value: String(node.probability) } } : node);
assert.deepEqual(deriveProbabilityTree({ nodes: stringNodes }, context), tree,
  "numeric strings and value wrappers match numeric probabilities exactly");
const explicitZeroStrings = zeroNodes.map((node) => "probability" in node && node.probability === 0 ? { ...node, probability: "-0e-400" } : node);
assert.deepEqual(deriveProbabilityTree({ nodes: explicitZeroStrings }, context), zero,
  "an explicitly zero mantissa remains a legitimate zero probability");
const tinyLiteralNodes = tinyNodes.map((node) => "probability" in node && node.probability === Number.MIN_VALUE ? { ...node, probability: "5e-324" } : node);
assert.equal(deriveProbabilityTree({ nodes: tinyLiteralNodes }, context).nodes[1]!.jointProbability, Number.MIN_VALUE,
  "a representable tiny numeric-string probability retains its nonzero value");

const quantityNodes = conditionalNodes.map((node, index) => "probability" in node
  ? { ...node, probability: { value: `p_${index}` } } : node);
const quantities = conditionalNodes.flatMap((node, index) => "probability" in node
  ? [{ id: `p_${index}`, value: { value: String(node.probability) } }] : []);
const invalid: Array<[string, Record<string, unknown>, string]> = [
  ["unknown input", { nodes: conditionalNodes, independent: true }, "invalid_probability_input"],
  ["empty tree", { nodes: [] }, "invalid_probability_nodes"],
  ["missing probability", { nodes: [{ id: "s", outcome: "Start" }, { id: "a", outcome: "A", parent: "s" }] }, "invalid_probability_value"],
  ["negative probability", { nodes: [{ id: "s", outcome: "Start" }, { id: "a", outcome: "A", parent: "s", probability: -1 }] }, "invalid_probability_value"],
  ["above one", { nodes: [{ id: "s", outcome: "Start" }, { id: "a", outcome: "A", parent: "s", probability: 1.01 }] }, "invalid_probability_value"],
  ["nonfinite probability", { nodes: [{ id: "s", outcome: "Start" }, { id: "a", outcome: "A", parent: "s", probability: Infinity }] }, "invalid_probability_value"],
  ["outgoing sum", { nodes: [{ id: "s", outcome: "Start" }, { id: "a", outcome: "A", parent: "s", probability: 0.4 }] }, "invalid_probability_sum"],
  ["invented complement", { nodes: [{ id: "s", outcome: "Start" }, { id: "a", outcome: "A", parent: "s", probability: 0.4 }, { id: "b", outcome: "B", parent: "s" }] }, "invalid_probability_value"],
  ["two roots", { nodes: [{ id: "s", outcome: "Start" }, { id: "a", outcome: "A" }] }, "invalid_probability_topology"],
  ["missing parent", { nodes: [{ id: "s", outcome: "Start" }, { id: "a", outcome: "A", parent: "missing", probability: 1 }] }, "invalid_probability_topology"],
  ["cyclic disconnected component", { nodes: [{ id: "s", outcome: "Start" }, { id: "a", outcome: "A", parent: "b", probability: 1 }, { id: "b", outcome: "B", parent: "a", probability: 1 }] }, "invalid_probability_topology"],
  ["multiple parents", { nodes: [{ id: "s", outcome: "Start" }, { id: "a", outcome: "A", parent: ["s", "b"], probability: 1 }] }, "invalid_probability_topology"],
  ["duplicate node ID", { nodes: [...zeroNodes, zeroNodes[1]] }, "invalid_probability_topology"],
  ["root weight is invented", { nodes: [{ id: "s", outcome: "Start", probability: 0.5 }, { id: "a", outcome: "A", parent: "s", probability: 1 }] }, "invalid_probability_value"],
  ["unknown quantity", { nodes: [{ id: "s", outcome: "Start" }, { id: "a", outcome: "A", parent: "s", probability: "missing" }] }, "invalid_probability_value"],
  ["quantityId wrapper", { nodes: [{ id: "s", outcome: "Start" }, { id: "a", outcome: "A", parent: "s", probability: { quantityId: "p_1" } }] }, "invalid_probability_value"],
  ["invented node fields", { nodes: [{ id: "s", outcome: "Start" }, { id: "a", outcome: "A", parent: "s", probability: 1, jointProbability: 0.5 }] }, "invalid_probability_nodes"],
  ["missing explicit outcome", { nodes: [{ id: "s", outcome: "Start" }, { id: "a", parent: "s", probability: 1 }] }, "invalid_probability_nodes"],
  ["nonfinite origin", { nodes: zeroNodes, origin: [0, Infinity] }, "invalid_probability_geometry"],
  ["zero level gap", { nodes: zeroNodes, levelGap: 0 }, "invalid_probability_geometry"],
  ["unbounded gap", { nodes: zeroNodes, leafGap: 1e20 }, "invalid_probability_geometry"],
  ["node cap", { nodes: [{ id: "s", outcome: "Start" }, ...Array.from({ length: 31 }, (_, index) => ({ id: `c${index}`, outcome: "C", parent: "s", probability: 1 / 31 }))] }, "invalid_probability_nodes"],
  ["leaf cap", { nodes: [{ id: "s", outcome: "Start" }, ...Array.from({ length: 13 }, (_, index) => ({ id: `c${index}`, outcome: "C", parent: "s", probability: 1 / 13 }))] }, "invalid_probability_topology"],
  ["depth cap", { nodes: Array.from({ length: 7 }, (_, index) => index === 0 ? { id: "c0", outcome: "Start" } : { id: `c${index}`, outcome: "C", parent: `c${index - 1}`, probability: 1 }) }, "invalid_probability_topology"],
  ["path product underflow", { nodes: [{ id: "s", outcome: "Start" }, { id: "a", outcome: "A", parent: "s", probability: 1e-200 }, { id: "b", outcome: "B", parent: "s", probability: 1 }, { id: "ay", outcome: "Y", parent: "a", probability: 1e-200 }, { id: "an", outcome: "N", parent: "a", probability: 1 }] }, "invalid_probability_value"],
  ["nonfinite numeric wrapper", { nodes: [{ id: "s", outcome: "Start" }, { id: "a", outcome: "A", parent: "s", probability: { value: NaN } }] }, "invalid_probability_value"],
  ["nonzero probability literal underflow", { nodes: [{ id: "s", outcome: "Start" }, { id: "a", outcome: "A", parent: "s", probability: "1e-400" }, { id: "b", outcome: "B", parent: "s", probability: 1 }] }, "invalid_probability_value"],
  ["negative probability literal underflow", { nodes: [{ id: "s", outcome: "Start" }, { id: "a", outcome: "A", parent: "s", probability: "-1e-400" }, { id: "b", outcome: "B", parent: "s", probability: 1 }] }, "invalid_probability_value"],
  ["wrapped probability literal underflow", { nodes: [{ id: "s", outcome: "Start" }, { id: "a", outcome: "A", parent: "s", probability: { value: { value: "1e-400" } } }, { id: "b", outcome: "B", parent: "s", probability: 1 }] }, "invalid_probability_value"],
];
for (const [name, inputs] of invalid) {
  assert.throws(() => evaluateProbabilityConstruction("probability_tree", inputs, context), undefined, name);
}

const annotationConflict = candidate(conditionalNodes);
annotationConflict.annotations.push({ id: "false_branch", kind: "label", targetIds: ["edge_by"], text: "p=0.8" });
const annotationIssues: import("../../src/types").SceneIssue[] = [];
validateProbabilityConstruction(annotationConflict.constructions[0]!, 0, annotationConflict, new Map(), annotationIssues);
assert.ok(annotationIssues.some((issue) => issue.code === "invalid_probability_label"),
  "an annotation must not override the verified conditional branch with invented independence");
const harmlessAnnotations = candidate(conditionalNodes);
harmlessAnnotations.annotations.push(
  { id: "same_branch", kind: "label", targetIds: ["edge_by"], text: "p=0.1" },
  { id: "trace_branch", kind: "trace", targetIds: ["edge_by"] },
  { id: "highlight_leaf", kind: "highlight", targetIds: ["node_ay"] },
);
const harmlessIssues: import("../../src/types").SceneIssue[] = [];
validateProbabilityConstruction(harmlessAnnotations.constructions[0]!, 0, harmlessAnnotations, new Map(), harmlessIssues);
assert.deepEqual(harmlessIssues, [], "correct canonical annotations and text-free emphasis preserve verified authority");
const percentQuantity = candidate(quantityNodes, {}, structuredClone(quantities));
percentQuantity.quantities[0]!.unit = "%";
const unitIssues: import("../../src/types").SceneIssue[] = [];
validateProbabilityConstruction(percentQuantity.constructions[0]!, 0, percentQuantity, new Map(), unitIssues);
assert.ok(unitIssues.some((issue) => issue.code === "invalid_probability_value"),
  "a percent-valued quantity cannot silently become a fractional probability");

const { compileSceneDocument, validateSceneDocument } = await import("../../src/index");
const compiled = compileValid(candidate(conditionalNodes));
for (const expected of ["p=0.3", "p=0.7", "P=0.24", "P=0.07", "P=0.63"]) {
  assert.ok(compiled.primitives.some((primitive) => primitive.kind === "label" && primitive.text === expected),
    `compiled tree keeps ${expected} grounded in computed weights`);
}
assert.ok(compiled.primitives.every((primitive) => primitive.points.every((point) =>
  Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 400 && point.x <= 1160 && point.y >= 0 && point.y <= 700)),
"live geometry remains inside the verified canvas zone");
compileValid(candidate(zeroNodes));
assert.deepEqual(compileValid(candidate(quantityNodes, {}, quantities)), compiled,
  "quantity IDs and wrapped quantity values compile like literals");
const absentLabels = candidate(conditionalNodes);
absentLabels.entities.forEach((entity) => { delete entity.label; });
const absentBefore = structuredClone(absentLabels);
assert.deepEqual(compileValid(absentLabels), compiled, "engine authors all probability labels when the planner omits them");
assert.deepEqual(absentLabels, absentBefore, "engine label derivation does not mutate the caller's scene document");
const nodeNamespaceCollision = candidate(conditionalNodes);
nodeNamespaceCollision.entities.push({ id: "a", kind: "point", role: "construction helper point" });
nodeNamespaceCollision.constructions.push({ id: "make_other_a", operator: "midpoint", inputs: { a: "node_start", b: "node_a" }, outputs: ["a"] });
const collisionCompiled = compileValid(nodeNamespaceCollision);
assert.ok(collisionCompiled.primitives.some((primitive) => primitive.text === "P=0.24"),
  "internal probability node ID a does not depend on an unrelated geometry output a that depends on the tree");
for (const [name, inputs, code] of invalid) {
  assertRejected(name, invalidCandidate(inputs), code);
}
assertRejected("false probability annotation", annotationConflict, "invalid_probability_label");
assertRejected("probabilities require fractional dimensionless quantities", percentQuantity, "invalid_probability_value");
const quantityAnnotation = candidate(conditionalNodes);
quantityAnnotation.quantities.push({ id: "wrong_weight", value: 0.8 });
quantityAnnotation.annotations.push({ id: "false_quantity", kind: "label", targetIds: ["edge_by"], quantityId: "wrong_weight" });
assertRejected("quantity annotation cannot replace a branch", quantityAnnotation, "invalid_probability_label");
const wrongLabel = candidate(conditionalNodes);
wrongLabel.entities.find((entity) => entity.id === "joint_ay")!.label = "P=0.8";
assertRejected("stale planner joint label", wrongLabel, "invalid_probability_label");
const wrongBranch = candidate(conditionalNodes);
wrongBranch.entities.find((entity) => entity.id === "edge_by")!.label = "p=0.8";
assertRejected("invented independence branch label", wrongBranch, "invalid_probability_label");
const wrongKind = candidate(conditionalNodes);
wrongKind.entities[0]!.kind = "polygon";
assertRejected("wrong output kind", wrongKind, "invalid_probability_output");
const wrongArity = candidate(conditionalNodes);
wrongArity.constructions[0]!.outputs.pop();
assertRejected("partial output arity", wrongArity, "invalid_probability_output");
const cyclicQuantity = candidate(conditionalNodes);
cyclicQuantity.constructions[0]!.inputs.nodes = quantityNodes;
cyclicQuantity.quantities = [{ id: "p_1", value: "p_1" }, ...quantities.slice(1)];
assertRejected("cyclic numeric quantity", cyclicQuantity, "invalid_probability_value");
const erasedQuantity = candidate(zeroNodes);
erasedQuantity.quantities.push({ id: "tiny_source", value: { value: "1e-400" }, unit: "1" }, { id: "tiny_alias", value: "tiny_source", unit: "1" });
erasedQuantity.constructions[0]!.inputs.nodes = zeroNodes.map((node) => "probability" in node && node.probability === 0 ? { ...node, probability: { value: "tiny_alias" } } : node);
const erasedQuantityIssues: import("../../src/types").SceneIssue[] = [];
validateProbabilityConstruction(erasedQuantity.constructions[0]!, 0, erasedQuantity, new Map(), erasedQuantityIssues);
assert.ok(erasedQuantityIssues.some((issue) => issue.code === "invalid_probability_value"), "the probability validator rejects underflow behind source quantity aliases and wrappers");
assertRejected("quantity-bound probability literal underflow", erasedQuantity, "invalid_probability_value");
for (const claimKind of ["entity", "annotation", "construction"] as const) {
  const falseZeroClaim = candidate(zeroNodes);
  if (claimKind === "entity") falseZeroClaim.entities.find((entity) => entity.id === "joint_no")!.label = "P=1e-400";
  else if (claimKind === "annotation") falseZeroClaim.annotations.push({ id: "false_zero_probability", kind: "label", targetIds: ["joint_no"], text: "P=1e-400" });
  else { falseZeroClaim.entities.push({ id: "false_zero_label", kind: "label", role: "false nonzero probability" }); falseZeroClaim.constructions.push({ id: "make_false_zero_label", operator: "label", inputs: { target: "joint_no", text: "P=1e-400" }, outputs: ["false_zero_label"] }); }
  assertRejected(`underflowed computed probability ${claimKind} claim`, falseZeroClaim, "invalid_probability_label");
}
compileValid(candidate(explicitZeroStrings));

console.log("probability operator verification passed: explicit conditional topology, path products, total probability, Bayes oracle, zero weights, source labels, bounds, quantity references, and fail-closed invalid trees");

function candidate(nodes: unknown[], extra: Record<string, unknown> = {}, quantities: SceneDocument["quantities"] = []): SceneDocument {
  const numericContext = { ...context, number: (value: unknown): number => {
    const quantity = quantities.find((entry) => entry.id === value);
    if (!quantity) return context.number(value);
    let resolved = quantity.value;
    for (let depth = 0; depth < 64 && typeof resolved === "object" && resolved !== null && "value" in resolved; depth += 1) resolved = resolved.value;
    return context.number(resolved);
  } };
  const inputs = { nodes, ...extra };
  const derived = deriveProbabilityTree(inputs, numericContext);
  const labels = probabilityTreeOutputLabels(inputs, numericContext);
  const ids = [...derived.nodes.map((node) => `node_${node.id}`),
    ...derived.nodes.filter((node) => node.parent !== null).map((node) => `edge_${node.id}`),
    ...derived.leafIds.map((id) => `joint_${id}`)];
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "explicit source-grounded probability tree" },
    source: { question: "A has probability 0.3 and B has probability 0.7; Y given A is 0.8 and Y given B is 0.1. Show the supplied branches." },
    quantities,
    entities: ids.map((id, index) => ({ id, kind: index < derived.nodes.length ? "point" : index < derived.nodes.length * 2 - 1 ? "polyline" : "label",
      role: index < derived.nodes.length ? "probability outcome" : index < derived.nodes.length * 2 - 1 ? "conditional probability branch" : "computed joint probability",
      label: labels[index], semantic: { keepLabel: true },
      ...(index >= derived.nodes.length * 2 - 1 ? { provenance: { pinLabel: true } } : {}),
    })),
    constructions: [{ id: "make_tree", operator: "probability_tree", inputs, outputs: ids }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "tree", entityIds: ids, dependsOn: [], narrationCue: "read the supplied conditional probabilities" }],
    teachingTimeline: [{ id: "show_tree", action: "reveal", targetId: "tree", dependsOn: [], narrationIntent: "multiply along each path" }],
  };
}
function invalidCandidate(inputs: Record<string, unknown>): SceneDocument {
  const document = candidate(zeroNodes);
  document.constructions[0]!.inputs = inputs;
  return document;
}
function compileValid(document: SceneDocument) {
  const validated = validateSceneDocument(document);
  assert.ok(validated.document, `structural acceptance: ${JSON.stringify(validated.report.issues)}`);
  const compiled = compileSceneDocument(validated.document!);
  assert.ok(compiled.ok && compiled.renderScene, `compile acceptance: ${JSON.stringify(compiled.report.issues)}`);
  return compiled.renderScene!;
}
function assertRejected(name: string, document: SceneDocument, code: string): void {
  const validated = validateSceneDocument(document);
  assert.equal(validated.document, null, `${name} must fail structural validation`);
  assert.ok(validated.report.issues.some((issue) => issue.code === code), `${name}: expected ${code}, got ${JSON.stringify(validated.report.issues)}`);
  const compiled = compileSceneDocument(document);
  assert.equal(compiled.ok, false, `${name} must fail compilation`);
  assert.equal(compiled.renderScene, null, `${name} must never leak partial geometry`);
}
function near(actual: number, expected: number, message: string): void {
  assert.ok(Math.abs(actual - expected) <= 1e-12, `${message}: expected ${expected}, got ${actual}`);
}
