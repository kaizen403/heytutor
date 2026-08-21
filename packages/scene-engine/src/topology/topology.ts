/**
 * Entity-level topology graph from symbol/connect constructions.
 * Powers path, pathCount, sameTerminalPair, and degree assertions.
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
          message: assertion.reason ?? `Assertion ${assertion.id} path requires at least one edge`,
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
          message: assertion.reason ?? `Assertion ${assertion.id}: entities do not form an ordered path`,
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
          message: assertion.reason ?? `Assertion ${assertion.id} pathCount needs two terminal nodes`,
          severity,
          entityIds: assertion.entities,
        });
        return false;
      }
      const [from, to] = assertion.entities;
      const count = countSimplePaths(graph, from!, to!);
      if (count === null) {
        issues.push({
          code: "assertion_failed",
          message: assertion.reason ?? `Assertion ${assertion.id}: pathCount graph is too complex for deterministic validation limits`,
          severity,
          entityIds: assertion.entities,
        });
        return false;
      }
      const expected = Number(assertion.expected);
      const passed = count === expected;
      if (!passed) {
        issues.push({
          code: "assertion_failed",
          message: assertion.reason ?? `Assertion ${assertion.id}: expected ${expected} paths, found ${count}`,
          severity,
          entityIds: assertion.entities,
          expected,
          actual: count,
        });
      }
      return passed;
    }
    case "sameTerminalPair": {
      const edgeIds = assertion.entities;
      if (edgeIds.length < 2) {
        issues.push({
          code: "assertion_failed",
          message: assertion.reason ?? `Assertion ${assertion.id} sameTerminalPair needs ≥2 edges`,
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
          message: assertion.reason ?? `Assertion ${assertion.id}: missing edge in topology graph`,
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
          message: assertion.reason ?? `Assertion ${assertion.id}: edges do not share the same terminal pair`,
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
          message: assertion.reason ?? `Assertion ${assertion.id} degree needs exactly one node`,
          severity,
          entityIds: assertion.entities,
        });
        return false;
      }
      const nodeId = assertion.entities[0]!;
      const degree = graph.adjacency.get(nodeId)?.length ?? 0;
      const expected = Number(assertion.expected);
      const passed = degree === expected;
      if (!passed) {
        issues.push({
          code: "assertion_failed",
          message: assertion.reason ?? `Assertion ${assertion.id}: node degree ${degree} ≠ ${expected}`,
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

function countSimplePaths(graph: TopologyGraph, from: string, to: string): number | null {
  if (from === to) return 0;
  if (!graph.nodes.has(from) || !graph.nodes.has(to)) return 0;
  if (graph.edges.length > MAX_PATH_COUNT_EDGES) return null;

  let count = 0;
  let steps = 0;
  const visit = (node: string, visitedNodes: Set<string>) => {
    steps += 1;
    if (steps > MAX_PATH_COUNT_STEPS || count > MAX_PATH_COUNT_RESULTS) {
      throw new Error("path_count_limit");
    }
    if (node === to) {
      count += 1;
      return;
    }
    for (const edgeId of graph.adjacency.get(node) ?? []) {
      const edge = graph.edgeById.get(edgeId);
      if (!edge) continue;
      const next = edge.a === node ? edge.b : edge.a;
      if (visitedNodes.has(next)) continue;
      visitedNodes.add(next);
      visit(next, visitedNodes);
      visitedNodes.delete(next);
    }
  };
  try {
    visit(from, new Set([from]));
    return count;
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
function contractConnectorNodes(graph: TopologyGraph): TopologyGraph {
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
  return graphWithEdges(graph.edges.map((edge) => ({
    ...edge,
    a: find(edge.a),
    b: find(edge.b),
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
