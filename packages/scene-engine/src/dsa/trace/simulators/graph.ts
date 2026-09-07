/**
 * Graph traversal: breadth-first, depth-first, and topological order.
 *
 * The graph alone cannot teach a traversal. What separates breadth-first from
 * depth-first is the container the frontier waits in, and what makes Kahn's
 * algorithm work is the in-degree count dropping to zero, so both are drawn
 * beside the figure as asides rather than asserted in narration. Marks carry
 * the rest of the state: `active` is the node being expanded, `candidate` the
 * frontier, `done` settled.
 */
import { aside, type AlgorithmTrace, type TraceAside, type TraceEdge, type TraceFrame, type TraceNode } from "../types";

export interface GraphInput {
  nodes: Array<{ id: string; label?: string }>;
  edges: Array<{ from: string; to: string; weight?: number }>;
  start?: string;
  /** Fixed node positions, when the question's example has coordinates. */
  positions?: Record<string, { x: number; y: number }>;
}

const MAX_FRAMES = 8;

export interface GraphShape {
  ids: string[];
  labels: Map<string, string>;
  adjacency: Map<string, string[]>;
  edges: TraceEdge[];
}

export function buildGraph(input: GraphInput, directed: boolean): GraphShape | null {
  const ids = input.nodes.map((node) => node.id);
  if (ids.length < 2 || ids.length > 8) return null;
  if (new Set(ids).size !== ids.length) return null;

  const labels = new Map(input.nodes.map((node) => [node.id, node.label ?? node.id]));
  const adjacency = new Map<string, string[]>(ids.map((id) => [id, []]));
  const edges: TraceEdge[] = [];

  for (const edge of input.edges) {
    if (!labels.has(edge.from) || !labels.has(edge.to)) return null;
    if (edge.from === edge.to) return null;
    adjacency.get(edge.from)!.push(edge.to);
    if (!directed) adjacency.get(edge.to)!.push(edge.from);
    edges.push({
      from: edge.from,
      to: edge.to,
      ...(edge.weight !== undefined ? { label: String(edge.weight) } : {}),
    });
  }
  if (edges.length < 1 || edges.length > 14) return null;
  for (const list of adjacency.values()) list.sort();
  return { ids, labels, adjacency, edges };
}

function nodesWith(
  shape: GraphShape,
  active: string | null,
  frontier: ReadonlySet<string>,
  settled: ReadonlySet<string>,
): TraceNode[] {
  return shape.ids.map((id) => ({
    id,
    label: shape.labels.get(id)!,
    ...(id === active
      ? { mark: "active" as const }
      : settled.has(id)
        ? { mark: "done" as const }
        : frontier.has(id)
          ? { mark: "candidate" as const }
          : {}),
  }));
}

export function simulateGraphTraversal(
  input: GraphInput & { mode: "bfs" | "dfs" },
): AlgorithmTrace | null {
  const shape = buildGraph(input, false);
  if (!shape) return null;
  const start = input.start && shape.labels.has(input.start) ? input.start : shape.ids[0]!;

  const frames: TraceFrame[] = [];
  const settled = new Set<string>();
  const pending: string[] = [start];
  const seen = new Set<string>([start]);
  const visited: string[] = [];
  const containerName = input.mode === "bfs" ? "queue" : "stack";

  const asidesNow = (): TraceAside[] => [
    aside(
      containerName,
      containerName,
      input.mode === "bfs" ? "row" : "column",
      // A stack is drawn bottom up, so the next node out sits on top.
      (input.mode === "bfs" ? pending : [...pending].reverse()).map((id) => shape.labels.get(id)!),
      shape.ids.length,
      new Map(pending.length > 0 ? [[0, "active" as const]] : []),
    ),
    aside("out", "visited", "row", visited.map((id) => shape.labels.get(id)!), shape.ids.length),
  ];

  frames.push({
    id: "graph",
    caption: `Start at ${shape.labels.get(start)}`,
    narrationIntent: `We start at ${shape.labels.get(start)}, so it goes into the ${containerName} on its own. ${
      input.mode === "bfs"
        ? "A queue hands back whatever has waited longest, which is why breadth-first reaches every neighbour of a node before going any deeper."
        : "A stack hands back whatever arrived last, which is why depth-first commits to one branch and only backtracks when it runs out."
    }`,
    state: {
      kind: "graph",
      nodes: nodesWith(shape, start, new Set([start]), settled),
      edges: shape.edges,
      ...(input.positions ? { positions: input.positions } : {}),
      asides: asidesNow(),
    },
  });

  while (pending.length > 0 && frames.length < MAX_FRAMES) {
    const current = input.mode === "bfs" ? pending.shift()! : pending.pop()!;
    visited.push(current);
    settled.add(current);
    const discovered: string[] = [];
    for (const neighbour of shape.adjacency.get(current) ?? []) {
      if (seen.has(neighbour)) continue;
      seen.add(neighbour);
      pending.push(neighbour);
      discovered.push(neighbour);
    }
    const names = (ids: readonly string[]) => ids.map((id) => shape.labels.get(id)!).join(" and ");
    frames.push({
      id: `expand_${current}`,
      caption: `visit ${shape.labels.get(current)}: ${visited.map((id) => shape.labels.get(id)!).join(" ")}`,
      narrationIntent: discovered.length
        ? `${shape.labels.get(current)} comes out of the ${containerName} and is marked visited. Its unvisited neighbours ${names(discovered)} go in, so the ${containerName} now holds ${pending.map((id) => shape.labels.get(id)!).join(", ")}.`
        : `${shape.labels.get(current)} comes out and every neighbour it has is already visited, so nothing new goes in and the ${containerName} ${pending.length ? `still holds ${pending.map((id) => shape.labels.get(id)!).join(", ")}` : "is now empty"}.`,
      state: {
        kind: "graph",
        nodes: nodesWith(shape, current, new Set(pending), settled),
        edges: shape.edges,
        ...(input.positions ? { positions: input.positions } : {}),
        asides: asidesNow(),
      },
    });
  }

  const order = visited.map((id) => shape.labels.get(id)!);
  if (frames.length >= 2) {
    const last = frames[frames.length - 1]!;
    last.caption = `${input.mode === "bfs" ? "BFS" : "DFS"} order: ${order.join(" ")}`;
  }

  return {
    algorithmId: `graph_${input.mode}`,
    title: input.mode === "bfs" ? "Breadth-first search" : "Depth-first search",
    input: { nodes: input.nodes, edges: input.edges, start },
    result: order,
    resultText: order.join(" "),
    frames,
  };
}

export function simulateTopologicalSort(input: GraphInput): AlgorithmTrace | null {
  const shape = buildGraph(input, true);
  if (!shape) return null;

  const indegree = new Map<string, number>(shape.ids.map((id) => [id, 0]));
  for (const edge of shape.edges) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);

  const ready = shape.ids.filter((id) => indegree.get(id) === 0).sort();
  const frames: TraceFrame[] = [];
  const settled = new Set<string>();
  const order: string[] = [];
  const removed = new Set<number>();
  const queue = [...ready];

  const edgesNow = (): TraceEdge[] =>
    shape.edges.map((edge, index) => (removed.has(index) ? { ...edge, mark: "excluded" as const } : edge));

  const asidesNow = (changed: ReadonlySet<string>): TraceAside[] => [
    aside(
      "deg",
      "in-degree",
      "row",
      shape.ids.map((id) => String(indegree.get(id) ?? 0)),
      shape.ids.length,
      new Map(shape.ids.map((id, index) => [index, changed.has(id) ? ("active" as const) : undefined]).filter((entry): entry is [number, "active"] => entry[1] !== undefined)),
    ),
    aside("queue", "ready", "row", queue.map((id) => shape.labels.get(id)!), shape.ids.length),
    aside("out", "order", "row", order.map((id) => shape.labels.get(id)!), shape.ids.length),
  ];

  // A cycle means there is no order at all, and saying so is the answer to
  // Course Schedule. Returning null instead drew the canonical DAG for a
  // question whose whole point was that its graph has a cycle.
  if (ready.length === 0) {
    return {
      algorithmId: "topological_sort",
      title: "Topological sort",
      input: { nodes: input.nodes, edges: input.edges },
      result: null,
      resultText: "no valid order: every node waits on another",
      frames: [
        {
          id: "graph",
          caption: "Every node has a prerequisite",
          narrationIntent: `Each arrow points from a prerequisite to the thing that needs it. Count the arrows coming into every node and not one of them is zero, so there is nothing that can be taken first.`,
          state: { kind: "graph", nodes: nodesWith(shape, null, new Set(), settled), edges: shape.edges, directed: true, asides: asidesNow(new Set()) },
        },
        {
          id: "cycle",
          caption: "The nodes wait on each other: no order exists",
          narrationIntent: `Because no in-degree is zero, the nodes form a cycle: each one waits on another that is itself waiting. That is exactly when the answer is that the courses cannot be finished.`,
          state: {
            kind: "graph",
            nodes: shape.ids.map((id) => ({ id, label: shape.labels.get(id)!, mark: "excluded" as const })),
            edges: shape.edges,
            directed: true,
            asides: asidesNow(new Set(shape.ids)),
          },
        },
      ],
    };
  }

  frames.push({
    id: "graph",
    caption: `Ready: ${ready.map((id) => shape.labels.get(id)!).join(", ")}`,
    narrationIntent: `Every arrow points from a prerequisite to the thing that needs it, and the in-degree row counts the arrows coming into each node. ${ready.map((id) => shape.labels.get(id)!).join(" and ")} have nothing pointing at them, so they can go first.`,
    state: {
      kind: "graph",
      nodes: nodesWith(shape, null, new Set(ready), settled),
      edges: edgesNow(),
      directed: true,
      ...(input.positions ? { positions: input.positions } : {}),
      asides: asidesNow(new Set(ready)),
    },
  });

  while (queue.length > 0 && frames.length < MAX_FRAMES) {
    const current = queue.shift()!;
    order.push(current);
    settled.add(current);
    const freed: string[] = [];
    const changed = new Set<string>();
    shape.edges.forEach((edge, index) => {
      if (edge.from !== current || removed.has(index)) return;
      removed.add(index);
      const next = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, next);
      changed.add(edge.to);
      if (next === 0) {
        queue.push(edge.to);
        freed.push(edge.to);
      }
    });
    frames.push({
      id: `take_${current}`,
      caption: `Take ${shape.labels.get(current)}: ${order.map((id) => shape.labels.get(id)!).join(" ")}`,
      narrationIntent: freed.length
        ? `${shape.labels.get(current)} has no prerequisites left, so it is taken and its arrows come off the graph. That drops ${freed.map((id) => shape.labels.get(id)!).join(" and ")} to zero, so ${freed.length === 1 ? "it joins" : "they join"} the ready list.`
        : `${shape.labels.get(current)} is taken and its arrows come off, but nothing reaches zero yet, so the ready list just shrinks.`,
      state: {
        kind: "graph",
        nodes: nodesWith(shape, current, new Set(queue), settled),
        edges: edgesNow(),
        directed: true,
        ...(input.positions ? { positions: input.positions } : {}),
        asides: asidesNow(changed),
      },
    });
  }

  const complete = order.length === shape.ids.length;
  const names = order.map((id) => shape.labels.get(id)!);
  if (complete && frames.length >= 2) {
    frames[frames.length - 1]!.caption = `Order: ${names.join(" ")}`;
  }
  return {
    algorithmId: "topological_sort",
    title: "Topological sort",
    input: { nodes: input.nodes, edges: input.edges },
    result: complete ? names : null,
    resultText: complete ? names.join(" ") : "no valid order",
    frames,
  };
}
