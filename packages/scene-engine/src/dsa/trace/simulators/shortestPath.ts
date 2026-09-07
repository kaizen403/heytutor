/**
 * All-pairs and single-source shortest paths.
 *
 * Floyd-Warshall is the case that failed in production: a `3` belonging in
 * the first data column was drawn in the middle because a model authored the
 * grid and a string-equality heuristic reshaped it. Here the matrix is the
 * algorithm's own `dist` array, emitted as `cells[row][col]` with headers
 * kept in separate fields, so there is no header row to strip and no way for
 * a value to drift out of its address.
 */
import { buildGraph, type GraphInput } from "./graph";
import { aside, type AlgorithmTrace, type TraceCell, type TraceFrame, type TraceNode } from "../types";

const INFINITY_TEXT = "∞";
const MAX_FRAMES = 6;

export interface FloydWarshallInput {
  nodes: Array<{ id: string; label?: string }>;
  edges: Array<{ from: string; to: string; weight: number }>;
}

export function simulateFloydWarshall(input: FloydWarshallInput): AlgorithmTrace | null {
  const ids = input.nodes.map((node) => node.id);
  if (ids.length < 3 || ids.length > 5) return null;
  if (new Set(ids).size !== ids.length) return null;
  const labels = input.nodes.map((node) => node.label ?? node.id);
  const indexOf = new Map(ids.map((id, index) => [id, index]));

  const size = ids.length;
  const dist: number[][] = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => (row === col ? 0 : Number.POSITIVE_INFINITY)),
  );
  for (const edge of input.edges) {
    const from = indexOf.get(edge.from);
    const to = indexOf.get(edge.to);
    if (from === undefined || to === undefined) return null;
    if (!Number.isFinite(edge.weight) || edge.weight < 0) return null;
    dist[from]![to] = Math.min(dist[from]![to]!, edge.weight);
    dist[to]![from] = Math.min(dist[to]![from]!, edge.weight);
  }

  const gridOf = (through: number | null, changed: ReadonlySet<string>): TraceCell[][] =>
    dist.map((row, r) =>
      row.map((value, c): TraceCell => {
        const text = Number.isFinite(value) ? String(value) : INFINITY_TEXT;
        if (changed.has(`${r},${c}`)) return { text, mark: "active" };
        if (through !== null && (r === through || c === through)) return { text, mark: "window" };
        if (r === c) return { text, mark: "done" };
        return { text };
      }),
    );

  const frames: TraceFrame[] = [];
  frames.push({
    id: "init",
    caption: "Direct edges only",
    narrationIntent: `The table starts as the graph itself: zero on the diagonal, the edge weight where an edge exists, and infinity everywhere else. Row ${labels[0]}, column ${labels[1]} holds the direct distance from ${labels[0]} to ${labels[1]}.`,
    state: { kind: "grid", rowLabels: labels, colLabels: labels, cells: gridOf(null, new Set()) },
  });

  for (let k = 0; k < size && frames.length < MAX_FRAMES; k += 1) {
    const changed = new Set<string>();
    const changeNotes: string[] = [];
    for (let i = 0; i < size; i += 1) {
      for (let j = 0; j < size; j += 1) {
        const candidate = dist[i]![k]! + dist[k]![j]!;
        if (candidate < dist[i]![j]!) {
          if (i < j) {
            changeNotes.push(
              `${labels[i]} to ${labels[j]} becomes ${dist[i]![k]} plus ${dist[k]![j]} which is ${candidate}`,
            );
          }
          dist[i]![j] = candidate;
          changed.add(`${i},${j}`);
        }
      }
    }
    frames.push({
      id: `via_${ids[k]}`,
      caption: `Routing through ${labels[k]}`,
      narrationIntent: changed.size
        ? `The dashed row and column are the distances to and from ${labels[k]}. Allowing ${labels[k]} as a stopover improves ${changed.size} ${changed.size === 1 ? "entry" : "entries"}: ${changeNotes.slice(0, 3).join(", ")}.`
        : `The dashed row and column are the distances to and from ${labels[k]}. Adding every one of those pairs gives nothing shorter than the table already holds, so this round changes nothing.`,
      state: { kind: "grid", rowLabels: labels, colLabels: labels, cells: gridOf(k, changed) },
    });
  }

  if (frames.length >= 2) {
    frames[frames.length - 1]!.caption = `Every pair is now its shortest distance`;
  }
  return {
    algorithmId: "floyd_warshall",
    title: "Floyd-Warshall all-pairs shortest paths",
    input: { nodes: input.nodes, edges: input.edges },
    result: dist.map((row) => row.map((value) => (Number.isFinite(value) ? value : null))),
    // The answer here is the finished table, which the board is showing; the
    // spoken form says that rather than reading out sixteen numbers.
    resultText: "every pair now holds its shortest distance",
    frames,
  };
}

export function simulateDijkstra(input: GraphInput & { start?: string }): AlgorithmTrace | null {
  const shape = buildGraph(input, false);
  if (!shape) return null;
  const start = input.start ?? shape.ids[0]!;
  if (!shape.labels.has(start)) return null;

  const weight = new Map<string, number>();
  for (const edge of input.edges) {
    if (edge.weight === undefined || !Number.isFinite(edge.weight) || edge.weight < 0) return null;
    weight.set(`${edge.from}|${edge.to}`, edge.weight);
    weight.set(`${edge.to}|${edge.from}`, edge.weight);
  }

  const dist = new Map<string, number>(shape.ids.map((id) => [id, Number.POSITIVE_INFINITY]));
  dist.set(start, 0);
  const settled = new Set<string>();
  const frames: TraceFrame[] = [];

  const nodesNow = (active: string | null): TraceNode[] =>
    shape.ids.map((id) => ({
      id,
      label: shape.labels.get(id)!,
      ...(id === active
        ? { mark: "active" as const }
        : settled.has(id)
          ? { mark: "done" as const }
          : Number.isFinite(dist.get(id)!)
            ? { mark: "candidate" as const }
            : {}),
    }));

  // The distance table is what a teacher writes beside the graph and updates;
  // packing "A 3" into the node label made a six-node graph unreadable and
  // still showed no history.
  const distanceAside = (changed: ReadonlySet<string>) => [
    aside("nodeh", "node", "row", shape.ids.map((id) => shape.labels.get(id)!), shape.ids.length),
    aside(
      "dist",
      "dist",
      "row",
      shape.ids.map((id) => {
        const value = dist.get(id)!;
        return Number.isFinite(value) ? String(value) : INFINITY_TEXT;
      }),
      shape.ids.length,
      new Map(
        shape.ids
          .map((id, index): [number, "active" | "done"] | null =>
            changed.has(id) ? [index, "active"] : settled.has(id) ? [index, "done"] : null)
          .filter((entry): entry is [number, "active" | "done"] => entry !== null),
      ),
    ),
  ];

  frames.push({
    id: "init",
    caption: `Start at ${shape.labels.get(start)}`,
    narrationIntent: `The table under the graph holds the best distance known so far from ${shape.labels.get(start)} to every node. The source is zero and everything else is infinity, because no route to them has been found yet.`,
    state: {
      kind: "graph",
      nodes: nodesNow(start),
      edges: shape.edges,
      ...(input.positions ? { positions: input.positions } : {}),
      asides: distanceAside(new Set([start])),
    },
  });

  while (settled.size < shape.ids.length && frames.length < MAX_FRAMES) {
    let current: string | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const id of shape.ids) {
      if (settled.has(id)) continue;
      const value = dist.get(id)!;
      if (value < best) {
        best = value;
        current = id;
      }
    }
    if (!current) break;
    settled.add(current);
    const improved: Array<{ id: string; text: string }> = [];
    for (const neighbour of shape.adjacency.get(current) ?? []) {
      if (settled.has(neighbour)) continue;
      const edgeWeight = weight.get(`${current}|${neighbour}`);
      if (edgeWeight === undefined) continue;
      const candidate = best + edgeWeight;
      const previous = dist.get(neighbour)!;
      if (candidate < previous) {
        dist.set(neighbour, candidate);
        improved.push({
          id: neighbour,
          text: `${best} plus ${edgeWeight} is ${candidate}, which beats ${Number.isFinite(previous) ? previous : "infinity"} for ${shape.labels.get(neighbour)}`,
        });
      }
    }
    frames.push({
      id: `settle_${current}`,
      caption: `${shape.labels.get(current)} settled at ${best}`,
      narrationIntent: improved.length
        ? `${shape.labels.get(current)} has the smallest distance still open, so ${best} is final: no later route can beat it. Relaxing its edges gives ${improved.map((entry) => entry.text).join(", and ")}.`
        : `${shape.labels.get(current)} is settled at ${best}. Every neighbour already has a route at least as short, so nothing in the table changes.`,
      state: {
        kind: "graph",
        nodes: nodesNow(current),
        edges: shape.edges,
        ...(input.positions ? { positions: input.positions } : {}),
        asides: distanceAside(new Set(improved.map((entry) => entry.id))),
      },
    });
  }

  const finalDistances = shape.ids.map((id) => {
    const value = dist.get(id)!;
    return `${shape.labels.get(id)}=${Number.isFinite(value) ? value : INFINITY_TEXT}`;
  });
  if (frames.length >= 2) frames[frames.length - 1]!.caption = `Final: ${finalDistances.join(" ")}`.slice(0, 60);
  return {
    algorithmId: "dijkstra",
    title: "Dijkstra's shortest path",
    input: { nodes: input.nodes, edges: input.edges, start },
    result: Object.fromEntries(
      [...dist].map(([id, value]) => [shape.labels.get(id)!, Number.isFinite(value) ? value : null]),
    ),
    resultText: finalDistances.join(" "),
    frames,
  };
}
