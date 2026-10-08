import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";
import { branchGlyph, type NetworkBranchKind } from "./networkGlyphs";
import {
  add2, canonicalUnit, compactNumber, hypot2, invalid, isRecord, pair, rejectUnknownKeys,
  requireUnits, scale2, scalar, SourceInputError, unit2, validationNumber,
  type SourceContext,
} from "./sourceScalars";

export const NETWORK_OPERATORS = ["kirchhoff_network"] as const;

export interface NetworkBranchDefinition {
  id: string;
  kind: NetworkBranchKind;
  from: string;
  to: string;
  resistance: number | null;
  emf: number;
  current: number;
  unit: "A";
  displayScale: number;
  zero: boolean;
  label?: string;
}

export type NetworkGeometry =
  | { kind: "point"; point: RenderPoint; networkNode?: { id: string }; networkBranch?: NetworkBranchDefinition }
  | { kind: "compound"; paths: RenderPoint[][]; terminals: [RenderPoint, RenderPoint]; networkBranch: NetworkBranchDefinition }
  | { kind: "path"; points: RenderPoint[]; directed?: true; networkBranch: NetworkBranchDefinition };

const OHM: Readonly<Record<string, string>> = { ohm: "ohm", ohms: "ohm", "Ω": "ohm" };
const VOLT: Readonly<Record<string, string>> = { V: "V", volt: "V", volts: "V" };

interface NodeInput { id: string; at: RenderPoint }
interface BranchInput { id: string; from: string; to: string; kind: NetworkBranchKind; resistance: number | null; emf: number; label?: string }

function solve(nodes: NodeInput[], branches: BranchInput[], ground: string): Map<string, number> {
  const unknown = nodes.filter((node) => node.id !== ground);
  const idealBranches = branches.filter((branch) => branch.kind === "wire" || (branch.kind === "source" && branch.resistance === 0));
  const size = unknown.length + idealBranches.length;
  if (size === 0) invalid("ground", "a network needs at least one non-ground node or an ideal wire");
  const index = new Map(unknown.map((node, position) => [node.id, position]));
  const matrix = Array.from({ length: size }, () => Array<number>(size).fill(0));
  const rhs = Array<number>(size).fill(0);
  const stamp = (node: string, self: string, other: string, conductance: number, emfSign: number, emf: number): void => {
    if (node === ground) return;
    const row = index.get(node);
    if (row === undefined) invalid("branches", "branch endpoint is not a declared node");
    if (self !== ground) matrix[row]![index.get(self)!]! += conductance;
    if (other !== ground) matrix[row]![index.get(other)!]! -= conductance;
    rhs[row] += emfSign * conductance * emf;
  };
  for (const branch of branches) {
    if (branch.kind === "open" || idealBranches.includes(branch)) continue;
    const conductance = 1 / branch.resistance!;
    stamp(branch.from, branch.from, branch.to, conductance, -1, branch.emf);
    stamp(branch.to, branch.to, branch.from, conductance, 1, branch.emf);
  }
  idealBranches.forEach((branch, branchIndex) => {
    const column = unknown.length + branchIndex;
    const row = column;
    for (const [node, sign] of [[branch.from, 1], [branch.to, -1]] as const) {
      if (node === ground) continue;
      const nodeIndex = index.get(node);
      if (nodeIndex === undefined) invalid("branches", "wire endpoint is not a declared node");
      matrix[nodeIndex]![column]! += sign;
      matrix[row]![nodeIndex]! += sign;
    }
    rhs[row] = branch.kind === "source" ? -branch.emf : 0;
  });
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) if (Math.abs(matrix[row]![column]!) > Math.abs(matrix[pivot]![column]!)) pivot = row;
    if (!(Math.abs(matrix[pivot]![column]!) > 1e-10)) invalid("network", "Kirchhoff system is singular or ill-conditioned");
    [matrix[column], matrix[pivot]] = [matrix[pivot]!, matrix[column]!];
    [rhs[column], rhs[pivot]] = [rhs[pivot]!, rhs[column]!];
    const divisor = matrix[column]![column]!;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = matrix[row]![column]! / divisor;
      if (factor === 0) continue;
      for (let next = column; next < size; next += 1) matrix[row]![next]! -= factor * matrix[column]![next]!;
      rhs[row]! -= factor * rhs[column]!;
    }
    rhs[column]! /= divisor;
    for (let next = column; next < size; next += 1) matrix[column]![next]! /= divisor;
  }
  const voltage = new Map<string, number>([[ground, 0]]);
  unknown.forEach((node, position) => voltage.set(node.id, rhs[position]!));
  idealBranches.forEach((branch, branchIndex) => voltage.set(`ideal:${branch.id}`, rhs[unknown.length + branchIndex]!));
  const residual = nodes.reduce((max, node) => {
    const leaving = branches.reduce((sum, branch) => {
      const current = branch.kind === "open"
        ? 0
        : idealBranches.includes(branch)
        ? voltage.get(`ideal:${branch.id}`)!
        : (voltage.get(branch.from)! - voltage.get(branch.to)! + branch.emf) / branch.resistance!;
      return sum + (branch.from === node.id ? current : 0) - (branch.to === node.id ? current : 0);
    }, 0);
    return Math.max(max, Math.abs(leaving));
  }, 0);
  if (residual > 1e-6) invalid("precision", "solved currents do not satisfy KCL");
  return voltage;
}

function currentOf(branch: BranchInput, voltage: Map<string, number>): number {
  if (branch.kind === "open") return 0;
  if (branch.kind === "wire" || (branch.kind === "source" && branch.resistance === 0)) {
    return voltage.get(`ideal:${branch.id}`) ?? invalid("network", "ideal-branch current was not solved");
  }
  const value = (voltage.get(branch.from)! - voltage.get(branch.to)! + branch.emf) / branch.resistance!;
  if (!Number.isFinite(value) || Math.abs(value) > 1e12) invalid("current", "branch current exceeds finite authority");
  return value === 0 ? 0 : value;
}

function readNetwork(inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): NetworkGeometry[] {
  rejectUnknownKeys(inputs, ["nodes", "branches", "ground", "units", "currentScale"]);
  if (!isRecord(inputs.units)) invalid("units", "kirchhoff_network requires ohm and volt declarations");
  rejectUnknownKeys(inputs.units, ["resistance", "emf"], "units");
  if (canonicalUnit(inputs.units.resistance, OHM) !== "ohm" || canonicalUnit(inputs.units.emf, VOLT) !== "V") invalid("units", "resistance must be ohm and emf must be V");
  if (!Array.isArray(inputs.nodes) || inputs.nodes.length < 2 || inputs.nodes.length > 8) invalid("nodes", "a network needs 2 to 8 nodes");
  if (!Array.isArray(inputs.branches) || inputs.branches.length < 1 || inputs.branches.length > 12) invalid("branches", "a network needs 1 to 12 branches");
  const nodes: NodeInput[] = inputs.nodes.map((node, index) => {
    if (!isRecord(node) || typeof node.id !== "string" || !node.id.trim()) invalid("nodes", "every node needs an id");
    rejectUnknownKeys(node, ["id", "at"], "nodes");
    requireUnits(node.at, "unit", { unit: "unit", "1": "unit" }, document);
    return { id: node.id, at: pair(node.at, `nodes[${index}].at`, context) };
  });
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length) invalid("nodes", "node ids must be unique");
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (typeof inputs.ground !== "string" || !byId.has(inputs.ground)) invalid("ground", "ground must name a declared node");
  const branches: BranchInput[] = inputs.branches.map((branch) => {
    if (!isRecord(branch) || typeof branch.id !== "string" || typeof branch.from !== "string" || typeof branch.to !== "string") invalid("branches", "every branch needs id, from, and to");
    rejectUnknownKeys(branch, ["id", "from", "to", "kind", "resistance", "emf", "label"], "branches");
    if (!byId.has(branch.from) || !byId.has(branch.to) || branch.from === branch.to) invalid("branches", "branch endpoints must be distinct declared nodes");
    const kind = branch.kind;
    if (kind !== "resistor" && kind !== "source" && kind !== "wire" && kind !== "open" && kind !== "detector") invalid("kind", "branch kind must be resistor, source, wire, open, or detector");
    const label = typeof branch.label === "string" ? branch.label : undefined;
    if (kind === "wire") {
      if (branch.resistance !== undefined || branch.emf !== undefined) invalid("wire", "an ideal wire has no resistance or emf");
      return { id: branch.id, from: branch.from, to: branch.to, kind, resistance: null, emf: 0, label };
    }
    if (kind === "open") {
      if (branch.resistance !== undefined || branch.emf !== undefined) invalid("open", "an ideal open branch has no finite resistance or emf");
      return { id: branch.id, from: branch.from, to: branch.to, kind, resistance: null, emf: 0, label };
    }
    requireUnits(branch.resistance, "ohm", OHM, document);
    const resistance = scalar(branch.resistance, "resistance", context);
    if (kind === "source" ? resistance < 0 : !(resistance > 0)) invalid("resistance", "passive branch resistance must be positive; an ideal source may declare zero internal resistance");
    const emf = branch.emf === undefined ? 0 : scalar(branch.emf, "emf", context);
    requireUnits(branch.emf, "V", VOLT, document);
    if (kind === "source" && emf === 0) invalid("emf", "a source branch requires a nonzero emf");
    if (kind === "detector" && emf !== 0) invalid("emf", "a detector branch cannot carry an emf");
    if (kind === "resistor" && emf !== 0) invalid("emf", "a resistor branch cannot carry an emf; use a source branch");
    return { id: branch.id, from: branch.from, to: branch.to, kind, resistance, emf, label };
  });
  if (new Set(branches.map((branch) => branch.id)).size !== branches.length) invalid("branches", "branch ids must be unique");
  const currentScale = scalar(inputs.currentScale, "currentScale", context);
  if (!(currentScale > 1e-6)) invalid("currentScale", "currentScale must exceed 1e-6");
  const voltage = solve(nodes, branches, inputs.ground);
  const lanes = new Map<string, number>();
  const branchLanes: number[] = [];
  const nodeMarks = nodes.map((node) => ({ kind: "point" as const, point: node.at, networkNode: { id: node.id } }));
  const glyphs = branches.map((branch) => {
    const key = [branch.from, branch.to].sort().join(":");
    const lane = lanes.get(key) ?? 0;
    branchLanes.push(lane);
    lanes.set(key, lane + 0.18);
    const start = byId.get(branch.from)!.at;
    const end = byId.get(branch.to)!.at;
    const current = currentOf(branch, voltage);
    const definition: NetworkBranchDefinition = { ...branch, current, unit: "A", displayScale: currentScale, zero: current === 0 };
    return { kind: "compound" as const, paths: branchGlyph(branch.kind, start, end, lane, branch.emf), terminals: [start, end] as [RenderPoint, RenderPoint], networkBranch: definition };
  });
  const currents = glyphs.map((branch, index) => {
    const definition = branch.networkBranch;
    const start = byId.get(definition.from)!.at;
    const end = byId.get(definition.to)!.at;
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    if (definition.zero) return { kind: "point" as const, point: definition.kind === "detector" ? start : midpoint, networkBranch: definition };
    const span = hypot2({ x: end.x - start.x, y: end.y - start.y });
    const direction = unit2(scale2({ x: end.x - start.x, y: end.y - start.y }, Math.sign(definition.current), "current"), "current");
    const length = Math.min(Math.abs(definition.current) * currentScale, span * 0.18);
    if (!(length > 1e-6)) invalid("precision", "a nonzero branch current collapses at the stated display scale");
    const normal = { x: -direction.y, y: direction.x };
    const clearance = definition.kind === "source" ? 0.5 : definition.kind === "wire" ? 0.18 : 0.28;
    const origin = add2(midpoint, scale2(normal, clearance + (branchLanes[index] ?? 0), "current"), "current");
    const half = scale2(direction, length / 2, "current");
    return { kind: "path" as const, points: [add2(origin, scale2(half, -1, "current"), "current"), add2(origin, half, "current")], directed: true as const, networkBranch: definition };
  });
  return [...nodeMarks, ...glyphs, ...currents];
}

export function evaluateNetworkConstruction(operator: string, inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): NetworkGeometry[] {
  if (operator !== "kirchhoff_network") invalid("operator", `unsupported network operator ${operator}`);
  return readNetwork(inputs, context, document);
}

function branchOf(value: unknown): NetworkBranchDefinition | undefined {
  return isRecord(value) && isRecord(value.networkBranch) ? value.networkBranch as unknown as NetworkBranchDefinition : undefined;
}

export function networkOutputLabels(outputs: readonly unknown[], requested?: readonly unknown[]): string[] {
  return outputs.map((output, index) => {
    const branch = branchOf(output);
    if (!branch || !isRecord(output) || output.kind !== "compound") return "";
    const symbol = typeof branch.label === "string" ? branch.label : branch.id;
    const numeric = `I=${compactNumber(branch.current)} A`;
    const requestedText = requested?.[index];
    if (requestedText !== undefined && requestedText !== symbol && requestedText !== numeric) invalid("label", "branch labels must be the branch id or the verified current");
    if (requestedText === numeric) return numeric;
    return symbol;
  });
}

export function validateNetworkConstruction(
  construction: SceneConstruction,
  index: number,
  document: SceneDocument,
  _constructionByOutput: Map<string, SceneConstruction>,
  issues: SceneIssue[],
): void {
  if (construction.operator !== "kirchhoff_network") return;
  const add = (key: string, message: string): void => {
    issues.push({ code: "invalid_kirchhoff_network_" + key, severity: "fatal", message, path: `constructions[${index}].${key === "outputs" ? "outputs" : `inputs.${key}`}` });
  };
  if (!isRecord(construction.inputs) || !Array.isArray(construction.inputs.nodes) || !Array.isArray(construction.inputs.branches)) {
    add("inputs", "kirchhoff_network requires nodes and branches");
    return;
  }
  const nodes = construction.inputs.nodes;
  const branches = construction.inputs.branches;
  const count = nodes.length + branches.length * 2;
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  if (outputs.length !== count || new Set(outputs).size !== count) add("outputs", `kirchhoff_network requires ${count} outputs: nodes, branch glyphs, then currents`);
  const context: SourceContext = {
    number: (value) => validationNumber(value, document),
    point: () => invalid("origin", "network placement is inline"),
    geometry: () => undefined,
  };
  try {
    const geometry = evaluateNetworkConstruction(construction.operator, construction.inputs, context, document);
    networkOutputLabels(geometry, outputs.map((id) => document.entities.find((entity) => entity.id === id)?.label));
    geometry.forEach((output, outputIndex) => {
      const entity = document.entities.find((candidate) => candidate.id === outputs[outputIndex]);
      const kind = outputIndex < nodes.length ? "point" : outputIndex < nodes.length + branches.length ? "polyline" : "vector";
      if (entity?.kind !== kind) add("outputs", `output ${outputIndex} must be ${kind}`);
    });
  } catch (error) {
    add(error instanceof SourceInputError ? error.key : "inputs", error instanceof Error ? error.message : "network inputs are invalid");
  }
}
