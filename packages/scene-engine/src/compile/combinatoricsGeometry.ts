import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const COMBINATORICS_OPERATORS = ["permutation_cycles", "subset_lattice"] as const;
interface CombinatoricsGraphBase {
  items: string[]; origin: RenderPoint; displayScale: number; nodePositions: RenderPoint[];
  edges: Array<{ from: number; to: number; addedItemIndex?: number }>; nonmetric: true;
}
export interface PermutationGraphDefinition extends CombinatoricsGraphBase {
  kind: "permutation"; mapping: number[]; inverse: number[]; cycles: number[][];
  cycleCount: number; permutationCount: number; parity: 1 | -1;
}
export interface SubsetLatticeDefinition extends CombinatoricsGraphBase {
  kind: "subset_lattice"; ranks: number[]; rankCounts: number[]; totalSubsetCount: number;
  selectionRank: number | null; selectionCount: number | null;
}
export type CombinatoricsGraphDefinition = PermutationGraphDefinition | SubsetLatticeDefinition;
export interface CombinatoricsNodeDefinition { index: number; itemIndices: number[]; name: string; mask?: number; rank?: number; selected?: boolean }
export interface CombinatoricsEdgeDefinition { index: number; from: number; to: number; addedItemIndex?: number }
export interface CombinatoricsEvaluationContext { number(value: unknown): number; point(value: unknown): RenderPoint; geometry(value: unknown): unknown }
export type CombinatoricsGeometry =
  | { kind: "point"; point: RenderPoint; combinatoricsGraph: CombinatoricsGraphDefinition; combinatoricsNode: CombinatoricsNodeDefinition }
  | { kind: "path"; points: RenderPoint[]; directed: true; combinatoricsGraph: CombinatoricsGraphDefinition; combinatoricsEdge: CombinatoricsEdgeDefinition };
const INPUT_KEYS: Readonly<Record<string, readonly string[]>> = { permutation_cycles: ["items", "mapping", "origin", "displayScale"], subset_lattice: ["items", "selectionRank", "origin", "displayScale"] };
const MAX_VALUE = 1e12;
const MIN_DISPLAY = 1e-6;
class CombinatoricsInputError extends Error { constructor(readonly key: string, message: string) { super(message); } }
class DeferredCombinatoricsGeometry extends Error {}
function fail(key: string, message: string): never { throw new CombinatoricsInputError(key, message); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fields(value: Record<string, unknown>, allowed: readonly string[], key = "fields"): void { if (Object.keys(value).some((name) => !allowed.includes(name))) fail(key, "combinatorics construction contains unsupported fields"); }
function finite(value: number, key: string): number { if (!Number.isFinite(value) || Math.abs(value) > MAX_VALUE) fail(key, `${key} must remain finite with magnitude no greater than ${MAX_VALUE}`); return value === 0 ? 0 : value; }
function preserveLiteral(value: unknown, key: string): void {
  if (typeof value !== "string") return;
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:e[+-]?\d+)?$/i.exec(value.trim());
  if (match && Number(value) === 0 && /[1-9]/.test(match[1]!)) fail(key, "nonzero combinatorics values cannot underflow to certified zero");
}
function units(value: unknown, document?: SceneDocument, seen = new Set<unknown>(), depth = 0): void {
  if (depth > 32 || seen.has(value)) fail("units", "combinatorics source units are cyclic or exceed depth32");
  const source = typeof value === "string" ? document?.quantities.find((quantity) => quantity.id === value) : record(value) ? value : undefined;
  if (!source) return; seen.add(value);
  if (source.unit !== undefined && (typeof source.unit !== "string" || !["1", "unit", "units", "unitless", "dimensionless", "scalar"].includes(source.unit.trim().toLowerCase()))) fail("units", "combinatorics indices, ranks, and diagram coordinates must remain dimensionless");
  if ("value" in source) units(source.value, document, seen, depth + 1);
}
function scalar(value: unknown, key: string, context: CombinatoricsEvaluationContext, depth = 0): number {
  if (depth > 32) fail(key, "combinatorics scalar wrappers exceed depth32");
  if (record(value)) { fields(value, ["value", "unit"], key); units(value); return scalar(value.value, key, context, depth + 1); }
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) fail(key, "combinatorics values require finite numeric literals or quantity references"); preserveLiteral(value, key);
  try { return finite(context.number(value), key); } catch (error) { if (error instanceof CombinatoricsInputError) throw error; return fail(key, "combinatorics numeric source cannot be resolved"); }
}
function origin(value: unknown, context: CombinatoricsEvaluationContext): RenderPoint {
  if (value === undefined) return { x: 0, y: 0 };
  if (Array.isArray(value) && value.length === 2) return { x: scalar(value[0], "origin.x", context), y: scalar(value[1], "origin.y", context) };
  if (record(value) && "x" in value && "y" in value) { fields(value, ["x", "y"], "origin"); return { x: scalar(value.x, "origin.x", context), y: scalar(value.y, "origin.y", context) }; }
  if (typeof value !== "string" || !value.trim()) fail("origin", "graph origin requires an inline or constructed ordinary planar point");
  const geometry = context.geometry(value); if (!record(geometry) || geometry.kind !== "point" || Object.keys(geometry).some((name) => !["kind", "point"].includes(name))) fail("origin", "graph placement cannot reuse physical, world, or nonmetric graph metadata");
  try { const point = context.point(value); return { x: finite(point.x, "origin"), y: finite(point.y, "origin") }; }
  catch (error) { if (error instanceof CombinatoricsInputError || error instanceof DeferredCombinatoricsGeometry) throw error; return fail("origin", "graph origin must resolve to finite ordinary planar coordinates"); }
}
function items(value: unknown, minimum: number, maximum: number): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum || value.some((item) => typeof item !== "string" || !/^[A-Za-z0-9_]{1,4}$/.test(item)) || new Set(value).size !== value.length) fail("items", `graph items must be ${minimum} to ${maximum} unique short identifiers`); return [...value] as string[];
}
function graphSource(operator: string, inputs: Record<string, unknown>, context: CombinatoricsEvaluationContext): { items: string[]; mapping?: number[]; selectionRank?: number | null } {
  const sourceItems = items(inputs.items, operator === "permutation_cycles" ? 1 : 0, operator === "permutation_cycles" ? 8 : 4);
  if (operator === "permutation_cycles") {
    if (!Array.isArray(inputs.mapping) || inputs.mapping.length !== sourceItems.length) fail("mapping", "permutation mapping must explicitly contain one image index per source item");
    const mapping = inputs.mapping.map((value) => scalar(value, "mapping", context));
    if (mapping.some((value) => !Number.isInteger(value) || value < 0 || value >= sourceItems.length) || new Set(mapping).size !== mapping.length) fail("mapping", "permutation mapping must be a bijection over zero-based supplied item indices"); return { items: sourceItems, mapping };
  }
  const selectionRank = inputs.selectionRank === undefined ? null : scalar(inputs.selectionRank, "selectionRank", context);
  if (selectionRank !== null && (!Number.isInteger(selectionRank) || selectionRank < 0 || selectionRank > sourceItems.length)) fail("selectionRank", "selected subset rank must be an integer from0 through the number of source items"); return { items: sourceItems, selectionRank };
}
function factorial(n: number): number { let result = 1; for (let index = 2; index <= n; index++) result *= index; return result; }
function popcount(mask: number): number { let rank = 0; for (let bits = mask; bits; bits &= bits - 1) rank++; return rank; }
function unitCircle(numerator: number, denominator: number): RenderPoint {
  const quarter = 4 * numerator / denominator;
  if (Number.isInteger(quarter)) return [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }][(quarter % 4 + 4) % 4]!;
  const angle = 2 * Math.PI * numerator / denominator; return { x: Math.cos(angle), y: Math.sin(angle) };
}
/** Geometry certifies graph incidence only; its distances and areas carry no combinatorial meaning. */
export function evaluateCombinatoricsConstruction(operator: string, inputs: Record<string, unknown>, context: CombinatoricsEvaluationContext): CombinatoricsGeometry[] {
  const allowed = INPUT_KEYS[operator]; if (!allowed) fail("operator", `unsupported combinatorics operator ${operator}`); fields(inputs, allowed);
  const source = graphSource(operator, inputs, context); const at = origin(inputs.origin, context); const displayScale = scalar(inputs.displayScale, "displayScale", context);
  if (!(displayScale > MIN_DISPLAY) || displayScale > 1e9) fail("displayScale", "graph displayScale must be explicit, visible, positive, and no greater than1e9");
  const place = (point: RenderPoint): RenderPoint => {
    const dx = point.x * displayScale; const dy = point.y * displayScale; const result = { x: finite(at.x + dx, "display"), y: finite(at.y + dy, "display") };
    if (Math.hypot(result.x - at.x - dx, result.y - at.y - dy) > displayScale * 1e-8) fail("precision", "graph placement cannot retain its normalized source incidence"); return result;
  };
  const nodeDefinitions: CombinatoricsNodeDefinition[] = []; const localPositions: RenderPoint[] = []; const edgePoints: RenderPoint[][] = [];
  let graph: CombinatoricsGraphDefinition;
  if (operator === "permutation_cycles") {
    const mapping = source.mapping!; const inverse: number[] = []; const cycles: number[][] = []; const visited = new Set<number>();
    for (let start = 0; start < mapping.length; start++) {
      inverse[mapping[start]!] = start; if (visited.has(start)) continue;
      const cycle: number[] = []; let item = start;
      do { if (visited.has(item) || cycle.length >= mapping.length) fail("mapping", "permutation does not close a certified directed cycle"); cycle.push(item); visited.add(item); item = mapping[item]!; } while (item !== start);
      cycles.push(cycle);
    }
    cycles.forEach((cycle, cycleIndex) => {
      const center = { x: 4 * (cycleIndex - (cycles.length - 1) / 2), y: 0 };
      cycle.forEach((item, order) => {
        const unit = cycle.length === 1 ? { x: 0, y: 0 } : unitCircle(order, cycle.length); const point = { x: center.x + unit.x, y: center.y + unit.y };
        localPositions[item] = point; nodeDefinitions[item] = { index: item, itemIndices: [item], name: source.items[item]! };
      });
      cycle.forEach((item, order) => {
        const points: RenderPoint[] = []; const segments = cycle.length === 1 ? 24 : Math.max(4, Math.ceil(24 / cycle.length));
        for (let step = 0; step <= segments; step++) {
          if (step === 0) { points.push(place(localPositions[item]!)); continue; }
          if (step === segments) { points.push(place(localPositions[mapping[item]!]!)); continue; }
          const unit = cycle.length === 1 ? unitCircle(step - 6, 24) : unitCircle(order * segments + step, cycle.length * segments);
          points.push(place(cycle.length === 1 ? { x: center.x + 0.65 * unit.x, y: center.y + 0.65 + 0.65 * unit.y } : { x: center.x + unit.x, y: center.y + unit.y }));
        }
        edgePoints[item] = points;
      });
    });
    graph = { kind: "permutation", items: source.items, mapping, inverse, cycles, cycleCount: cycles.length, permutationCount: factorial(source.items.length), parity: (source.items.length - cycles.length) % 2 ? -1 : 1, origin: at, displayScale, nodePositions: localPositions.map(place), edges: mapping.map((to, from) => ({ from, to })), nonmetric: true };
  } else {
    const size = 1 << source.items.length; const ranks = Array.from({ length: size }, (_, mask) => popcount(mask)); const rankCounts = Array.from({ length: source.items.length + 1 }, (_, rank) => ranks.filter((value) => value === rank).length);
    for (let mask = 0; mask < size; mask++) {
      const rank = ranks[mask]!; const peers = ranks.map((value, mask) => ({ value, mask })).filter((entry) => entry.value === rank); const order = peers.findIndex((entry) => entry.mask === mask);
      localPositions[mask] = { x: 2 * (order - (peers.length - 1) / 2), y: 2.5 * rank };
      const indices = source.items.map((_, index) => index).filter((index) => mask & 1 << index); const name = indices.length ? `{${indices.map((index) => source.items[index]).join(",")}}` : "∅";
      nodeDefinitions[mask] = { index: mask, mask, rank, itemIndices: indices, name, ...(source.selectionRank !== null ? { selected: rank === source.selectionRank } : {}) };
    }
    const edges: Array<{ from: number; to: number; addedItemIndex: number }> = [];
    for (let mask = 0; mask < size; mask++) for (let index = 0; index < source.items.length; index++) if (!(mask & 1 << index)) {
      const to = mask | 1 << index; const fromPoint = localPositions[mask]!; const toPoint = localPositions[to]!; edges.push({ from: mask, to, addedItemIndex: index });
      // Adjacent-rank ports keep the source incidence exact and leave label
      // space beside every vertex; bends never introduce additional vertices.
      edgePoints.push([place(fromPoint), place({ x: fromPoint.x, y: fromPoint.y + 0.55 }), place({ x: toPoint.x, y: toPoint.y - 0.55 }), place(toPoint)]);
    }
    graph = { kind: "subset_lattice", items: source.items, ranks, rankCounts, totalSubsetCount: size, selectionRank: source.selectionRank!, selectionCount: source.selectionRank === null ? null : rankCounts[source.selectionRank!]!, origin: at, displayScale, nodePositions: localPositions.map(place), edges, nonmetric: true };
  }
  for (let index = 0; index < graph.nodePositions.length; index++) for (let next = index + 1; next < graph.nodePositions.length; next++) if (Math.hypot(graph.nodePositions[index]!.x - graph.nodePositions[next]!.x, graph.nodePositions[index]!.y - graph.nodePositions[next]!.y) <= MIN_DISPLAY) fail("precision", "distinct graph vertices collapse at display precision");
  const outputs: CombinatoricsGeometry[] = graph.nodePositions.map((point, index) => ({ kind: "point", point, combinatoricsGraph: graph, combinatoricsNode: nodeDefinitions[index]! }));
  graph.edges.forEach((edge, index) => {
    const points = edgePoints[index]!;
    if (points.length < 2 || !points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) || points[0]!.x !== graph.nodePositions[edge.from]!.x || points[0]!.y !== graph.nodePositions[edge.from]!.y || points.at(-1)!.x !== graph.nodePositions[edge.to]!.x || points.at(-1)!.y !== graph.nodePositions[edge.to]!.y) fail("precision", "graph edge endpoints contradict their computed source incidence");
    outputs.push({ kind: "path", points, directed: true, combinatoricsGraph: graph, combinatoricsEdge: { index, ...edge } });
  }); return outputs;
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  if (depth > 32 || seen.has(value)) fail("scalar", "combinatorics numeric sources are cyclic or exceed depth32");
  if (typeof value === "number") return finite(value, "scalar");
  if (record(value)) { fields(value, ["value", "unit"], "scalar"); seen.add(value); return validationNumber(value.value, document, seen, depth + 1); }
  if (typeof value !== "string" || !value.trim()) fail("scalar", "combinatorics scalar requires a finite numeric source");
  const quantities = document.quantities.filter((quantity) => quantity.id === value); if (quantities.length > 1) fail("scalar", "combinatorics numeric reference is ambiguous");
  if (quantities.length === 1) { seen.add(value); return validationNumber(quantities[0]!.value, document, seen, depth + 1); }
  preserveLiteral(value, "scalar"); return finite(Number(value), "scalar");
}
function pointProducer(id: unknown, document: SceneDocument, byOutput: Map<string, SceneConstruction>): SceneConstruction {
  if (typeof id !== "string" || !id.trim()) fail("origin", "graph origin requires one constructed point id");
  const entities = document.entities.filter((entity) => entity.id === id); const producers = document.constructions.filter((construction) => construction.outputs.includes(id)); const producer = byOutput.get(id);
  if (entities.length !== 1 || entities[0]!.kind !== "point" || producers.length !== 1 || !producer || producer !== producers[0]) fail("origin", "graph origin must be an unambiguous constructed point"); return producer;
}
/** Graph topology is fully recomputed; unknown derived origins are never replaced with guessed coordinates. */
export function validateCombinatoricsConstruction(construction: SceneConstruction, index: number, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>, issues: SceneIssue[]): void {
  if (!(COMBINATORICS_OPERATORS as readonly string[]).includes(construction.operator)) return;
  const context: CombinatoricsEvaluationContext = {
    number: (value) => validationNumber(value, document),
    point(value) { const geometry = context.geometry(value); if (!record(geometry) || !record(geometry.point) || typeof geometry.point.x !== "number" || typeof geometry.point.y !== "number") fail("origin", "graph origin must resolve to a planar point"); return { x: geometry.point.x, y: geometry.point.y }; },
    geometry(value) {
      const producer = pointProducer(value, document, constructionByOutput);
      if (producer === construction) fail("origin", "graph origin cannot reference its own nonmetric output");
      if (producer.operator !== "point") throw new DeferredCombinatoricsGeometry();
      units(producer.inputs.x, document); units(producer.inputs.y, document);
      return { kind: "point", point: { x: validationNumber(producer.inputs.x, document), y: validationNumber(producer.inputs.y, document) } };
    },
  };
  try {
    const { inputs, operator } = construction; if (!record(inputs)) fail("inputs", "combinatorics inputs must be an object"); fields(inputs, INPUT_KEYS[operator]!);
    if (Array.isArray(inputs.mapping)) inputs.mapping.forEach((value) => units(value, document));
    for (const key of ["selectionRank", "displayScale"]) if (inputs[key] !== undefined) units(inputs[key], document);
    const source = graphSource(operator, inputs, context); const nodeCount = operator === "permutation_cycles" ? source.items.length : 1 << source.items.length;
    const edgeCount = operator === "permutation_cycles" ? source.items.length : source.items.length === 0 ? 0 : source.items.length * (1 << source.items.length - 1);
    const arity = nodeCount + edgeCount;
    if (!Array.isArray(construction.outputs) || construction.outputs.length !== arity || construction.outputs.some((id) => typeof id !== "string" || !id.trim()) || new Set(construction.outputs).size !== arity) fail("outputs", `${operator} requires exactly ${arity} distinct outputs: ${nodeCount} points then ${edgeCount} directed polylines`);
    construction.outputs.forEach((id, outputIndex) => {
      const entities = document.entities.filter((entity) => entity.id === id); const producers = document.constructions.filter((candidate) => candidate.outputs.includes(id));
      if (entities.length !== 1 || entities[0]!.kind !== (outputIndex < nodeCount ? "point" : "polyline") || producers.length !== 1 || producers[0] !== construction || constructionByOutput.get(id) !== construction) fail("outputs", "graph outputs must be unambiguous points followed by directed polylines");
    });
    const scale = scalar(inputs.displayScale, "displayScale", context); if (!(scale > MIN_DISPLAY) || scale > 1e9) fail("displayScale", "graph scale must remain visible, positive, and no greater than1e9");
    if (typeof inputs.origin === "string") pointProducer(inputs.origin, document, constructionByOutput);
    else if (inputs.origin !== undefined) { const coordinates = Array.isArray(inputs.origin) && inputs.origin.length === 2 ? inputs.origin : record(inputs.origin) && "x" in inputs.origin && "y" in inputs.origin ? [inputs.origin.x, inputs.origin.y] : null; if (!coordinates) fail("origin", "graph origin requires two display coordinates"); coordinates.forEach((coordinate) => units(coordinate, document)); origin(inputs.origin, context); }
    const outputs = evaluateCombinatoricsConstruction(operator, inputs, context); validateEvaluatedCombinatoricsLabels(construction, index, document, outputs, issues);
  } catch (error) {
    if (error instanceof DeferredCombinatoricsGeometry) return; const key = error instanceof CombinatoricsInputError ? error.key : "inputs";
    issues.push({ code: `invalid_${construction.operator}_${key}`, severity: "fatal", message: error instanceof Error ? error.message : "invalid combinatorics graph", path: `constructions[${index}].${key === "outputs" ? key : `inputs.${key}`}`, entityIds: construction.outputs });
  }
}
function graphGeometry(value: unknown): { graph: CombinatoricsGraphDefinition; node?: CombinatoricsNodeDefinition; edge?: CombinatoricsEdgeDefinition } | null {
  if (!record(value) || !record(value.combinatoricsGraph) || value.combinatoricsGraph.nonmetric !== true || !["permutation", "subset_lattice"].includes(String(value.combinatoricsGraph.kind)) || !Array.isArray(value.combinatoricsGraph.items) || !Array.isArray(value.combinatoricsGraph.nodePositions) || !Array.isArray(value.combinatoricsGraph.edges)) return null;
  return { graph: value.combinatoricsGraph as unknown as CombinatoricsGraphDefinition, ...(record(value.combinatoricsNode) ? { node: value.combinatoricsNode as unknown as CombinatoricsNodeDefinition } : {}), ...(record(value.combinatoricsEdge) ? { edge: value.combinatoricsEdge as unknown as CombinatoricsEdgeDefinition } : {}) };
}
export function combinatoricsGeometryLabel(geometry: unknown, requestedText?: string): string | null {
  const value = graphGeometry(geometry); if (!value) return null;
  if (typeof requestedText === "string" && requestedText.trim() && requestedText.length <= 16) return requestedText;
  if (!value.node) return null;
  if (value.graph.kind === "subset_lattice" && value.graph.items.length === 4 && value.node.mask !== 0) return `M${value.node.mask}`;
  return value.node.name.length <= 16 ? value.node.name : `M${value.node.mask}`;
}
function claimValue(symbol: string, value: NonNullable<ReturnType<typeof graphGeometry>>): number | null {
  const { graph, node } = value; const n = graph.items.length; const normalized = symbol.replace(/\s/g, ""); const lower = normalized.toLowerCase();
  if (["n", "items", "item_count"].includes(lower)) return n;
  if (["nodes", "vertices", "node_count"].includes(lower)) return graph.nodePositions.length;
  if (["edges", "edge_count"].includes(lower)) return graph.edges.length;
  if (lower === "index") return node?.index ?? value.edge?.index ?? null;
  if (graph.kind === "permutation") {
    if (["cycles", "cycle_count", "c"].includes(lower)) return graph.cycleCount;
    if (["n!", "factorial", "permutations"].includes(lower)) return graph.permutationCount;
    const factorialClaim = /^(\d+)!$/.exec(normalized); if (factorialClaim) { if (Number(factorialClaim[1]) !== n) fail("label", "factorial label must use the number of supplied distinct items"); return graph.permutationCount; }
    if (lower === "parity") return graph.parity;
    if (lower === "image") return node ? graph.mapping[node.index]! : null;
    if (lower === "inverse") return node ? graph.inverse[node.index]! : null;
    return null;
  }
  if (["subsets", "subset_count", "2^n"].includes(lower)) return graph.totalSubsetCount;
  const powerClaim = /^2\^(\d+)$/.exec(normalized); if (powerClaim) { if (Number(powerClaim[1]) !== n) fail("label", "powerset label exponent must equal the number of source items"); return graph.totalSubsetCount; }
  if (["rank", "size"].includes(lower)) return node?.rank ?? null;
  if (["selected", "selected_count", "binomial"].includes(lower)) return graph.selectionCount;
  const binomialClaim = /^(?:C|binom|choose)\((n|\d+),(r|k|\d+)\)$/i.exec(normalized);
  if (binomialClaim) {
    const sourceN = binomialClaim[1]!.toLowerCase() === "n" ? n : Number(binomialClaim[1]); const rank = ["r", "k"].includes(binomialClaim[2]!.toLowerCase()) ? graph.selectionRank : Number(binomialClaim[2]);
    if (sourceN !== n || rank === null || !Number.isInteger(rank) || rank < 0 || rank > n) fail("label", "binomial count labels require the source item count and an explicit known valid rank"); return graph.rankCounts[rank]!;
  }
  return null;
}
function checkText(text: unknown, value: NonNullable<ReturnType<typeof graphGeometry>>): void {
  if (text === undefined) return;
  if (typeof text !== "string" || !text.trim()) fail("label", "graph labels require source identifiers, subsets, or exact typed count claims");
  const normalized = text.trim().replaceAll("−", "-");
  if (/^(?:[+-]?infinity|nan)$/i.test(normalized)) fail("label", "graph labels cannot claim nonfinite values");
  if (!/[=≈]/.test(normalized) && /^(?:\d+!|2\^(?:n|\d+))$/i.test(normalized)) { if (claimValue(normalized, value) === null) fail("label", "symbolic count formula has no source-supported invariant"); return; }
  if (normalized === value.node?.name || /^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized) || !/[=≈]/.test(normalized) && !/^[-+\d.(]/.test(normalized)) {
    // Numerical parameters in symbolic factorial/binomial/powerset labels
    // must still refer to the declared source objects, even without an answer.
    if (/[\d!^]/.test(normalized) && /^(?:\d+!|2\^\d+|(?:C|binom|choose)\()/i.test(normalized)) claimValue(normalized, value); return;
  }
  const equation = /^(.+?)\s*[=≈]\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(.*)$/i.exec(normalized);
  if (!equation) fail("label", "numeric graph claims must explicitly name their computed integer invariant");
  const expected = claimValue(equation[1]!, value); if (expected === null) fail("label", "graph numeric claim has no supported evaluated invariant"); preserveLiteral(equation[2], "label");
  if (equation[3] && !["1", "unit", "units", "unitless", "dimensionless", "scalar"].includes(equation[3]!.toLowerCase())) fail("label", "combinatorial count labels cannot claim metric or probability units");
  const actual = Number(equation[2]); if (!Number.isSafeInteger(actual) || actual !== expected) fail("label", "graph numeric label contradicts its exact evaluated invariant");
}
/** Every quantitative overlay is certified from source graph semantics, never diagram length. */
export function validateEvaluatedCombinatoricsLabels(construction: SceneConstruction, index: number, document: SceneDocument, outputs: readonly unknown[], issues: SceneIssue[]): void {
  if (!(COMBINATORICS_OPERATORS as readonly string[]).includes(construction.operator)) return;
  construction.outputs.forEach((id, outputIndex) => {
    const value = graphGeometry(outputs[outputIndex]);
    try {
      if (!value) fail("label", "graph output has no evaluated nonmetric source authority"); checkText(document.entities.find((entity) => entity.id === id)?.label, value);
      for (const annotation of document.annotations) {
        if (!annotation.targetIds.includes(id)) continue; checkText(annotation.text, value);
        if (annotation.quantityId !== undefined) {
          const quantities = document.quantities.filter((quantity) => quantity.id === annotation.quantityId); if (quantities.length !== 1 || typeof quantities[0]!.symbol !== "string") fail("label", "graph quantity annotations require an unambiguous named invariant");
          const expected = claimValue(quantities[0]!.symbol as string, value); if (expected === null) fail("label", "graph quantity annotation has no supported evaluated invariant");
          units(annotation.quantityId, document); const actual = validationNumber(annotation.quantityId, document); if (!Number.isSafeInteger(actual) || actual !== expected) fail("label", "graph quantity annotation contradicts the computed source invariant");
        }
      }
      for (const label of document.constructions) if (label.operator === "label" && (label.inputs.target ?? label.inputs.at ?? label.inputs.point) === id) checkText(label.inputs.text, value);
    } catch (error) { issues.push({ code: "invalid_combinatorics_label", severity: "fatal", message: error instanceof Error ? error.message : "invalid combinatorics label", path: `constructions[${index}].outputs[${outputIndex}]`, entityIds: [id] }); }
  });
}
