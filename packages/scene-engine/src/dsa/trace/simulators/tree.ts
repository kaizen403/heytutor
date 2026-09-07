/**
 * Binary tree traversals and BST search.
 *
 * A traversal is the order things come out in, so the output list is drawn as
 * a row under the tree and fills one cell per frame. Without it the board was
 * the same picture on every frame with the spotlight moved, and the sequence
 * lived only in the caption.
 */
import { aside, type AlgorithmTrace, type TraceEdge, type TraceFrame, type TraceNode } from "../types";

export interface TreeInput {
  /** Level-order values; `null` marks an absent child. */
  levelOrder: Array<number | string | null>;
}

export interface BstSearchInput extends TreeInput {
  target: number;
}

export type TraversalOrder = "inorder" | "preorder" | "postorder" | "levelorder";

interface TreeShape {
  ids: string[];
  labels: Map<string, string>;
  left: Map<string, string | null>;
  right: Map<string, string | null>;
  edges: TraceEdge[];
  root: string;
}

function buildTree(levelOrder: Array<number | string | null>): TreeShape | null {
  const present = levelOrder.filter((value) => value !== null);
  if (present.length < 3 || present.length > 9) return null;
  if (levelOrder[0] === null || levelOrder[0] === undefined) return null;

  const ids: string[] = [];
  const labels = new Map<string, string>();
  const left = new Map<string, string | null>();
  const right = new Map<string, string | null>();
  const edges: TraceEdge[] = [];

  levelOrder.forEach((value, index) => {
    if (value === null || value === undefined) return;
    const id = `t${index}`;
    ids.push(id);
    labels.set(id, String(value));
  });

  const idAt = (index: number): string | null => {
    const value = levelOrder[index];
    return value === null || value === undefined ? null : `t${index}`;
  };

  levelOrder.forEach((value, index) => {
    if (value === null || value === undefined) return;
    const id = `t${index}`;
    const l = idAt(2 * index + 1);
    const r = idAt(2 * index + 2);
    left.set(id, l);
    right.set(id, r);
    if (l) edges.push({ from: id, to: l });
    if (r) edges.push({ from: id, to: r });
  });

  // A child whose parent slot is empty would draw a floating node.
  for (const id of ids) {
    const index = Number(id.slice(1));
    if (index === 0) continue;
    const parent = Math.floor((index - 1) / 2);
    if (levelOrder[parent] === null || levelOrder[parent] === undefined) return null;
  }

  return { ids, labels, edges, left, right, root: "t0" };
}

function visitOrder(shape: TreeShape, order: TraversalOrder): string[] {
  const out: string[] = [];
  if (order === "levelorder") {
    const queue = [shape.root];
    while (queue.length > 0) {
      const id = queue.shift()!;
      out.push(id);
      const l = shape.left.get(id);
      const r = shape.right.get(id);
      if (l) queue.push(l);
      if (r) queue.push(r);
    }
    return out;
  }
  const walk = (id: string | null | undefined): void => {
    if (!id) return;
    if (order === "preorder") out.push(id);
    walk(shape.left.get(id));
    if (order === "inorder") out.push(id);
    walk(shape.right.get(id));
    if (order === "postorder") out.push(id);
  };
  walk(shape.root);
  return out;
}

const MAX_FRAMES = 10;

export function simulateTreeTraversal(
  input: TreeInput & { order: TraversalOrder },
): AlgorithmTrace | null {
  const shape = buildTree(input.levelOrder);
  if (!shape) return null;
  const order = visitOrder(shape, input.order);
  const frames: TraceFrame[] = [];

  const nodesAt = (visitedCount: number): TraceNode[] => {
    const settled = new Set(order.slice(0, visitedCount));
    const current = order[visitedCount - 1];
    return shape.ids.map((id) => ({
      id,
      label: shape.labels.get(id)!,
      ...(id === current ? { mark: "active" as const } : settled.has(id) ? { mark: "done" as const } : {}),
    }));
  };

  const outputAside = (visitedCount: number) => [
    aside("out", "output", "row", order.slice(0, visitedCount).map((id) => shape.labels.get(id)!), order.length,
      new Map(visitedCount > 0 ? [[visitedCount - 1, "active" as const]] : [])),
  ];

  frames.push({
    id: "shape",
    caption: `${shape.ids.length}-node tree`,
    narrationIntent: `Here is the tree. ${labelOf(input.order)} decides when a node is written down relative to its children, and that single choice is the whole difference between the traversals. The row underneath is the output as it fills.`,
    state: { kind: "tree", nodes: nodesAt(0), edges: shape.edges, asides: outputAside(0) },
  });

  // One frame per visited node up to the budget; a nine-node tree fits.
  const steps = Math.min(MAX_FRAMES - 1, order.length);
  for (let step = 1; step <= steps; step += 1) {
    const visited = Math.round((order.length * step) / steps);
    const sequence = order.slice(0, visited).map((id) => shape.labels.get(id)!);
    const current = shape.labels.get(order[visited - 1]!)!;
    frames.push({
      id: `visit${step}`,
      caption: sequence.join(" "),
      narrationIntent:
        visited === order.length
          ? `The last node written down is ${current}, so the full ${input.order} sequence is ${sequence.join(", ")}. Every node was reached exactly once.`
          : `${current} is written down next, so the output so far reads ${sequence.join(", ")}.`,
      state: { kind: "tree", nodes: nodesAt(visited), edges: shape.edges, asides: outputAside(visited) },
    });
  }

  const sequence = order.map((id) => shape.labels.get(id)!);
  return {
    algorithmId: `tree_${input.order}`,
    title: `${labelOf(input.order)} traversal`,
    input: { levelOrder: input.levelOrder, order: input.order },
    result: sequence,
    resultText: sequence.join(" "),
    frames,
  };
}

function labelOf(order: TraversalOrder): string {
  if (order === "inorder") return "Inorder";
  if (order === "preorder") return "Preorder";
  if (order === "postorder") return "Postorder";
  return "Level-order";
}

export function simulateBstSearch(input: BstSearchInput): AlgorithmTrace | null {
  const shape = buildTree(input.levelOrder);
  if (!shape) return null;

  const frames: TraceFrame[] = [];
  const path: string[] = [];
  const pruned = new Set<string>();
  let current: string | null = shape.root;
  let found = false;

  /** Every node under `id`, so a ruled-out subtree can be struck through. */
  const subtree = (id: string | null | undefined): string[] => {
    if (!id) return [];
    return [id, ...subtree(shape.left.get(id)), ...subtree(shape.right.get(id))];
  };

  while (current && frames.length < MAX_FRAMES) {
    const node: string = current;
    path.push(node);
    const value: number = Number(shape.labels.get(node));
    if (Number.isNaN(value)) return null;
    const settled = new Set(path);
    const nodes = (active: string | null): TraceNode[] => shape.ids.map((id) => ({
      id,
      label: shape.labels.get(id)!,
      ...(id === active
        ? { mark: "active" as const }
        : pruned.has(id)
          ? { mark: "excluded" as const }
          : settled.has(id)
            ? { mark: "done" as const }
            : {}),
    }));

    if (value === input.target) {
      found = true;
      frames.push({
        id: "found",
        caption: `found ${value} after ${path.length} step${path.length === 1 ? "" : "s"}`,
        narrationIntent: `This node holds the target. The search touched ${path.length} of the ${shape.ids.length} nodes, because every comparison threw away a whole subtree.`,
        state: { kind: "tree", nodes: nodes(node), edges: shape.edges, annotations: [{ nodeId: node, text: `= ${input.target}` }] },
      });
      break;
    }
    const goLeft: boolean = input.target < value;
    for (const id of subtree(goLeft ? shape.right.get(node) : shape.left.get(node))) pruned.add(id);
    frames.push({
      id: `probe${frames.length}`,
      caption: `${input.target} ${goLeft ? "<" : ">"} ${value}, go ${goLeft ? "left" : "right"}`,
      narrationIntent: `${input.target} is ${goLeft ? "smaller" : "larger"} than ${value}. In a search tree every value on the ${goLeft ? "right" : "left"} of ${value} is ${goLeft ? "larger" : "smaller"} still, so that entire subtree is struck out in one comparison.`,
      state: {
        kind: "tree",
        nodes: nodes(node),
        edges: shape.edges,
        annotations: [{ nodeId: node, text: `${input.target}${goLeft ? "<" : ">"}${value}` }],
      },
    });
    current = (goLeft ? shape.left.get(node) : shape.right.get(node)) ?? null;
  }

  // Walking off the tree is an answer, and the walk used to stop without one.
  if (!found && frames.length < MAX_FRAMES) {
    frames.push({
      id: "absent",
      caption: `${input.target} is not in the tree`,
      narrationIntent: `The next step would go to a child that does not exist, so there is nowhere left the target could be hiding. The search returns nothing, after ${path.length} comparison${path.length === 1 ? "" : "s"}.`,
      state: {
        kind: "tree",
        nodes: shape.ids.map((id) => ({ id, label: shape.labels.get(id)!, mark: "excluded" as const })),
        edges: shape.edges,
      },
    });
  }

  if (frames.length < 2) return null;
  return {
    algorithmId: "bst_search",
    title: "Search a binary search tree",
    input: { levelOrder: input.levelOrder, target: input.target },
    result: found ? path.map((id) => shape.labels.get(id)!) : null,
    resultText: found ? `found ${input.target}` : `${input.target} is not present`,
    earlyExit: found && path.length < shape.ids.length,
    frames,
  };
}
