import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const PROBABILITY_OPERATORS = ["probability_tree"] as const;

export interface ProbabilityEvaluationContext {
  number(value: unknown): number;
  point(value: unknown): RenderPoint;
}
export type ProbabilityGeometry =
  | { kind: "point"; point: RenderPoint }
  | { kind: "path"; points: RenderPoint[] };
export interface ProbabilityTreeNode {
  id: string;
  outcome: string;
  parent: string | null;
  conditionalProbability: number | null;
  jointProbability: number;
  depth: number;
  point: RenderPoint;
}
export interface ProbabilityTree {
  nodes: ProbabilityTreeNode[];
  leafIds: string[];
  totalLeafProbability: number;
  jointLabelPoints: RenderPoint[];
}

type InputNode = { id: string; outcome: string; parent: string | null; probability: number | null; index: number };
const MAX_NODES = 31;
const MAX_LEAVES = 12;
const MAX_DEPTH = 5;
const MAX_COORDINATE = 1e6;
const SUM_TOLERANCE = 1e-12;
const INPUT_KEYS = new Set(["nodes", "origin", "levelGap", "leafGap"]);
const NODE_KEYS = new Set(["id", "outcome", "parent", "probability"]);

class ProbabilityInputError extends Error {
  constructor(readonly code: string, readonly inputPath: string, message: string) { super(message); }
}

/** All branches are explicit conditional probabilities. The operator computes
 * path products; it never invents outcomes, complements, or independence.
 * Outputs: node points in input order, nonroot branch paths in input order,
 * then leaf joint-label anchors in depth-first sibling/input order. */
export function evaluateProbabilityConstruction(
  operator: string,
  inputs: Record<string, unknown>,
  context: ProbabilityEvaluationContext,
): ProbabilityGeometry[] {
  if (operator !== "probability_tree") fail("invalid_probability_operator", "", `Unsupported probability operator ${operator}`);
  const tree = deriveProbabilityTree(inputs, context);
  const byId = new Map(tree.nodes.map((node) => [node.id, node]));
  return [
    ...tree.nodes.map((node): ProbabilityGeometry => ({ kind: "point", point: node.point })),
    ...tree.nodes.filter((node) => node.parent !== null).map((node): ProbabilityGeometry => ({
      kind: "path", points: [byId.get(node.parent!)!.point, node.point],
    })),
    ...tree.jointLabelPoints.map((point): ProbabilityGeometry => ({ kind: "point", point })),
  ];
}

/** Engine-authored labels have the evaluator's output order. p denotes a
 * branch conditional; P denotes the joint probability of the full leaf path.
 * If finite display precision changes a value, ≈ declares the rounding. */
export function probabilityTreeOutputLabels(inputs: Record<string, unknown>, context: ProbabilityEvaluationContext): string[] {
  const tree = deriveProbabilityTree(inputs, context);
  const byId = new Map(tree.nodes.map((node) => [node.id, node]));
  return [
    ...tree.nodes.map((node) => node.outcome),
    ...tree.nodes.filter((node) => node.parent !== null).map((node) => probabilityLabel("p", node.conditionalProbability!)),
    ...tree.leafIds.map((id) => probabilityLabel("P", byId.get(id)!.jointProbability)),
  ];
}

export function deriveProbabilityTree(inputs: Record<string, unknown>, context: ProbabilityEvaluationContext): ProbabilityTree {
  if (!isRecord(inputs)) fail("invalid_probability_input", "", "Probability inputs must be an object");
  for (const key of Object.keys(inputs)) {
    if (!INPUT_KEYS.has(key)) fail("invalid_probability_input", key, `probability_tree does not accept ${key}`);
  }
  if (!Array.isArray(inputs.nodes) || inputs.nodes.length < 2 || inputs.nodes.length > MAX_NODES) {
    fail("invalid_probability_nodes", "nodes", `probability_tree requires 2 to ${MAX_NODES} explicitly supplied nodes`);
  }
  const inputNodes: InputNode[] = inputs.nodes.map((value, index) => {
    const path = `nodes[${index}]`;
    if (!isRecord(value) || Object.keys(value).some((key) => !NODE_KEYS.has(key))) {
      fail("invalid_probability_nodes", path, "Every node accepts only id, outcome, parent, and probability");
    }
    if (typeof value.id !== "string" || value.id.trim() !== value.id || value.id.length < 1 || value.id.length > 64) {
      fail("invalid_probability_topology", `${path}.id`, "Every node needs a unique nonempty ID of at most 64 characters");
    }
    if (typeof value.outcome !== "string" || value.outcome.trim() !== value.outcome || value.outcome.length < 1 || value.outcome.length > 16) {
      fail("invalid_probability_nodes", `${path}.outcome`, "Every node needs an explicit compact outcome label of 1 to 16 characters");
    }
    const root = value.parent === undefined;
    if (!root && (typeof value.parent !== "string" || value.parent.trim() !== value.parent || value.parent === "")) {
      fail("invalid_probability_topology", `${path}.parent`, "Each nonroot node must name exactly one parent ID");
    }
    if (root && "probability" in value) {
      fail("invalid_probability_value", `${path}.probability`, "The root has total probability one; do not supply a root probability");
    }
    const probability = root ? null : numeric(value.probability, context, "invalid_probability_value", `${path}.probability`);
    if (probability !== null && (probability < 0 || probability > 1)) {
      fail("invalid_probability_value", `${path}.probability`, "Every conditional probability must be between zero and one");
    }
    return { id: value.id, outcome: value.outcome, parent: root ? null : value.parent as string, probability, index };
  });
  const byId = new Map<string, InputNode>();
  for (const node of inputNodes) {
    if (byId.has(node.id)) fail("invalid_probability_topology", `nodes[${node.index}].id`, `Duplicate probability node ${node.id}`);
    byId.set(node.id, node);
  }
  const roots = inputNodes.filter((node) => node.parent === null);
  if (roots.length !== 1) fail("invalid_probability_topology", "nodes", "An explicit probability tree requires exactly one root");
  const children = new Map(inputNodes.map((node) => [node.id, [] as InputNode[]]));
  for (const node of inputNodes) {
    if (node.parent === null) continue;
    if (!byId.has(node.parent) || node.parent === node.id) {
      fail("invalid_probability_topology", `nodes[${node.index}].parent`, "A probability parent must be an existing different node");
    }
    children.get(node.parent)!.push(node);
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const depthById = new Map<string, number>();
  const probabilityById = new Map<string, number>();
  const leafIds: string[] = [];
  let maxDepth = 0;
  const visit = (node: InputNode, depth: number, joint: number): void => {
    if (active.has(node.id) || visited.has(node.id)) fail("invalid_probability_topology", "nodes", "Probability nodes must form an acyclic single-parent tree");
    if (depth > MAX_DEPTH) fail("invalid_probability_topology", "nodes", `Probability trees may contain at most ${MAX_DEPTH} branch levels`);
    active.add(node.id);
    visited.add(node.id);
    depthById.set(node.id, depth);
    probabilityById.set(node.id, joint);
    maxDepth = Math.max(maxDepth, depth);
    const descendants = children.get(node.id)!;
    if (descendants.length === 0) leafIds.push(node.id);
    else {
      const sum = compensatedSum(descendants.map((child) => child.probability!));
      if (Math.abs(sum - 1) > SUM_TOLERANCE) {
        fail("invalid_probability_sum", `nodes[${node.index}]`, `Outgoing conditional probabilities from ${node.id} must sum to one; received ${sum}`);
      }
      for (const child of descendants) {
        const product = joint * child.probability!;
        if (!Number.isFinite(product) || (joint > 0 && child.probability! > 0 && product === 0)) {
          fail("invalid_probability_value", `nodes[${child.index}].probability`, "Positive path probabilities must remain finite and must not underflow to zero");
        }
        visit(child, depth + 1, product);
      }
    }
    active.delete(node.id);
  };
  visit(roots[0]!, 0, 1);
  if (visited.size !== inputNodes.length) {
    fail("invalid_probability_topology", "nodes", "Every supplied node must be reachable from the root; disconnected cycles are invalid");
  }
  if (leafIds.length > MAX_LEAVES) fail("invalid_probability_topology", "nodes", `Probability trees may contain at most ${MAX_LEAVES} leaves`);
  const totalLeafProbability = compensatedSum(leafIds.map((id) => probabilityById.get(id)!));
  if (Math.abs(totalLeafProbability - 1) > SUM_TOLERANCE * MAX_DEPTH) {
    fail("invalid_probability_sum", "nodes", "The computed full leaf distribution must sum to one");
  }

  const levelGap = layoutGap(inputs.levelGap, 2, "levelGap", context);
  const leafGap = layoutGap(inputs.leafGap, 1, "leafGap", context);
  let origin: RenderPoint = { x: 0, y: 0 };
  if (inputs.origin !== undefined) {
    try { origin = checkedPoint(context.point(inputs.origin), "origin"); }
    catch { fail("invalid_probability_geometry", "origin", "Probability origin must resolve to a finite bounded point"); }
  }
  const rowById = new Map(leafIds.map((id, index) => [id, index]));
  const rowSpan = (id: string): [number, number] => {
    const descendants = children.get(id)!;
    if (descendants.length === 0) return [rowById.get(id)!, rowById.get(id)!];
    const spans = descendants.map((child) => rowSpan(child.id));
    const first = spans[0]![0];
    const last = spans.at(-1)![1];
    rowById.set(id, (first + last) / 2);
    return [first, last];
  };
  rowSpan(roots[0]!.id);
  const offsetY = (leafIds.length - 1) / 2;
  const place = (x: number, y: number): RenderPoint => checkedPoint({ x: origin.x + x * levelGap, y: origin.y + (y - offsetY) * leafGap }, "");
  const nodes: ProbabilityTreeNode[] = inputNodes.map((node) => ({
    id: node.id, outcome: node.outcome, parent: node.parent,
    conditionalProbability: node.probability, jointProbability: probabilityById.get(node.id)!,
    depth: depthById.get(node.id)!, point: place(depthById.get(node.id)!, rowById.get(node.id)!),
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    if (node.parent !== null && !(node.point.x > nodeById.get(node.parent)!.point.x)) {
      fail("invalid_probability_geometry", "origin", "Tree placement must preserve a positive horizontal gap on every branch");
    }
  }
  for (let index = 1; index < leafIds.length; index += 1) {
    if (!(nodeById.get(leafIds[index]!)!.point.y > nodeById.get(leafIds[index - 1]!)!.point.y)) {
      fail("invalid_probability_geometry", "origin", "Tree placement must preserve every distinct leaf row");
    }
  }
  const jointLabelPoints = leafIds.map((id) => place(maxDepth + 1, rowById.get(id)!));
  return { nodes, leafIds, totalLeafProbability, jointLabelPoints };
}

export function validateProbabilityConstruction(
  construction: SceneConstruction,
  index: number,
  document: SceneDocument,
  constructionByOutput: Map<string, SceneConstruction>,
  issues: SceneIssue[],
): void {
  if (construction.operator !== "probability_tree") return;
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  const context: ProbabilityEvaluationContext = {
    number: (value) => validationNumber(value, document),
    point: (value) => validationPoint(value, document, constructionByOutput),
  };
  try {
    const tree = deriveProbabilityTree(construction.inputs, context);
    const labels = probabilityTreeOutputLabels(construction.inputs, context);
    (construction.inputs.nodes as Record<string, unknown>[]).forEach((node, nodeIndex) => {
      if (node.parent !== undefined) validateProbabilityUnits(node.probability, document, `nodes[${nodeIndex}].probability`);
    });
    if (outputs.length !== labels.length) {
      issues.push({ code: "invalid_probability_output", message: `probability_tree requires ${labels.length} outputs: node points, nonroot branch polylines, then leaf joint labels`,
        severity: "fatal", path: `constructions[${index}].outputs`, entityIds: outputs, expected: labels.length, actual: outputs.length });
    }
    outputs.forEach((id, outputIndex) => {
      const entity = document.entities.find((entry) => entry.id === id);
      const kind = outputIndex < tree.nodes.length ? "point" : outputIndex < tree.nodes.length * 2 - 1 ? "polyline" : "label";
      if (entity?.kind !== kind) issues.push({ code: "invalid_probability_output", message: `Probability output ${outputIndex} must be a ${kind}`,
        severity: "fatal", path: `constructions[${index}].outputs[${outputIndex}]`, entityIds: [id], expected: kind, actual: entity?.kind });
      if (entity?.label !== undefined && entity.label !== labels[outputIndex]) issues.push({ code: "invalid_probability_label",
        message: "Probability labels must match the source outcome or the engine-computed conditional/joint probability", severity: "fatal",
        path: `entities[${document.entities.indexOf(entity)}].label`, entityIds: [id], expected: labels[outputIndex], actual: entity.label });
    });
    // The normal label engine can prefer annotation text over entity.label.
    // That must not turn a verified branch into a planner-authored scalar.
    const labelByOutput = new Map(outputs.map((id, outputIndex) => [id, labels[outputIndex]]));
    document.annotations.forEach((annotation, annotationIndex) => {
      if (annotation.kind === "narration") return;
      for (const id of annotation.targetIds) {
        const expected = labelByOutput.get(id);
        if (expected === undefined || (annotation.text === undefined && annotation.quantityId === undefined)) continue;
        if (annotation.quantityId !== undefined || annotation.text !== expected) issues.push({ code: "invalid_probability_label",
          message: "Drawable annotations must not replace verified probability labels", severity: "fatal",
          path: `annotations[${annotationIndex}]`, entityIds: [id], expected, actual: annotation.text ?? annotation.quantityId });
      }
    });
    document.constructions.forEach((producer, producerIndex) => {
      if (producer.operator !== "label") return;
      const target = producer.inputs.target ?? producer.inputs.at ?? producer.inputs.point;
      const expected = typeof target === "string" ? labelByOutput.get(target) : undefined;
      if (expected !== undefined && producer.inputs.text !== expected) issues.push({ code: "invalid_probability_label",
        message: "A separate label construction must not replace a verified probability value", severity: "fatal",
        path: `constructions[${producerIndex}].inputs.text`, entityIds: [target as string], expected, actual: producer.inputs.text });
    });
  } catch (error) {
    issues.push({ code: error instanceof ProbabilityInputError ? error.code : "invalid_probability_input",
      message: error instanceof Error ? error.message : String(error), severity: "fatal",
      path: `constructions[${index}].inputs${error instanceof ProbabilityInputError && error.inputPath ? `.${error.inputPath}` : ""}`, entityIds: outputs });
  }
}

function probabilityLabel(symbol: "p" | "P", value: number): string {
  // First remove multiplication noise such as 0.3 × 0.8 -> 0.23999999999999999.
  // A separate rounded display still declares approximation when the number
  // needs more than eight significant digits; tiny nonzero values use exponent
  // notation rather than disappearing into a zero decimal label.
  const precise = Number(value.toPrecision(15));
  const displayed = Number(precise.toPrecision(8));
  const rounded = Math.abs(displayed - value) > Number.EPSILON * 8 * Math.max(Math.abs(value), Number.MIN_VALUE);
  return `${symbol}${rounded ? "≈" : "="}${String(displayed)}`;
}
function layoutGap(value: unknown, fallback: number, key: string, context: ProbabilityEvaluationContext): number {
  const resolved = value === undefined ? fallback : numeric(value, context, "invalid_probability_geometry", key);
  if (resolved < 1e-3 || resolved > 1e3) fail("invalid_probability_geometry", key, "Probability layout gaps must be between 0.001 and 1000");
  return resolved;
}
function checkedPoint(point: RenderPoint, path: string): RenderPoint {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > MAX_COORDINATE || Math.abs(point.y) > MAX_COORDINATE) {
    fail("invalid_probability_geometry", path, "Probability geometry must have finite coordinates of magnitude at most 1000000");
  }
  return point;
}
function nonzeroLiteralUnderflows(value: unknown, resolved: number): boolean {
  if (typeof value !== "string" || resolved !== 0) return false;
  const literal = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:e[+-]?\d+)?$/i.exec(value.trim());
  return literal !== null && /[1-9]/.test(literal[1]!);
}
function numeric(value: unknown, context: ProbabilityEvaluationContext, code: string, path: string, depth = 0): number {
  if (depth > 64) fail(code, path, "Probability numeric nesting exceeds the supported depth");
  if (isRecord(value) && Object.keys(value).length === 1 && "value" in value) return numeric(value.value, context, code, path, depth + 1);
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && value.trim() === "")) {
    fail(code, path, "Probability values require finite literals, numeric strings, quantity IDs, or value wrappers");
  }
  let resolved: number;
  try { resolved = context.number(value); }
  catch { fail(code, path, "Probability value is not a resolvable finite number"); }
  if (!Number.isFinite(resolved)) fail(code, path, "Probability values must resolve to finite numbers");
  if (nonzeroLiteralUnderflows(value, resolved)) fail(code, path, "Nonzero probability numeric literals cannot underflow to zero");
  return Object.is(resolved, -0) ? 0 : resolved;
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<string>(), depth = 0): number {
  if (depth > 64) throw new Error("Probability quantity nesting exceeds the supported depth");
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (isRecord(value) && Object.keys(value).length === 1 && "value" in value) return validationNumber(value.value, document, seen, depth + 1);
  if (typeof value === "string" && value.trim() !== "") {
    if (seen.has(value)) throw new Error("Cyclic probability quantity reference");
    const quantity = document.quantities.find((entry) => entry.id === value);
    if (quantity) {
      seen.add(value);
      return validationNumber(quantity.value, document, seen, depth + 1);
    }
    const resolved = Number(value);
    if (Number.isFinite(resolved)) {
      if (nonzeroLiteralUnderflows(value, resolved)) throw new Error("Nonzero probability quantity literals cannot underflow to zero");
      return resolved;
    }
  }
  throw new Error("Unresolved probability numeric value");
}
function validateProbabilityUnits(value: unknown, document: SceneDocument, path: string, seen = new Set<string>(), depth = 0): void {
  if (depth > 64) fail("invalid_probability_value", path, "Probability quantity nesting exceeds the supported depth");
  if (isRecord(value) && "value" in value) {
    validateProbabilityUnits(value.value, document, path, seen, depth + 1);
    return;
  }
  if (typeof value !== "string") return;
  const quantity = document.quantities.find((entry) => entry.id === value);
  if (!quantity) return;
  if (seen.has(value)) fail("invalid_probability_value", path, "Probability quantity references must be acyclic");
  seen.add(value);
  if (quantity.unit !== undefined && (typeof quantity.unit !== "string" ||
    !["", "1", "dimensionless", "unitless", "probability"].includes(quantity.unit.trim().toLowerCase()))) {
    fail("invalid_probability_value", path, "Conditional probabilities require fractional dimensionless quantities; percent and physical units must be converted explicitly");
  }
  validateProbabilityUnits(quantity.value, document, path, seen, depth + 1);
}
function validationPoint(value: unknown, document: SceneDocument, constructionByOutput: Map<string, SceneConstruction>): RenderPoint {
  if (typeof value === "string") {
    const producer = constructionByOutput.get(value);
    if (!producer || document.entities.find((entry) => entry.id === value)?.kind !== "point") throw new Error("Probability origin must reference a constructed point");
    if (producer.operator === "point") return {
      x: validationNumber(producer.inputs.x, document), y: validationNumber(producer.inputs.y, document),
    };
    // Compiler resolves a derived origin again before producing geometry.
    return { x: 0, y: 0 };
  }
  if (Array.isArray(value) && value.length === 2 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
    return { x: value[0] as number, y: value[1] as number };
  }
  if (isRecord(value) && typeof value.x === "number" && typeof value.y === "number") return { x: value.x, y: value.y };
  throw new Error("Probability origin must be a finite point or constructed point reference");
}
function compensatedSum(values: number[]): number {
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
    sum = next;
  }
  return sum + correction;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fail(code: string, path: string, message: string): never { throw new ProbabilityInputError(code, path, message); }
