/**
 * Entity-level topology graph from symbol/connect constructions.
 * Powers path, pathCount, loadBranchCount, sameTerminalPair, and degree assertions.
 */

import type { SceneAssertion, SceneDocument, SceneIssue } from "../types";
import { isTopologySceneProofPredicate } from "../capability/capabilityManifest";

export interface TopologyEdge {
  id: string;
  a: string;
  b: string;
  kind: "symbol" | "connect";
}

export interface TopologyGraph {
  nodes: Set<string>;
  edges: TopologyEdge[];
  edgeById: Map<string, TopologyEdge>;
  /** nodeId -> incident edge ids */
  adjacency: Map<string, string[]>;
}

const MAX_PATH_COUNT_EDGES = 48;
const MAX_PATH_COUNT_STEPS = 20_000;
const MAX_PATH_COUNT_RESULTS = 4_096;
const MAX_PATH_WITNESSES = 4;

const PARALLEL_DC_SOURCE_SYMBOLS = new Set(["battery", "cell"]);
const PARALLEL_PASSIVE_LOAD_SYMBOLS = new Set(["resistor", "lamp"]);

export type ParallelLoadCountResult = {
  ok: true;
  count: number;
  sourceId: string;
  loadIds: string[];
  /** Queried electrical nodes after ordinary wire contraction. */
  terminals: [string, string];
} | {
  ok: false;
  reason: string;
};

/**
 * Count direct passive branches across one DC source, not arbitrary graph paths.
 * Ordinary wires identify an electrical node; their subdivisions do not add
 * branches. Every component in the queried connected component must be either
 * that single source or a supported passive load across the same two nodes.
 * Series/bridge networks and unsupported symbols need a different proof.
 * This establishes topology only, never current direction or numeric values.
 */
export function readParallelLoadCount(
  document: SceneDocument,
  from: string,
  to: string,
): ParallelLoadCountResult {
  const graph = buildTopologyGraph(document);
  if (from === to || !graph.nodes.has(from) || !graph.nodes.has(to)) {
    return { ok: false, reason: "loadBranchCount needs two distinct, connected terminal node IDs" };
  }
  const reachable = new Set([from]);
  const pending = [from];
  while (pending.length > 0) {
    const node = pending.pop()!;
    for (const edgeId of graph.adjacency.get(node) ?? []) {
      const edge = graph.edgeById.get(edgeId)!;
      const next = edge.a === node ? edge.b : edge.a;
      if (reachable.has(next)) continue;
      reachable.add(next);
      pending.push(next);
    }
  }
  if (!reachable.has(to)) {
    return { ok: false, reason: "loadBranchCount terminal nodes are disconnected" };
  }
  const edges = graph.edges.filter((edge) => reachable.has(edge.a));
  if (edges.length > MAX_PATH_COUNT_EDGES || new Set(edges.map((edge) => edge.id)).size !== edges.length) {
    return { ok: false, reason: "loadBranchCount requires a bounded graph with unique branch IDs" };
  }
  // Include malformed self-loops too: buildTopologyGraph intentionally omits
  // them, but a branch-count proof must not silently drop a shorted component.
  const relevantConstructions = document.constructions.filter((construction) => {
    if (construction.operator !== "symbol" && construction.operator !== "connect") return false;
    const start = firstString(construction.inputs, ["start", "from", "a"]);
    const end = firstString(construction.inputs, ["end", "to", "b"]);
    return (start !== null && reachable.has(start)) || (end !== null && reachable.has(end));
  });
  if (relevantConstructions.some((construction) => {
    const start = firstString(construction.inputs, ["start", "from", "a"]);
    const end = firstString(construction.inputs, ["end", "to", "b"]);
    return !start || !end || start === end || !graph.edgeById.has(construction.outputs[0] ?? "");
  })) {
    return { ok: false, reason: "loadBranchCount cannot omit a malformed or shorted circuit branch" };
  }
  const invariantIssues: SceneIssue[] = [];
  validateTopologyInvariants({ ...document, constructions: relevantConstructions }, invariantIssues);
  const invariant = invariantIssues.find((issue) => issue.severity === "fatal");
  if (invariant) return { ok: false, reason: `${invariant.code}: ${invariant.message}` };

  const representatives = connectorNodeRepresentatives(graphWithEdges(edges));
  const first = representatives.get(from)!;
  const second = representatives.get(to)!;
  if (first === second) {
    return { ok: false, reason: "loadBranchCount terminal nodes are shorted by a wire path" };
  }
  const pair = canonicalPair(first, second);
  const symbols = relevantConstructions.filter((construction) => construction.operator === "symbol");
  const symbolName = (construction: SceneDocument["constructions"][number]) =>
    typeof construction.inputs.symbol === "string"
      ? construction.inputs.symbol.trim().toLowerCase().replace(/[\s-]+/g, "_")
      : "";
  const sources = symbols.filter((construction) => PARALLEL_DC_SOURCE_SYMBOLS.has(symbolName(construction)));
  if (sources.length !== 1) {
    return { ok: false, reason: `loadBranchCount requires exactly one canonical DC source in this circuit; found ${sources.length}` };
  }
  const source = sources[0]!;
  const loads = symbols.filter((construction) => construction !== source);
  const unsupported = loads.find((construction) => !PARALLEL_PASSIVE_LOAD_SYMBOLS.has(symbolName(construction)));
  if (unsupported) {
    return { ok: false, reason: `loadBranchCount cannot classify symbol ${unsupported.outputs[0]} as a passive resistor or lamp branch` };
  }
  for (const construction of symbols) {
    const edge = graph.edgeById.get(construction.outputs[0]!)!;
    const start = representatives.get(edge.a)!;
    const end = representatives.get(edge.b)!;
    if (start === end || canonicalPair(start, end) !== pair) {
      return { ok: false, reason: `loadBranchCount requires source and every load to join the queried node pair directly; ${edge.id} is a series, dangling, shorted, or bridge member` };
    }
  }
  return {
    ok: true,
    count: loads.length,
    sourceId: source.outputs[0]!,
    loadIds: loads.map((construction) => construction.outputs[0]!),
    terminals: [first, second],
  };
}

/**
 * Compatibility for old planner drafts that used pathCount to mean loads.
 * A second, complete assertion must independently enumerate all parallel loads.
 * No new physical arrow/polarity claims gain admission from this interpretation.
 */
function legacyParallelLoadInterpretation(
  assertion: SceneAssertion,
  document: SceneDocument,
): Extract<ParallelLoadCountResult, { ok: true }> | null {
  if (assertion.entities.length !== 2 || typeof assertion.expected !== "number" ||
      !Number.isInteger(assertion.expected) || assertion.expected < 2 ||
      document.source.nonMetric !== true || document.source.representationTier !== "qualitative_verified" ||
      document.quantities.length !== 0 || document.source.circuitTopologyRepaired === true) return null;
  const result = readParallelLoadCount(document, assertion.entities[0]!, assertion.entities[1]!);
  if (!result.ok || result.count !== assertion.expected) return null;
  const loadIds = new Set(result.loadIds);
  const completeProof = document.assertions.some((proof) =>
    proof.predicate === "sameTerminalPair" && proof.severity === "fatal" && proof.expected === true &&
    proof.entities.length === loadIds.size && new Set(proof.entities).size === loadIds.size &&
    proof.entities.every((id) => loadIds.has(id)));
  if (!completeProof) return null;
  if (hasUnverifiedParallelInk(document)) return null;
  return result;
}

function parallelTopologyRepairIssue(assertion: SceneAssertion, actual?: number): SceneIssue {
  return {
    code: "parallel_topology_repaired",
    message: `Assertion ${assertion.id} (pathCount on ${assertion.entities.join(", ")}): the reader removed a circuit branch before validation, so this count cannot certify the circuit as drawn. ` +
      "A connector is removed when it joins the same two terminals as a component and nothing claims it as an intentional short or bypass. " +
      "Valid when no connector duplicates a component's terminal pair: join each wire to the terminal or node it actually reaches.",
    severity: "fatal",
    entityIds: assertion.entities,
    expected: assertion.expected,
    ...(actual === undefined ? {} : { actual }),
  };
}

/** A short mathematical identity is a name, not a physical value or polarity. */
function parallelMathIdentity(text: string): string | null {
  const normalized = text.trim().normalize("NFKC")
    .replace(/^([A-Za-zΑ-Ωα-ω])_\{([A-Za-zΑ-Ωα-ω]|[0-9]{1,3})\}$/, "$1_$2");
  return /^[A-Za-zΑ-Ωα-ω](?:_?(?:[A-Za-zΑ-Ωα-ω]|[0-9]{1,3}))?$/.test(normalized)
    ? normalized.replace("_", "")
    : null;
}

function parallelComponentWord(document: SceneDocument, entityId: string, text: string): boolean {
  const owner = document.constructions.find((construction) => construction.outputs.includes(entityId));
  if (owner?.operator !== "symbol" || typeof owner.inputs.symbol !== "string") return false;
  const symbol = owner.inputs.symbol.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const word = text.trim().toLowerCase();
  return ((PARALLEL_DC_SOURCE_SYMBOLS.has(symbol) || PARALLEL_PASSIVE_LOAD_SYMBOLS.has(symbol)) && word === symbol) ||
    (word === "source" && PARALLEL_DC_SOURCE_SYMBOLS.has(symbol)) ||
    (word === "load" && PARALLEL_PASSIVE_LOAD_SYMBOLS.has(symbol));
}

/** Check every possible alias; compiler lookup priority must not hide claim ink. */
function hasUnverifiedParallelQuantityInk(document: SceneDocument, entityId: string, label: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_₀-₉]{0,7}$/.test(label.trim())) return false;
  const keyFor = (text: string) => text.trim().toLowerCase().replace(/[₀-₉]/g, (digit) =>
    String("₀₁₂₃₄₅₆₇₈₉".indexOf(digit)));
  const key = keyFor(label);
  const quantities = document.quantities.filter((candidate) =>
    keyFor(candidate.id) === key || (typeof candidate.symbol === "string" && keyFor(candidate.symbol) === key));
  // A benign first ID alias cannot certify another alias selected by physical
  // symbol precedence. Inspect all matches, independent of inventory order.
  // This is intentionally conservative even when the compiler would omit a
  // conflicting value; the count does not establish value, unit, or polarity.
  return quantities.some((quantity) => {
    if (typeof quantity.label === "string" && quantity.label.trim()) {
      const identity = parallelMathIdentity(quantity.label);
      return !parallelComponentWord(document, entityId, quantity.label) &&
        (!identity || identity !== parallelMathIdentity(label));
    }
    return typeof quantity.value === "number" || typeof quantity.value === "string";
  });
}

/** Counts cannot establish additional geometry, values, current, or polarity. */
function hasUnverifiedParallelInk(document: SceneDocument): boolean {
  const expectedKinds = new Map([["point", "point"], ["symbol", "component"], ["connect", "connector"]]);
  const entities = new Map(document.entities.map((entity) => [entity.id, entity]));
  const produced = new Set<string>();
  for (const construction of document.constructions) {
    const kind = expectedKinds.get(construction.operator);
    const output = construction.outputs[0];
    // A connect output styled as a ray can draw a current arrow even without
    // a vector construction. Only exact ordinary-circuit production is proved.
    if (!kind || construction.outputs.length !== 1 || !output || produced.has(output) ||
        entities.get(output)?.kind !== kind) return true;
    produced.add(output);
  }
  if (document.entities.some((entity) => !produced.has(entity.id))) return true;
  for (const entity of document.entities) {
    if (!entity.label?.trim()) continue;
    if (!["point", "component", "connector"].includes(entity.kind) ||
        (!parallelMathIdentity(entity.label) && !parallelComponentWord(document, entity.id, entity.label)) ||
        (entity.kind === "component" && hasUnverifiedParallelQuantityInk(document, entity.id, entity.label))) return true;
  }
  for (const annotation of document.annotations) {
    if (annotation.kind === "narration") continue; // No drawn text or marks.
    if (!["label", "callout"].includes(annotation.kind) || annotation.targetIds.length !== 1 ||
        annotation.quantityId !== undefined) return true;
    const owner = document.entities.find((entity) => entity.id === annotation.targetIds[0]);
    if (!owner || !["point", "component", "connector"].includes(owner.kind)) return true;
    if (annotation.text === undefined || !annotation.text.trim()) continue;
    const identity = parallelMathIdentity(annotation.text);
    if (!parallelComponentWord(document, owner.id, annotation.text) &&
        (!identity || (identity !== parallelMathIdentity(owner.label ?? "") && identity !== parallelMathIdentity(owner.id)))) return true;
  }
  return false;
}

/**
 * Invariants that are always true for a well-formed port graph. These do not
 * depend on planner-authored assertions, so a missing assertion cannot allow
 * an obvious short circuit or duplicate wire through compilation.
 */
export function validateTopologyInvariants(document: SceneDocument, issues: SceneIssue[]): void {
  const graph = buildTopologyGraph(document);
  const edgesByPair = new Map<string, TopologyEdge[]>();
  for (const edge of graph.edges) {
    const pair = canonicalPair(edge.a, edge.b);
    const siblings = edgesByPair.get(pair) ?? [];
    siblings.push(edge);
    edgesByPair.set(pair, siblings);
  }

  for (const siblings of edgesByPair.values()) {
    const symbols = siblings.filter((edge) => edge.kind === "symbol");
    const connectors = siblings.filter((edge) => edge.kind === "connect");
    if (symbols.length > 0 && connectors.length > 0) {
      issues.push({
        code: "component_bypassed",
        message: `Connector ${connectors[0]!.id} bypasses a component on the same terminal pair`,
        severity: "fatal",
        entityIds: [...symbols, ...connectors].map((edge) => edge.id),
      });
    }
    if (connectors.length > 1) {
      issues.push({
        code: "duplicate_connector",
        message: "Multiple connectors occupy the same terminal pair",
        severity: "fatal",
        entityIds: connectors.map((edge) => edge.id),
      });
    }
  }

  const connectorGraph = graphWithEdges(graph.edges.filter((edge) => edge.kind === "connect"));
  for (const symbol of graph.edges.filter((edge) => edge.kind === "symbol")) {
    const bypass = findPathEdges(connectorGraph, symbol.a, symbol.b);
    // A direct connector on the same pair is already reported above. Longer
    // connector-only paths are equally definite shorts and must not escape
    // merely because the planner inserted intermediate junction points.
    if (bypass.length > 1) {
      issues.push({
        code: "component_bypassed",
        message: `Connector path ${bypass.join(", ")} bypasses component ${symbol.id}`,
        severity: "fatal",
        entityIds: [symbol.id, ...bypass],
      });
    }
  }

  const connectors = graph.edges.filter((edge) => edge.kind === "connect");
  // A lone wire across a component-only chain is an unambiguous bypass. Once
  // multiple connectors exist they may be the junction wiring of a valid
  // parallel network, so topology alone cannot classify an alternate path as
  // a short. Explicit assertions remain available for domain-specific cases.
  if (connectors.length === 1) {
    const symbolGraph = graphWithEdges(graph.edges.filter((edge) => edge.kind === "symbol"));
    const connector = connectors[0]!;
    const path = findPathEdges(symbolGraph, connector.a, connector.b);
    if (path.length > 0 && !closesPoweredComponentLoop(document, path)) {
      issues.push({
        code: "component_chain_bypassed",
        message: `Connector ${connector.id} bypasses the component path ${path.join(", ")}`,
        severity: "fatal",
        entityIds: [connector.id, ...path],
      });
    }
  }
}

function closesPoweredComponentLoop(document: SceneDocument, path: string[]): boolean {
  if (path.length < 2) return false;
  const sourceEntityIds = new Set(document.entities.flatMap((entity) => {
    const semantic = normalizeTopologySemantic(`${entity.kind} ${entity.role} ${entity.label ?? ""}`);
    return /\b(?:source|supply|battery|cell|generator)\b/i.test(semantic)
      ? [entity.id]
      : [];
  }));
  for (const construction of document.constructions) {
    if (
      construction.operator !== "symbol" ||
      !/\b(?:source|supply|battery|cell|generator)\b/i.test(
        normalizeTopologySemantic(String(construction.inputs.symbol ?? "")),
      )
    ) continue;
    const output = construction.outputs[0];
    if (output) sourceEntityIds.add(output);
  }
  return path.some((id) => sourceEntityIds.has(id)) &&
    path.some((id) => !sourceEntityIds.has(id));
}

function normalizeTopologySemantic(value: string): string {
  return value.replace(/[_-]+/g, " ");
}

export function buildTopologyGraph(document: SceneDocument): TopologyGraph {
  const edges: TopologyEdge[] = [];
  const edgeById = new Map<string, TopologyEdge>();
  const nodes = new Set<string>();
  const adjacency = new Map<string, string[]>();

  const link = (node: string, edgeId: string) => {
    nodes.add(node);
    const list = adjacency.get(node) ?? [];
    list.push(edgeId);
    adjacency.set(node, list);
  };

  for (const construction of document.constructions) {
    if (construction.operator !== "symbol" && construction.operator !== "connect") continue;
    const start = firstString(construction.inputs, ["start", "from", "a"]);
    const end = firstString(construction.inputs, ["end", "to", "b"]);
    const edgeId = construction.outputs[0];
    if (!start || !end || !edgeId) continue;
    if (start === end) continue;
    const edge: TopologyEdge = {
      id: edgeId,
      a: start,
      b: end,
      kind: construction.operator,
    };
    edges.push(edge);
    edgeById.set(edgeId, edge);
    link(start, edgeId);
    link(end, edgeId);
  }

  return { nodes, edges, edgeById, adjacency };
}

/**
 * A count may be written bare (2, "2") or wrapped like the other scalar
 * expectations ({ value: 2 }), as the angle readers accept. Anything that is
 * not a whole non-negative number is NaN, so the assertion still fails.
 */
function expectedCount(expected: unknown): number {
  const raw = typeof expected === "number"
    ? expected
    : typeof expected === "string" && /^\s*\d+\s*$/.test(expected)
      ? Number(expected)
      : expected !== null && typeof expected === "object" && typeof (expected as { value?: unknown }).value === "number"
        ? (expected as { value: number }).value
        : NaN;
  return Number.isInteger(raw) && raw >= 0 ? raw : NaN;
}

export function evaluateTopologyAssertion(
  assertion: SceneAssertion,
  document: SceneDocument,
  issues: SceneIssue[],
): boolean | null {
  const graph = buildTopologyGraph(document);
  const severity = assertion.severity;
  const predicate = assertion.predicate;
  if (!isTopologySceneProofPredicate(predicate)) return null;

  switch (predicate) {
    case "path": {
      const edgeIds = assertion.entities;
      if (edgeIds.length < 1) {
        issues.push({
          code: "assertion_failed",
          message: topologyFinding(assertion, `Assertion ${assertion.id} path requires at least one edge`),
          severity,
          entityIds: assertion.entities,
        });
        return false;
      }
      const ordered = edgesFormOrderedPath(graph, edgeIds) ||
        edgesFormOrderedPath(contractConnectorNodes(graph), edgeIds);
      const passed = assertion.expected === false ? !ordered : ordered;
      if (!passed) {
        issues.push({
          code: "assertion_failed",
          message: topologyFinding(assertion, `Assertion ${assertion.id} (path on ${edgeIds.join(", ")}): consecutive edges must share an endpoint and no node may repeat; ${orderedPathBreak(graph, edgeIds)}`),
          severity,
          entityIds: assertion.entities,
          expected: assertion.expected ?? true,
          actual: ordered,
        });
      }
      return passed;
    }
    case "pathCount": {
      if (assertion.entities.length < 2) {
        issues.push({
          code: "assertion_failed",
          message: topologyFinding(assertion, `Assertion ${assertion.id} pathCount needs two terminal nodes`),
          severity,
          entityIds: assertion.entities,
        });
        return false;
      }
      const [from, to] = assertion.entities;
      const paths = countSimplePaths(graph, from!, to!);
      if (paths === null) {
        issues.push({
          code: "assertion_failed",
          message: topologyFinding(assertion, `Assertion ${assertion.id}: pathCount graph is too complex for deterministic validation limits`),
          severity,
          entityIds: assertion.entities,
        });
        return false;
      }
      const { count, witnesses } = paths;
      const expected = expectedCount(assertion.expected);
      // Preserve the established graph-path meaning before trying the narrow,
      // independently proved load-branch interpretation for legacy planners.
      const compatibility = count === expected ? null : legacyParallelLoadInterpretation(assertion, document);
      const passed = count === expected || compatibility !== null;
      if (compatibility) {
        issues.push({
          code: "path_count_load_branch_compatibility",
          message: `Assertion ${assertion.id}: accepted ${compatibility.count} proved load branches; strict pathCount is ${count} because it includes source ${compatibility.sourceId}`,
          severity: "warning",
          entityIds: [...assertion.entities, compatibility.sourceId, ...compatibility.loadIds],
          expected,
          actual: { graphPaths: count, loadBranches: compatibility.count },
        });
      }
      if (!passed) {
        if (document.source.circuitTopologyRepaired === true) {
          issues.push(parallelTopologyRepairIssue(assertion, count));
        }
        issues.push({
          code: "assertion_failed",
          message: `Assertion ${assertion.id}: pathCount between ${from} and ${to} expected ${expected} paths, found ${count}. ` +
            "All symbol and connector edges are counted, including source branches; pathCount does not count only loads. " +
            (witnesses.length > 0 ? `Counted paths: ${witnesses.map((path) => path.join(" -> ")).join("; ")}${count > witnesses.length ? "; ..." : ""}. ` : "") +
            "Use sameTerminalPair on load component ids to prove they share electrical nodes, and loadBranchCount for supported parallel load branches. Do not change the count without checking the intended network.",
          severity,
          entityIds: assertion.entities,
          expected,
          actual: count,
        });
      }
      return passed;
    }
    case "loadBranchCount": {
      const validCount = typeof assertion.expected === "number" && Number.isInteger(assertion.expected) && assertion.expected >= 0;
      const result = assertion.entities.length === 2
        ? readParallelLoadCount(document, assertion.entities[0]!, assertion.entities[1]!)
        : { ok: false as const, reason: "loadBranchCount needs exactly two terminal node IDs" };
      const passed = validCount && result.ok && result.count === assertion.expected;
      if (!passed) {
        issues.push({
          code: "assertion_failed",
          message: `${assertion.reason ? `${assertion.reason}. ` : ""}Assertion ${assertion.id}: ${!validCount
            ? "loadBranchCount expected must be a nonnegative integer"
            : result.ok ? `expected ${assertion.expected} load branches, found ${result.count}; the source branch is excluded`
              : result.reason}`,
          // A false count is a core truth failure; planner severity cannot
          // downgrade it into a renderable warning.
          severity: "fatal",
          entityIds: assertion.entities,
          expected: assertion.expected,
          ...(result.ok ? { actual: result.count } : {}),
        });
      }
      if (document.source.circuitTopologyRepaired === true) {
        issues.push(parallelTopologyRepairIssue(assertion, result.ok ? result.count : undefined));
        return false;
      }
      // A correct topology count must not newly admit unrelated physical ink.
      // In particular, arbitrary current arrows are not derived from battery
      // polarity by this predicate. Keep those scenes closed until their ink
      // has its own deterministic physical-direction proof.
      const unverifiedInk = result.ok && hasUnverifiedParallelInk(document);
      if (unverifiedInk) {
        issues.push({
          code: "parallel_direction_unverified",
          message: `Assertion ${assertion.id}: loadBranchCount proves ${result.count} load branches, but cannot establish additional geometry, current direction, or polarity; use an independent deterministic physical construction`,
          severity: "fatal",
          entityIds: assertion.entities,
          expected: assertion.expected,
          actual: result.count,
        });
      }
      return passed && !unverifiedInk;
    }
    case "sameTerminalPair": {
      const edgeIds = assertion.entities;
      if (edgeIds.length < 2) {
        issues.push({
          code: "assertion_failed",
          message: topologyFinding(assertion, `Assertion ${assertion.id} sameTerminalPair needs ≥2 edges`),
          severity,
          entityIds: assertion.entities,
        });
        return false;
      }
      const directTerminals = edgeIds.map((id) => edgeTerminals(graph, id));
      const contractedTerminals = edgeIds.map((id) => edgeTerminals(contractConnectorNodes(graph), id));
      const directSame = terminalPairsMatch(directTerminals);
      const contractedSame = terminalPairsMatch(contractedTerminals);
      const terminals = directSame ? directTerminals : contractedTerminals;
      if (terminals.some((pair) => !pair)) {
        issues.push({
          code: "assertion_failed",
          message: `Assertion ${assertion.id}: sameTerminalPair is missing component/connector edges: ${edgeIds.filter((_, index) => !terminals[index]).join(", ")}. ` +
            "Pass symbol/connect output ids, not node ids.",
          severity,
          entityIds: assertion.entities,
        });
        return false;
      }
      const same = directSame || contractedSame;
      const passed = assertion.expected === false ? !same : same;
      if (!passed) {
        issues.push({
          code: "assertion_failed",
          message: `Assertion ${assertion.id}: sameTerminalPair expected ${assertion.expected !== false}, found ${same} after joining nodes connected by wires. ` +
            edgeIds.map((id, index) => `${id}=(${terminals[index]!.join(", ")})`).join("; ") +
            ". Parallel loads must each connect across both of the same electrical nodes; coincident points do not join nodes.",
          severity,
          entityIds: assertion.entities,
          expected: assertion.expected ?? true,
          actual: terminals,
        });
      }
      return passed;
    }
    case "degree": {
      if (assertion.entities.length !== 1) {
        issues.push({
          code: "assertion_failed",
          message: topologyFinding(assertion, `Assertion ${assertion.id} degree needs exactly one node`),
          severity,
          entityIds: assertion.entities,
        });
        return false;
      }
      const nodeId = assertion.entities[0]!;
      const degree = graph.adjacency.get(nodeId)?.length ?? 0;
      const expected = expectedCount(assertion.expected);
      const passed = degree === expected;
      if (!passed) {
        issues.push({
          code: "assertion_failed",
          message: topologyFinding(assertion, `Assertion ${assertion.id}: node degree ${degree} ≠ ${expected}`),
          severity,
          entityIds: assertion.entities,
          expected,
          actual: degree,
        });
      }
      return passed;
    }
    default:
      return assertNeverTopologyPredicate(predicate);
  }
}

function assertNeverTopologyPredicate(predicate: never): never {
  throw new Error(`unhandled topology predicate ${String(predicate)}`);
}

/** The engine's finding leads; a candidate-authored reason is quoted as the claim, never in its place. */
function topologyFinding(assertion: SceneAssertion, finding: string): string {
  return assertion.reason ? `${finding} The candidate's claim: "${assertion.reason}".` : finding;
}

/** Where an ordered path first fails: a repeated or missing edge, two consecutive edges with no shared endpoint, or a repeated node. */
function orderedPathBreak(graph: TopologyGraph, edgeIds: string[]): string {
  const repeated = edgeIds.find((id, index) => edgeIds.indexOf(id) !== index);
  if (repeated) return `edge ${repeated} is listed twice`;
  const missing = edgeIds.filter((id) => !graph.edgeById.has(id));
  if (missing.length > 0) return `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not a connector or component edge of the circuit graph`;
  for (let index = 1; index < edgeIds.length; index += 1) {
    const previous = graph.edgeById.get(edgeIds[index - 1]!)!, current = graph.edgeById.get(edgeIds[index]!)!;
    if (![previous.a, previous.b].some((node) => node === current.a || node === current.b)) {
      return `${previous.id} (${previous.a}–${previous.b}) and ${current.id} (${current.a}–${current.b}) share no endpoint`;
    }
  }
  return "the listed edges revisit a node, so they do not form one simple path or cycle";
}

function edgesFormOrderedPath(graph: TopologyGraph, edgeIds: string[]): boolean {
  if (new Set(edgeIds).size !== edgeIds.length) return false;
  const edges = edgeIds.map((id) => graph.edgeById.get(id));
  if (edges.some((edge) => !edge)) return false;
  if (edges.length === 1) return true;

  const first = edges[0]!;
  const orientations: Array<[string, string]> = [
    [first.a, first.b],
    [first.b, first.a],
  ];

  for (const orientation of orientations) {
    const nodes = [...orientation];
    let ok = true;
    for (let index = 1; index < edges.length; index += 1) {
      const edge = edges[index]!;
      const tip = nodes[nodes.length - 1]!;
      if (edge.a === tip) nodes.push(edge.b);
      else if (edge.b === tip) nodes.push(edge.a);
      else {
        ok = false;
        break;
      }
    }
    if (ok && nodes.length === edges.length + 1) {
      const isSimplePath = new Set(nodes).size === nodes.length;
      const isSimpleCycle =
        nodes[0] === nodes.at(-1) &&
        new Set(nodes.slice(0, -1)).size === edges.length;
      if (isSimplePath || isSimpleCycle) return true;
    }
  }
  return false;
}

function countSimplePaths(graph: TopologyGraph, from: string, to: string): { count: number; witnesses: string[][] } | null {
  if (from === to) return { count: 0, witnesses: [] };
  if (!graph.nodes.has(from) || !graph.nodes.has(to)) return { count: 0, witnesses: [] };
  if (graph.edges.length > MAX_PATH_COUNT_EDGES) return null;

  let count = 0;
  let steps = 0;
  const witnesses: string[][] = [];
  const visit = (node: string, visitedNodes: Set<string>, path: string[]) => {
    steps += 1;
    if (steps > MAX_PATH_COUNT_STEPS || count > MAX_PATH_COUNT_RESULTS) {
      throw new Error("path_count_limit");
    }
    if (node === to) {
      count += 1;
      if (witnesses.length < MAX_PATH_WITNESSES) witnesses.push([...path]);
      return;
    }
    for (const edgeId of graph.adjacency.get(node) ?? []) {
      const edge = graph.edgeById.get(edgeId);
      if (!edge) continue;
      const next = edge.a === node ? edge.b : edge.a;
      if (visitedNodes.has(next)) continue;
      visitedNodes.add(next);
      path.push(edgeId);
      visit(next, visitedNodes, path);
      path.pop();
      visitedNodes.delete(next);
    }
  };
  try {
    visit(from, new Set([from]), []);
    return { count, witnesses };
  } catch (error) {
    if (error instanceof Error && error.message === "path_count_limit") return null;
    throw error;
  }
}

function graphWithEdges(edges: TopologyEdge[]): TopologyGraph {
  const nodes = new Set<string>();
  const edgeById = new Map<string, TopologyEdge>();
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    nodes.add(edge.a);
    nodes.add(edge.b);
    edgeById.set(edge.id, edge);
    adjacency.set(edge.a, [...(adjacency.get(edge.a) ?? []), edge.id]);
    adjacency.set(edge.b, [...(adjacency.get(edge.b) ?? []), edge.id]);
  }
  return { nodes, edges, edgeById, adjacency };
}

/** Ordinary connectors identify electrical nodes even when drawn as several leads. */
function connectorNodeRepresentatives(graph: TopologyGraph): Map<string, string> {
  const parent = new Map([...graph.nodes].map((node) => [node, node]));
  const find = (node: string): string => {
    const current = parent.get(node) ?? node;
    if (current === node) return node;
    const root = find(current);
    parent.set(node, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };
  for (const edge of graph.edges) {
    if (edge.kind === "connect") union(edge.a, edge.b);
  }
  return new Map([...graph.nodes].map((node) => [node, find(node)]));
}

function contractConnectorNodes(graph: TopologyGraph): TopologyGraph {
  const representatives = connectorNodeRepresentatives(graph);
  return graphWithEdges(graph.edges.map((edge) => ({
    ...edge,
    a: representatives.get(edge.a)!,
    b: representatives.get(edge.b)!,
  })));
}

function terminalPairsMatch(terminals: Array<[string, string] | null>): boolean {
  if (terminals.length < 2 || terminals.some((pair) => !pair)) return false;
  const first = terminals[0]!;
  const canonical = canonicalPair(first[0], first[1]);
  return terminals.every((pair) => canonicalPair(pair![0], pair![1]) === canonical);
}

function findPathEdges(graph: TopologyGraph, from: string, to: string): string[] {
  const visit = (node: string, visited: Set<string>, path: string[]): string[] => {
    if (node === to) return path;
    for (const edgeId of graph.adjacency.get(node) ?? []) {
      const edge = graph.edgeById.get(edgeId);
      if (!edge) continue;
      const next = edge.a === node ? edge.b : edge.a;
      if (visited.has(next)) continue;
      const result = visit(next, new Set([...visited, next]), [...path, edgeId]);
      if (result.length > 0) return result;
    }
    return [];
  };
  return visit(from, new Set([from]), []);
}

function edgeTerminals(graph: TopologyGraph, edgeId: string): [string, string] | null {
  const edge = graph.edgeById.get(edgeId);
  return edge ? [edge.a, edge.b] : null;
}

function canonicalPair(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function firstString(inputs: Record<string, unknown>, names: string[]): string | null {
  for (const name of names) {
    const value = inputs[name];
    if (typeof value === "string") return value;
  }
  return null;
}
