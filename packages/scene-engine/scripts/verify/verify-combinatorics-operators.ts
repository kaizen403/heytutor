import assert from "node:assert/strict";
import { COMBINATORICS_OPERATORS, evaluateCombinatoricsConstruction, validateCombinatoricsConstruction, validateEvaluatedCombinatoricsLabels, combinatoricsGeometryLabel, type CombinatoricsEvaluationContext, type CombinatoricsGeometry } from "../../src/compile/combinatoricsGeometry";
import type { SceneConstruction, SceneDocument, SceneIssue } from "../../src/types";

const geometry = new Map<string, unknown>();
const quantities = new Map<string, number>([["first_image", 1], ["second_image", 0]]);
const context: CombinatoricsEvaluationContext = {
  number(value) { if (typeof value === "object" && value !== null && "value" in value) return context.number(value.value); const number = typeof value === "string" && quantities.has(value) ? quantities.get(value)! : Number(value); if (!Number.isFinite(number)) throw new Error("not finite"); return number; },
  point(value) { if (typeof value === "string") { const source = geometry.get(value); if (typeof source === "object" && source !== null && "point" in source) return source.point as { x: number; y: number }; } throw new Error("not an ordinary point"); },
  geometry(value) { return typeof value === "string" ? geometry.get(value) : undefined; },
};
let checks = 0;
function evaluate(operator: string, inputs: Record<string, unknown>): CombinatoricsGeometry[] { return evaluateCombinatoricsConstruction(operator, inputs, context); }
function reject(operator: string, inputs: Record<string, unknown>): void { assert.throws(() => evaluate(operator, inputs)); checks++; }
const source = { items: ["a", "b", "c", "d"], mapping: [1, 0, 2, 3], displayScale: 2, origin: [11, -7] };
const outputs = evaluate("permutation_cycles", source); assert.equal(outputs.length, 8); checks++;
assert.equal(outputs[0]!.combinatoricsGraph.kind, "permutation");
if (outputs[0]!.combinatoricsGraph.kind !== "permutation") throw new Error("permutation authority missing");
assert.deepEqual(outputs[0].combinatoricsGraph.cycles, [[0, 1], [2], [3]]); assert.deepEqual(outputs[0].combinatoricsGraph.inverse, [1, 0, 2, 3]); assert.equal(outputs[0].combinatoricsGraph.parity, -1); checks += 3;
outputs.slice(4).forEach((output, index) => { assert.equal(output.kind, "path"); if (output.kind !== "path") throw new Error("directed edge missing"); assert.deepEqual(output.points[0], outputs[index]!.kind === "point" ? outputs[index]!.point : null); const target = outputs[source.mapping[index]!]!; assert.equal(target.kind, "point"); if (target.kind !== "point") throw new Error("target node missing"); assert.deepEqual(output.points.at(-1), target.point); assert.equal(output.combinatoricsEdge.from, index); assert.equal(output.combinatoricsEdge.to, source.mapping[index]); checks += 4; });
function documentFor(): SceneDocument {
  const ids = Array.from({ length: 8 }, (_, index) => index < 4 ? `node${index}` : `edge${index - 4}`);
  return { schemaVersion: "scene-document/v2", source: {}, visualDecision: { mode: "scene", reason: "explicit permutation topology" }, quantities: [], entities: ids.map((id, index) => ({ id, kind: index < 4 ? "point" : "polyline", role: "nonmetric computed graph" })), constructions: [{ id: "permutation", operator: "permutation_cycles", inputs: structuredClone(source), outputs: ids }], relations: [], assertions: [], annotations: [], requiredEntityIds: ids, revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "show the supplied permutation cycles" }], teachingTimeline: [] };
}
function issuesFor(document: SceneDocument): SceneIssue[] { const issues: SceneIssue[] = []; const byOutput = new Map(document.constructions.flatMap((construction) => construction.outputs.map((id) => [id, construction] as const))); document.constructions.forEach((construction, index) => validateCombinatoricsConstruction(construction, index, document, byOutput, issues)); return issues; }
const wrongArity = documentFor(); wrongArity.constructions[0]!.outputs.pop(); assert(issuesFor(wrongArity).some((issue) => issue.severity === "fatal")); checks++;
const latticeInputs = { items: ["a", "b", "c"], selectionRank: 2, displayScale: 2, origin: [-12, 9] };
const lattice = evaluate("subset_lattice", latticeInputs); assert.equal(lattice.length, 20); const latticeDefinition = lattice[0]!.combinatoricsGraph; assert.equal(latticeDefinition.kind, "subset_lattice"); if (latticeDefinition.kind !== "subset_lattice") throw new Error("lattice source missing"); assert.deepEqual(latticeDefinition.rankCounts, [1, 3, 3, 1]); assert.equal(latticeDefinition.selectionCount, 3); checks += 3;
function mappings(values: number[]): number[][] { if (!values.length) return [[]]; return values.flatMap((value) => mappings(values.filter((candidate) => candidate !== value)).map((rest) => [value, ...rest])); }
for (let n = 1; n <= 5; n++) for (const mapping of mappings(Array.from({ length: n }, (_, index) => index))) {
  const items = Array.from({ length: n }, (_, index) => `p${index}`); const result = evaluate("permutation_cycles", { items, mapping, displayScale: 1 }); const definition = result[0]!.combinatoricsGraph; assert.equal(definition.kind, "permutation"); if (definition.kind !== "permutation") throw new Error("permutation missing");
  assert.equal(result.length, 2 * n); checks++;
  let inversions = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (mapping[i]! > mapping[j]!) inversions++;
  assert.equal(definition.parity, inversions % 2 ? -1 : 1); checks++;
  for (let item = 0; item < n; item++) {
    const expectedCycle: number[] = []; let target = item; do { expectedCycle.push(target); target = mapping[target]!; } while (target !== item);
    const cycle = definition.cycles.find((cycle) => cycle.includes(item))!; assert.equal(cycle.length, expectedCycle.length); assert(cycle.every((member) => expectedCycle.includes(member))); assert.equal(cycle[0], Math.min(...cycle)); assert.equal(mapping[definition.inverse[item]!]!, item); assert.equal(definition.inverse[mapping[item]!]!, item); checks += 5;
    const edge = result[n + item]!; assert.equal(edge.kind, "path"); if (edge.kind !== "path") throw new Error("edge missing"); assert.equal(edge.combinatoricsEdge.from, item); assert.equal(edge.combinatoricsEdge.to, mapping[item]); assert.deepEqual(edge.points[0], definition.nodePositions[item]); assert.deepEqual(edge.points.at(-1), definition.nodePositions[mapping[item]!]); checks += 4;
  }
}
const p = [1, 2, 0]; const q = [2, 0, 1]; const composed = p.map((image) => q[image]!); const composition = evaluate("permutation_cycles", { items: ["a", "b", "c"], mapping: composed, displayScale: 1 })[0]!.combinatoricsGraph;
assert.equal(composition.kind, "permutation"); if (composition.kind !== "permutation") throw new Error("composition missing"); assert.deepEqual(composition.cycles, [[0], [1], [2]]); checks++;
const identity = evaluate("permutation_cycles", { items: ["a", "b", "c"], mapping: [0, 1, 2], displayScale: 1 });
identity.slice(3).forEach((edge) => { assert.equal(edge.kind, "path"); if (edge.kind !== "path") throw new Error("selfloop missing"); assert.deepEqual(edge.points[0], edge.points.at(-1)); assert(edge.points.some((point) => Math.hypot(point.x - edge.points[0]!.x, point.y - edge.points[0]!.y) > 0.1)); checks += 2; });
const edge0 = outputs[4]!; const edge1 = outputs[5]!; if (edge0.kind !== "path" || edge1.kind !== "path") throw new Error("two-cycle arcs missing"); assert(Math.abs(edge0.points[Math.floor(edge0.points.length / 2)]!.y - edge1.points[Math.floor(edge1.points.length / 2)]!.y) > 1); checks++;
function allSubsets<T>(items: readonly T[]): T[][] { return items.reduce<T[][]>((subsets, item) => [...subsets, ...subsets.map((subset) => [...subset, item])], [[]]); }
for (let n = 0; n <= 4; n++) {
  const items = Array.from({ length: n }, (_, index) => `a${index}`); const expectedSubsets = allSubsets(items); const result = evaluate("subset_lattice", { items, displayScale: 1, selectionRank: n }); const definition = result[0]!.combinatoricsGraph; assert.equal(definition.kind, "subset_lattice"); if (definition.kind !== "subset_lattice") throw new Error("lattice missing");
  assert.equal(result.length, expectedSubsets.length + (n === 0 ? 0 : n * expectedSubsets.length / 2)); assert.equal(definition.totalSubsetCount, expectedSubsets.length); assert.equal(definition.selectionCount, 1); checks += 3;
  for (let index = 0; index < expectedSubsets.length; index++) {
    const node = result[index]!; assert.equal(node.kind, "point"); if (node.kind !== "point") throw new Error("subset node missing"); assert.deepEqual(node.combinatoricsNode.itemIndices.map((index) => items[index]), expectedSubsets[index]); assert.equal(node.combinatoricsNode.rank, expectedSubsets[index]!.length); assert.equal(node.combinatoricsNode.selected, expectedSubsets[index]!.length === n); assert.equal(definition.edges.filter((edge) => edge.from === index).length, n - expectedSubsets[index]!.length); assert.equal(definition.edges.filter((edge) => edge.to === index).length, expectedSubsets[index]!.length); checks += 5;
  }
  const expectedCovers: Array<[number, number, number]> = [];
  expectedSubsets.forEach((subset, from) => items.forEach((item, itemIndex) => { if (subset.includes(item)) return; const augmented = [...subset, item]; const to = expectedSubsets.findIndex((candidate) => candidate.length === augmented.length && candidate.every((member) => augmented.includes(member))); expectedCovers.push([from, to, itemIndex]); }));
  assert.deepEqual(definition.edges.map((edge) => [edge.from, edge.to, edge.addedItemIndex]), expectedCovers); checks++;
  for (let rank = 0; rank <= n; rank++) { assert.equal(definition.rankCounts[rank], expectedSubsets.filter((subset) => subset.length === rank).length); checks++; }
  result.slice(expectedSubsets.length).forEach((edge) => { assert.equal(edge.kind, "path"); if (edge.kind !== "path") throw new Error("cover edge missing"); const from = expectedSubsets[edge.combinatoricsEdge.from]!; const to = expectedSubsets[edge.combinatoricsEdge.to]!; assert.equal(to.length, from.length + 1); assert(from.every((item) => to.includes(item))); assert.deepEqual(edge.points[0], definition.nodePositions[edge.combinatoricsEdge.from]); assert.deepEqual(edge.points.at(-1), definition.nodePositions[edge.combinatoricsEdge.to]); checks += 4; });
}
for (const displayScale of [0.25, 1, 7]) for (const origin of [[0, 0], [77, -49]]) {
  const changed = evaluate("permutation_cycles", { ...source, displayScale, origin }); const base = evaluate("permutation_cycles", { ...source, displayScale: 1, origin: [0, 0] });
  changed.forEach((output, index) => { const sourceOutput = base[index]!; if (output.kind !== "point" || sourceOutput.kind !== "point") return; assert(Math.abs(output.point.x - origin[0]! - displayScale * sourceOutput.point.x) < 1e-10); assert(Math.abs(output.point.y - origin[1]! - displayScale * sourceOutput.point.y) < 1e-10); checks += 2; });
}
const priorSource = JSON.stringify(source); evaluate("permutation_cycles", source); assert.equal(JSON.stringify(source), priorSource); const priorLattice = JSON.stringify(latticeInputs); evaluate("subset_lattice", latticeInputs); assert.equal(JSON.stringify(latticeInputs), priorLattice); checks += 2;
const reordered = evaluate("permutation_cycles", { items: ["d", "b", "a", "c"], mapping: [0, 2, 1, 3], displayScale: 1 })[0]!.combinatoricsGraph;
assert.equal(reordered.kind, "permutation"); if (reordered.kind !== "permutation") throw new Error("reordered permutation missing");
assert.deepEqual(reordered.edges.map((edge) => `${reordered.items[edge.from]}→${reordered.items[edge.to]}`).sort(), ["a→b", "b→a", "c→c", "d→d"]); assert.equal(reordered.cycleCount, 3); checks += 2;
const maximumPermutation = evaluate("permutation_cycles", { items: ["a", "b", "c", "d", "e", "f", "g", "h"], mapping: [1, 2, 3, 4, 5, 6, 7, 0], displayScale: 1 })[0]!.combinatoricsGraph; assert.equal(maximumPermutation.kind, "permutation"); if (maximumPermutation.kind !== "permutation") throw new Error("maximum permutation missing"); assert.equal(maximumPermutation.permutationCount, 40320); assert.equal(maximumPermutation.cycleCount, 1); checks += 2;
const numbered = evaluate("permutation_cycles", { items: ["1", "2", "3"], mapping: [1, 2, 0], displayScale: 1 }); assert.equal(combinatoricsGeometryLabel(numbered[0]), "1"); checks++;
for (const mapping of [[0, 0, 2, 3], [1, 0, 2], [1, 0, 2, 4], [1, 0, 2, -1], [1, 0, 2, 2.5], [1, 0, 2, true], [1, 0, 2, null], [1, 0, 2, " "], [1, 0, 2, "1e-999"], undefined]) reject("permutation_cycles", { ...source, mapping });
for (const items of [[], ["a", "a"], [""], ["a=99"], [1, 2], Array.from({ length: 9 }, (_, index) => `a${index}`)]) reject("permutation_cycles", { ...source, items });
for (const rank of [-1, 4, 0.5, null, true, Infinity, "1e-999"]) reject("subset_lattice", { ...latticeInputs, selectionRank: rank });
reject("subset_lattice", { ...latticeInputs, items: ["a", "b", "c", "d", "e"] }); reject("subset_lattice", { ...latticeInputs, probability: 0.5 });
for (const scale of [undefined, 0, 1e-14, 1e10, true, "1e-999", { value: 2, unit: "m" }]) reject("permutation_cycles", { ...source, displayScale: scale });
reject("permutation_cycles", { ...source, mapping: [{ value: 1, unit: "V" }, 0, 2, 3] }); reject("permutation_cycles", { ...source, origin: [1e12, 0], displayScale: 1e-3 });
for (const key of ["space", "setAtom", "magneticForce", "futurePhysicsMetadata"]) { geometry.set("protected_origin", { kind: "point", point: { x: 0, y: 0 }, [key]: {} }); reject("permutation_cycles", { ...source, origin: "protected_origin" }); }
evaluate("permutation_cycles", { items: ["a", "b"], mapping: ["first_image", { value: "second_image", unit: "1" }], displayScale: 1 }); checks++;
const invalidDocuments: SceneDocument[] = [wrongArity];
function malformed(change: (document: SceneDocument) => void): void { const document = documentFor(); change(document); invalidDocuments.push(document); assert(issuesFor(document).some((issue) => issue.severity === "fatal")); checks++; }
malformed((document) => { document.entities[0]!.kind = "label"; });
malformed((document) => { document.constructions[0]!.outputs[1] = "node0"; });
malformed((document) => { document.constructions[0]!.inputs.mapping = [0, 0, 2, 3]; });
malformed((document) => { document.constructions[0]!.inputs.mapping = [1, 0, 2, "missing_quantity"]; });
malformed((document) => { document.quantities.push({ id: "cycle_a", value: "cycle_b", unit: "1" }, { id: "cycle_b", value: "cycle_a", unit: "1" }); document.constructions[0]!.inputs.mapping = [1, 0, 2, "cycle_a"]; });
malformed((document) => { document.quantities.push({ id: "physical", value: 3, unit: "m" }); document.constructions[0]!.inputs.mapping = [1, 0, 2, "physical"]; });
malformed((document) => { document.constructions[0]!.inputs.origin = "node0"; });
malformed((document) => { document.entities[0]!.label = "cycles=999"; });
malformed((document) => { document.entities[0]!.label = "4!=999"; });
malformed((document) => { document.entities[0]!.label = "3!=24"; });
malformed((document) => { document.entities[4]!.label = "probability=1"; });
for (const kind of ["label", "callout", "badge", "brace", "narration"]) malformed((document) => { document.annotations.push({ id: "false_count", kind, targetIds: ["node0"], text: "cycles=999" }); });
malformed((document) => { document.quantities.push({ id: "false_quantity", symbol: "cycles", value: 999, unit: "1" }); document.annotations.push({ id: "false_quantity_label", kind: "label", targetIds: ["node0"], quantityId: "false_quantity" }); });
const exactLabels = documentFor(); exactLabels.entities[0]!.label = "cycles=3"; exactLabels.entities[1]!.label = "4!=24"; exactLabels.quantities.push({ id: "cycle_count", symbol: "cycles", value: 3, unit: "1" }); exactLabels.annotations.push({ id: "source_cycle_count", kind: "callout", targetIds: ["node2"], quantityId: "cycle_count" }); assert.deepEqual(issuesFor(exactLabels), []); checks++;
assert.equal(combinatoricsGeometryLabel(outputs[0]), "a"); assert.equal(combinatoricsGeometryLabel(outputs[4]), null); assert.equal(combinatoricsGeometryLabel(lattice[0]), "∅"); checks += 3;
const runtimeIssues: SceneIssue[] = []; const falseDocument = documentFor(); falseDocument.entities[0]!.label = "cycles=999"; validateEvaluatedCombinatoricsLabels(falseDocument.constructions[0]!, 0, falseDocument, outputs, runtimeIssues); assert(runtimeIssues.some((issue) => issue.severity === "fatal")); checks++;
function latticeDocument(items = ["a", "b", "c"], selectionRank?: number): SceneDocument {
  const source = { items, displayScale: 1, ...(selectionRank !== undefined ? { selectionRank } : {}) }; const sourceOutputs = evaluate("subset_lattice", source); const nodeCount = 1 << items.length; const ids = sourceOutputs.map((_, index) => index < nodeCount ? `subset${index}` : `cover${index - nodeCount}`);
  return { schemaVersion: "scene-document/v2", source: {}, visualDecision: { mode: "scene", reason: "explicit finite source subsets and cover relations" }, quantities: [], entities: ids.map((id, index) => ({ id, kind: index < nodeCount ? "point" : "polyline", role: "nonmetric Boolean lattice object" })), constructions: [{ id: "lattice", operator: "subset_lattice", inputs: source, outputs: ids }], relations: [], assertions: [], annotations: [], requiredEntityIds: ids, revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "reveal the computed finite subset lattice" }], teachingTimeline: [] };
}
const correctLattice = latticeDocument(["a", "b", "c", "d"], 2); correctLattice.entities[0]!.label = "C(4,2)=6"; correctLattice.entities[1]!.label = "subsets=16"; correctLattice.entities[3]!.label = "rank=2"; correctLattice.quantities.push({ id: "rank_count", symbol: "C(n,2)", value: 6, unit: "1" }); correctLattice.annotations.push({ id: "known_rank_count", kind: "callout", targetIds: ["subset2"], quantityId: "rank_count" }); assert.deepEqual(issuesFor(correctLattice), []); checks++;
for (const label of ["C(4,2)=999", "C(3,2)=6", "C(4,5)=0", "subsets=999", "rank=999", "probability=1", "degree=2", "edges=32 m"]) { const document = latticeDocument(["a", "b", "c", "d"], 2); document.entities[0]!.label = label; assert(issuesFor(document).some((issue) => issue.severity === "fatal"), label); invalidDocuments.push(document); checks++; }
const unknownRank = latticeDocument(["a", "b"]); unknownRank.entities[0]!.label = "C(n,r)=1"; assert(issuesFor(unknownRank).some((issue) => issue.severity === "fatal")); invalidDocuments.push(unknownRank); checks++;
const symbolicFactorial = documentFor(); symbolicFactorial.entities[0]!.label = "4!"; assert.deepEqual(issuesFor(symbolicFactorial), []); checks++;
const numberedDocument = documentFor(); numberedDocument.constructions[0]!.inputs.items = ["1", "2", "3", "4"]; assert.deepEqual(issuesFor(numberedDocument), []); checks++;
if (!process.argv.includes("--unit-only")) {
  const { compileSceneDocument } = await import("../../src/compile/compiler");
  for (const document of [documentFor(), exactLabels, numberedDocument, latticeDocument([]), latticeDocument(["a", "b", "c"]), correctLattice, symbolicFactorial]) { const before = JSON.stringify(document); const result = compileSceneDocument(document); assert.equal(result.ok, true, JSON.stringify(result.report.issues)); assert(result.renderScene); assert.equal(JSON.stringify(document), before, "source documents remain immutable during evaluation/layout"); checks += 2; }
  for (const document of invalidDocuments) { const result = compileSceneDocument(document); assert.equal(result.ok, false); assert.equal(result.renderScene, null); checks++; }
  for (const predicate of ["path_exists", "node_degree", "series_path", "connected", "distance_ratio", "angle_between"]) for (const expected of [true, false]) { const document = documentFor(); document.assertions.push({ id: "forbidden_inference", predicate, entities: ["node0", "node1"], expected, severity: "fatal" }); const result = compileSceneDocument(document); assert.equal(result.ok, false, predicate); assert.equal(result.renderScene, null); checks++; }
  for (const [operator, inputs, kind] of [["translate", { point: "node0", vector: [1, 0] }, "point"], ["dimension", { start: "node0", end: "node1" }, "dimension"], ["circle_from_three_points", { a: "node0", b: "node2", c: "node3" }, "circle"]] as const) { const document = documentFor(); const construction: SceneConstruction = { id: "forbidden_mark", operator, inputs, outputs: ["metric_mark"] }; document.constructions.push(construction); document.entities.push({ id: "metric_mark", kind, role: "forbidden nonmetric laundering" }); document.requiredEntityIds.push("metric_mark"); document.revealGroups[0]!.entityIds.push("metric_mark"); const result = compileSceneDocument(document); assert.equal(result.ok, false); assert.equal(result.renderScene, null); checks++; }
}
assert.deepEqual([...COMBINATORICS_OPERATORS], ["permutation_cycles", "subset_lattice"]);
console.log(`combinatorics operators verified: ${checks} exact graph/count checks`);
