/**
 * Minimum spanning trees: Kruskal and Prim.
 *
 * Kruskal's frames carry the accepted-or-rejected verdict per edge, because
 * the interesting moment is the edge that gets *rejected* for closing a
 * cycle — a figure that only ever adds edges hides the reason union-find is
 * there at all.
 */
import { buildGraph, type GraphInput } from "./graph";
import { aside, type AlgorithmTrace, type TraceAside, type TraceEdge, type TraceFrame, type TraceNode } from "../types";

const MAX_FRAMES = 6;

interface WeightedEdge {
  from: string;
  to: string;
  weight: number;
}

function weightedEdges(input: GraphInput): WeightedEdge[] | null {
  const out: WeightedEdge[] = [];
  for (const edge of input.edges) {
    if (edge.weight === undefined || !Number.isFinite(edge.weight)) return null;
    out.push({ from: edge.from, to: edge.to, weight: edge.weight });
  }
  return out;
}

export function simulateKruskal(input: GraphInput): AlgorithmTrace | null {
  const shape = buildGraph(input, false);
  if (!shape) return null;
  const edges = weightedEdges(input);
  if (!edges) return null;

  // Ties broken by endpoint id so the trace is deterministic across runs.
  const sorted = [...edges].sort(
    (a, b) => a.weight - b.weight || `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`),
  );

  const parent = new Map<string, string>(shape.ids.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };

  const accepted: WeightedEdge[] = [];
  const rejected: WeightedEdge[] = [];
  const frames: TraceFrame[] = [];

  const edgesNow = (current: WeightedEdge | null, verdict: "candidate" | "done" | "excluded" | null): TraceEdge[] =>
    shape.edges.map((edge) => {
      const isAccepted = accepted.some(
        (a) => (a.from === edge.from && a.to === edge.to) || (a.from === edge.to && a.to === edge.from),
      );
      const isRejected = rejected.some(
        (r) => (r.from === edge.from && r.to === edge.to) || (r.from === edge.to && r.to === edge.from),
      );
      const isCurrent =
        current !== null &&
        ((current.from === edge.from && current.to === edge.to) ||
          (current.from === edge.to && current.to === edge.from));
      if (isCurrent && verdict) return { ...edge, mark: verdict };
      if (isAccepted) return { ...edge, mark: "done" as const };
      if (isRejected) return { ...edge, mark: "excluded" as const };
      return { ...edge };
    });

  const nodesNow = (): TraceNode[] => {
    const touched = new Set(accepted.flatMap((edge) => [edge.from, edge.to]));
    return shape.ids.map((id) => ({
      id,
      label: shape.labels.get(id)!,
      ...(touched.has(id) ? { mark: "done" as const } : {}),
    }));
  };

  // The sorted edge list is the algorithm's agenda, and a claim about "the
  // lightest edge left" is unreadable without it.
  const edgeName = (edge: WeightedEdge) => `${shape.labels.get(edge.from)}${shape.labels.get(edge.to)} ${edge.weight}`;
  const listAside = (cursor: number): TraceAside[] => [
    aside(
      "edges",
      "by weight",
      "row",
      sorted.map(edgeName),
      sorted.length,
      new Map(
        sorted
          .map((edge, index): [number, "active" | "done" | "excluded"] | null => {
            if (index === cursor) return [index, "active"];
            if (accepted.includes(edge)) return [index, "done"];
            if (rejected.includes(edge)) return [index, "excluded"];
            return null;
          })
          .filter((entry): entry is [number, "active" | "done" | "excluded"] => entry !== null),
      ),
    ),
  ];

  frames.push({
    id: "weights",
    caption: `${shape.edges.length} edges, lightest first`,
    narrationIntent: `Kruskal ignores the shape of the graph and works down a list of every edge sorted by weight, which is the row under the figure. The lightest weighs ${sorted[0]!.weight}, so that is where it starts.`,
    state: {
      kind: "graph",
      nodes: nodesNow(),
      edges: edgesNow(null, null),
      ...(input.positions ? { positions: input.positions } : {}),
      asides: listAside(-1),
    },
  });

  for (const [cursor, edge] of sorted.entries()) {
    if (frames.length >= MAX_FRAMES) break;
    if (accepted.length === shape.ids.length - 1) break;
    const rootA = find(edge.from);
    const rootB = find(edge.to);
    const closesCycle = rootA === rootB;
    if (closesCycle) {
      rejected.push(edge);
      frames.push({
        id: `skip_${edge.from}${edge.to}`,
        caption: `${shape.labels.get(edge.from)}-${shape.labels.get(edge.to)} (${edge.weight}) closes a cycle`,
        narrationIntent: `Both ends are already in the same component, so taking this edge would close a cycle and it is struck out. This is the moment union-find exists for: it answers "are these two already joined?" in near-constant time.`,
        state: {
          kind: "graph",
          nodes: nodesNow(),
          edges: edgesNow(edge, "excluded"),
          ...(input.positions ? { positions: input.positions } : {}),
          asides: listAside(cursor),
        },
      });
      continue;
    }
    parent.set(rootA, rootB);
    accepted.push(edge);
    frames.push({
      id: `take_${edge.from}${edge.to}`,
      caption: `Take ${shape.labels.get(edge.from)}-${shape.labels.get(edge.to)} (${edge.weight})`,
      narrationIntent: `The two ends are in different components, so this edge joins them without closing a cycle and it is taken. The tree now has ${accepted.length} of the ${shape.ids.length - 1} edges it needs.`,
      state: {
        kind: "graph",
        nodes: nodesNow(),
        edges: edgesNow(edge, "done"),
        ...(input.positions ? { positions: input.positions } : {}),
        asides: listAside(cursor),
      },
    });
  }

  const total = accepted.reduce((sum, edge) => sum + edge.weight, 0);
  if (frames.length >= 2) {
    frames[frames.length - 1]!.caption = `Spanning tree costs ${total}`;
  }
  return {
    algorithmId: "kruskal",
    title: "Kruskal's minimum spanning tree",
    input: { nodes: input.nodes, edges: input.edges },
    result: {
      edges: accepted.map((edge) => `${shape.labels.get(edge.from)}-${shape.labels.get(edge.to)}`),
      weight: total,
    },
    resultText: `spanning tree costs ${total}`,
    frames,
  };
}

export function simulatePrim(input: GraphInput & { start?: string }): AlgorithmTrace | null {
  const shape = buildGraph(input, false);
  if (!shape) return null;
  const edges = weightedEdges(input);
  if (!edges) return null;
  const start = input.start ?? shape.ids[0]!;
  if (!shape.labels.has(start)) return null;

  const inTree = new Set<string>([start]);
  const accepted: WeightedEdge[] = [];
  const frames: TraceFrame[] = [];

  const edgesNow = (current: WeightedEdge | null): TraceEdge[] =>
    shape.edges.map((edge) => {
      const isAccepted = accepted.some(
        (a) => (a.from === edge.from && a.to === edge.to) || (a.from === edge.to && a.to === edge.from),
      );
      const isCurrent =
        current !== null &&
        ((current.from === edge.from && current.to === edge.to) ||
          (current.from === edge.to && current.to === edge.from));
      if (isCurrent) return { ...edge, mark: "active" as const };
      if (isAccepted) return { ...edge, mark: "done" as const };
      const crosses = inTree.has(edge.from) !== inTree.has(edge.to);
      return crosses ? { ...edge, mark: "candidate" as const } : { ...edge };
    });

  const nodesNow = (): TraceNode[] =>
    shape.ids.map((id) => ({
      id,
      label: shape.labels.get(id)!,
      ...(inTree.has(id) ? { mark: "done" as const } : {}),
    }));

  const crossingAside = (): TraceAside[] => {
    const crossing = edges
      .filter((edge) => inTree.has(edge.from) !== inTree.has(edge.to))
      .sort((a, b) => a.weight - b.weight)
      .map((edge) => `${shape.labels.get(edge.from)}${shape.labels.get(edge.to)} ${edge.weight}`);
    return [aside("cross", "crossing", "row", crossing, Math.max(4, edges.length), new Map(crossing.length ? [[0, "active" as const]] : []))];
  };

  frames.push({
    id: "seed",
    caption: `Grow from ${shape.labels.get(start)}`,
    narrationIntent: `Prim grows a single tree outward from ${shape.labels.get(start)}. Only edges crossing from the tree to a node outside it are ever candidates, and they are listed under the figure, cheapest first.`,
    state: { kind: "graph", nodes: nodesNow(), edges: edgesNow(null), asides: crossingAside() },
  });

  while (inTree.size < shape.ids.length && frames.length < MAX_FRAMES) {
    let best: WeightedEdge | null = null;
    for (const edge of edges) {
      const crosses = inTree.has(edge.from) !== inTree.has(edge.to);
      if (!crosses) continue;
      if (
        !best ||
        edge.weight < best.weight ||
        (edge.weight === best.weight && `${edge.from}${edge.to}` < `${best.from}${best.to}`)
      ) {
        best = edge;
      }
    }
    if (!best) break;
    const rivals = edges
      .filter((edge) => edge !== best && inTree.has(edge.from) !== inTree.has(edge.to))
      .map((edge) => `${shape.labels.get(edge.from)}-${shape.labels.get(edge.to)} at ${edge.weight}`);
    const added = inTree.has(best.from) ? best.to : best.from;
    inTree.add(added);
    accepted.push(best);
    frames.push({
      id: `add_${added}`,
      caption: `Add ${shape.labels.get(added)} via ${best.weight}`,
      narrationIntent: rivals.length
        ? `The crossing edges were ${rivals.join(", ")} and this one at ${best.weight}. The cheapest wins, so ${shape.labels.get(added)} joins the tree.`
        : `Only one edge still crosses out of the tree, at ${best.weight}, so ${shape.labels.get(added)} joins and the tree is complete.`,
      state: { kind: "graph", nodes: nodesNow(), edges: edgesNow(best), asides: crossingAside() },
    });
  }

  const totalWeight = accepted.reduce((sum, edge) => sum + edge.weight, 0);
  if (frames.length >= 2) frames[frames.length - 1]!.caption = `Spanning tree costs ${totalWeight}`;
  return {
    algorithmId: "prim",
    title: "Prim's minimum spanning tree",
    input: { nodes: input.nodes, edges: input.edges, start },
    result: {
      edges: accepted.map((edge) => `${shape.labels.get(edge.from)}-${shape.labels.get(edge.to)}`),
      weight: totalWeight,
    },
    resultText: `spanning tree costs ${totalWeight}`,
    frames,
  };
}
