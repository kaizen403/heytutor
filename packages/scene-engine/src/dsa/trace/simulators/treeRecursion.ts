/**
 * Recursion over a binary tree: invert, validate, lowest common ancestor,
 * maximum path sum, preorder serialization, and search-tree insertion.
 *
 * These six differ from the traversal walk in one way, and that difference
 * decides the whole rendering. A traversal has exactly one piece of state,
 * the output list, so a row under the tree is enough. A recursion instead
 * carries state DOWN a branch (the (low, high) window a subtree has to sit
 * inside) or hands a value back UP (the gain a subtree can contribute), and
 * that carried state is the entire teaching content. A board that only moves
 * a spotlight over the nodes shows the shape of the walk and hides the reason
 * it is correct, which is exactly how a student writes the naive
 * `node.left.val < node.val` check for Validate BST, watches it pass every
 * small example, and never learns why it is wrong.
 *
 * So every simulator here puts the carried state in `annotations` beside the
 * node it belongs to, and the frame `note` holds the call that is open and
 * what it returned. Two consequences follow:
 *
 * **The figure never moves.** `layoutNodes` and `layoutEdges` are fixed for
 * the whole trace, so the recursion is the only thing that changes between
 * frames. Where the drawn tree really does change (invert moves subtrees,
 * insertion grows one) the layout skeleton is the union of every shape the
 * walk passes through, and node ids address a POSITION rather than a value.
 * The alternative, laying out each frame on its own, makes a node hop across
 * the board between frames and the student reads the hop as part of the
 * algorithm.
 *
 * **Nulls and bounds are drawn, not implied.** The empty child is what makes
 * a preorder serialization reconstructable, and the inherited bound is what
 * makes the validity check correct. Both used to live only in prose.
 */
import {
  aside,
  type AlgorithmTrace,
  type TraceEdge,
  type TraceFrame,
  type TraceMark,
  type TraceNode,
  type TreeAnnotation,
} from "../types";

/** Heap-indexed level order, `null` for an absent child. */
export interface TreeRecursionInput {
  levelOrder: Array<number | null>;
}

export interface BstLcaInput extends TreeRecursionInput {
  p: number;
  q: number;
}

export interface BstInsertInput {
  values: number[];
}

/**
 * A tree smaller than three nodes has no recursion worth drawing, and one
 * larger than seven stops fitting the board: the leaf spacing is fixed, so an
 * eighth leaf pushes the figure wider than the diagram zone and every value
 * shrinks with it.
 */
const MIN_NODES = 3;
const MAX_NODES = 7;

/** Deep enough for seven nodes with room to spare; a runaway index is a bug. */
const MAX_SLOT = 255;

const NEG_INF = "-∞";
const POS_INF = "∞";

interface TreeShape {
  /** Node ids in heap-slot order. `t{slot}` is stable across every frame. */
  ids: string[];
  slotOf: Map<string, number>;
  labels: Map<string, string>;
  values: Map<string, number>;
  left: Map<string, string | null>;
  right: Map<string, string | null>;
  /** The unmarked full tree, reused verbatim as every frame's layout. */
  nodes: TraceNode[];
  edges: TraceEdge[];
  root: string;
}

/**
 * Heap-indexed level order into a tree. `parseLevelOrder` has already turned
 * LeetCode's compact form into this one, so a null here really is an empty
 * slot rather than a skipped child.
 */
function buildTree(
  levelOrder: ReadonlyArray<number | null>,
  maxNodes: number = MAX_NODES,
): TreeShape | null {
  const first = levelOrder[0];
  if (first === null || first === undefined) return null;
  const present = levelOrder.filter((value): value is number => value !== null && value !== undefined);
  if (present.length < MIN_NODES || present.length > maxNodes) return null;
  if (present.some((value) => !Number.isFinite(value))) return null;
  if (levelOrder.length > MAX_SLOT) return null;

  // A node whose parent slot is empty would be drawn floating beside the tree.
  for (let slot = 1; slot < levelOrder.length; slot += 1) {
    const value = levelOrder[slot];
    if (value === null || value === undefined) continue;
    const parent = levelOrder[Math.floor((slot - 1) / 2)];
    if (parent === null || parent === undefined) return null;
  }

  const ids: string[] = [];
  const slotOf = new Map<string, number>();
  const labels = new Map<string, string>();
  const values = new Map<string, number>();
  const left = new Map<string, string | null>();
  const right = new Map<string, string | null>();
  const edges: TraceEdge[] = [];

  const idAt = (slot: number): string | null => {
    const value = levelOrder[slot];
    return value === null || value === undefined ? null : `t${slot}`;
  };

  levelOrder.forEach((value, slot) => {
    if (value === null || value === undefined) return;
    const id = `t${slot}`;
    ids.push(id);
    slotOf.set(id, slot);
    labels.set(id, String(value));
    values.set(id, value);
  });

  for (const id of ids) {
    const slot = slotOf.get(id)!;
    const l = idAt(2 * slot + 1);
    const r = idAt(2 * slot + 2);
    left.set(id, l);
    right.set(id, r);
    if (l) edges.push({ from: id, to: l });
    if (r) edges.push({ from: id, to: r });
  }

  const nodes = ids.map((id): TraceNode => ({ id, label: labels.get(id)! }));
  return { ids, slotOf, labels, values, left, right, nodes, edges, root: "t0" };
}

/** Every node under `id` inclusive, so a whole branch can be struck out. */
function subtree(shape: TreeShape, id: string | null | undefined): string[] {
  if (!id) return [];
  return [id, ...subtree(shape, shape.left.get(id)), ...subtree(shape, shape.right.get(id))];
}

function nodesWith(shape: TreeShape, marks: ReadonlyMap<string, TraceMark>): TraceNode[] {
  return shape.ids.map((id): TraceNode => {
    const label = shape.labels.get(id)!;
    const mark = marks.get(id);
    return mark ? { id, label, mark } : { id, label };
  });
}

/**
 * The layout skeleton every frame shares. Handed out as the same two arrays
 * for every frame of a trace, which is safe only because nothing here ever
 * mutates a frame's state after building it.
 */
function fixedLayout(shape: TreeShape): { layoutNodes: TraceNode[]; layoutEdges: TraceEdge[] } {
  return { layoutNodes: shape.nodes, layoutEdges: shape.edges };
}

// ---------------------------------------------------------------------------
// Invert a binary tree (LeetCode 226)
// ---------------------------------------------------------------------------

/**
 * Move the subtree rooted at slot `from` to slot `to`, reading the old map and
 * writing into `into`. Used twice per swap, once each way, so both reads see
 * the arrangement from before the swap.
 */
function relocate(
  slots: ReadonlyMap<number, number>,
  into: Map<number, number>,
  from: number,
  to: number,
): boolean {
  const value = slots.get(from);
  if (value === undefined) return true;
  if (to > MAX_SLOT) return false;
  into.set(to, value);
  return relocate(slots, into, 2 * from + 1, 2 * to + 1)
    && relocate(slots, into, 2 * from + 2, 2 * to + 2);
}

/** Exchange the two subtrees hanging off slot `at`. */
function swapChildren(slots: Map<number, number>, at: number): boolean {
  const l = 2 * at + 1;
  const r = 2 * at + 2;
  const moved = new Map<number, number>();
  if (!relocate(slots, moved, l, r)) return false;
  if (!relocate(slots, moved, r, l)) return false;
  const clear = (root: number): void => {
    if (!slots.has(root)) return;
    slots.delete(root);
    clear(2 * root + 1);
    clear(2 * root + 2);
  };
  clear(l);
  clear(r);
  for (const [slot, value] of moved) slots.set(slot, value);
  return true;
}

/** LeetCode's compact level order, trailing nulls dropped. */
function compactLevelOrder(slots: ReadonlyMap<number, number>): Array<number | null> {
  const root = slots.get(0);
  if (root === undefined) return [];
  const out: Array<number | null> = [root];
  const queue = [0];
  while (queue.length > 0) {
    const slot = queue.shift()!;
    for (const child of [2 * slot + 1, 2 * slot + 2]) {
      const value = slots.get(child);
      if (value === undefined) {
        out.push(null);
      } else {
        out.push(value);
        queue.push(child);
      }
    }
  }
  while (out.length > 0 && out[out.length - 1] === null) out.pop();
  return out;
}

function slotNodes(slots: ReadonlyMap<number, number>, marks: ReadonlyMap<number, TraceMark>): TraceNode[] {
  return [...slots.keys()].sort((a, b) => a - b).map((slot): TraceNode => {
    const label = String(slots.get(slot)!);
    const mark = marks.get(slot);
    return mark ? { id: `t${slot}`, label, mark } : { id: `t${slot}`, label };
  });
}

function slotEdges(slots: ReadonlyMap<number, number>): TraceEdge[] {
  return [...slots.keys()]
    .sort((a, b) => a - b)
    .filter((slot) => slot > 0)
    .map((slot): TraceEdge => ({ from: `t${Math.floor((slot - 1) / 2)}`, to: `t${slot}` }));
}

/** Breadth-first values, which is how a teacher reads a tree back out loud. */
function levelOrderText(slots: ReadonlyMap<number, number>): string {
  return compactLevelOrder(slots)
    .filter((value): value is number => value !== null)
    .join(" ");
}

/**
 * Invert a binary tree.
 *
 * The board addresses POSITIONS, not values: `t5` is the slot five, and the
 * number drawn in it changes when a subtree moves through it. Giving the id
 * to the value instead is the tempting reading, and it is the wrong one here
 * — every frame would then need its own layout, the nodes would slide across
 * the board, and the sliding, rather than the mirroring, is what a student
 * would take away. Positions stay put and the values cross over them, which
 * is what "mirror the tree" looks like when a teacher draws it.
 */
export function simulateTreeInvert(input: TreeRecursionInput): AlgorithmTrace | null {
  const shape = buildTree(input.levelOrder);
  if (!shape) return null;

  const slots = new Map<number, number>();
  input.levelOrder.forEach((value, slot) => {
    if (value !== null && value !== undefined) slots.set(slot, value);
  });

  const before = new Map(slots);
  const snapshots: Array<{ at: number; slots: Map<number, number> }> = [];

  // Swap first, then recurse: the recursion walks the tree it has just
  // rearranged, which is what the two-line solution actually does.
  const walk = (slot: number): boolean => {
    if (!slots.has(slot)) return true;
    const l = 2 * slot + 1;
    const r = 2 * slot + 2;
    if (slots.has(l) || slots.has(r)) {
      if (!swapChildren(slots, slot)) return false;
      snapshots.push({ at: slot, slots: new Map(slots) });
    }
    return walk(l) && walk(r);
  };
  if (!walk(0)) return null;
  if (snapshots.length < 1 || snapshots.length > 12) return null;

  // Union of every arrangement, so a slot that is only occupied part way
  // through the walk still has a position reserved for it from frame one.
  const union = new Set<number>([...before.keys()]);
  for (const snapshot of snapshots) for (const slot of snapshot.slots.keys()) union.add(slot);
  const unionSlots = [...union].sort((a, b) => a - b);
  for (const slot of unionSlots) {
    if (slot > 0 && !union.has(Math.floor((slot - 1) / 2))) return null;
  }
  const layoutNodes = unionSlots.map((slot): TraceNode => ({ id: `t${slot}`, label: "" }));
  const layoutEdges = unionSlots
    .filter((slot) => slot > 0)
    .map((slot): TraceEdge => ({ from: `t${Math.floor((slot - 1) / 2)}`, to: `t${slot}` }));

  const frames: TraceFrame[] = [];
  frames.push({
    id: "before",
    caption: "invert mirrors every node's two children",
    narrationIntent:
      `This is the tree before anything moves. Inverting it means every node hands its left child to the right and its right child to the left, all the way down, and the whole solution is that one swap repeated by recursion.`,
    state: {
      kind: "tree",
      nodes: slotNodes(before, new Map([[0, "active"]])),
      edges: slotEdges(before),
      layoutNodes,
      layoutEdges,
      annotations: [{ nodeId: "t0", text: "start" }],
      note: `invert(${before.get(0)!})`,
    },
  });

  const settled = new Set<number>();
  for (const [step, snapshot] of snapshots.entries()) {
    const at = snapshot.at;
    settled.add(at);
    const value = snapshot.slots.get(at)!;
    const l = snapshot.slots.get(2 * at + 1);
    const r = snapshot.slots.get(2 * at + 2);
    const marks = new Map<number, TraceMark>();
    for (const done of settled) marks.set(done, "done");
    if (l !== undefined) marks.set(2 * at + 1, "active");
    if (r !== undefined) marks.set(2 * at + 2, "active");

    const both = l !== undefined && r !== undefined;
    const only = l ?? r;
    const side = l !== undefined ? "left" : "right";
    frames.push({
      id: `swap${step}`,
      caption: both
        ? `${value} swaps its children: ${l} left, ${r} right`
        : `${value} has one child, so ${only} moves ${side}`,
      narrationIntent: both
        ? `The call on ${value} exchanges its two subtrees, so ${l} and everything under it is now the left branch and ${r} and everything under it is the right. Nothing inside either subtree has been touched yet; the recursion will do the same swap there next.`
        : `${value} has only one child, and the swap still applies: the empty side and the branch holding ${only} trade places, which moves ${only} to the ${side}. Forgetting this case is what leaves a lopsided tree half inverted.`,
      state: {
        kind: "tree",
        nodes: slotNodes(snapshot.slots, marks),
        edges: slotEdges(snapshot.slots),
        layoutNodes,
        layoutEdges,
        annotations: [{ nodeId: `t${at}`, text: "L↔R" }],
        note: `invert(${value})   swap done`,
      },
    });
  }

  const final = snapshots[snapshots.length - 1]!.slots;
  const reading = levelOrderText(final);
  frames.push({
    id: "inverted",
    caption: `inverted: ${reading}`,
    narrationIntent:
      `Every node has now had its turn, so read the finished tree level by level and it comes out ${reading.split(" ").join(", ")}. The leaves needed no work at all, which is why the base case is simply returning an empty branch untouched.`,
    state: {
      kind: "tree",
      nodes: slotNodes(final, new Map([...final.keys()].map((slot) => [slot, "done" as const]))),
      edges: slotEdges(final),
      layoutNodes,
      layoutEdges,
      note: "every node inverted",
    },
  });

  if (frames.length < 2 || frames.length > 16) return null;
  return {
    algorithmId: "tree_invert_recursion",
    title: "Invert a binary tree",
    input: { levelOrder: input.levelOrder },
    result: compactLevelOrder(final),
    resultText: reading,
    frames,
  };
}

// ---------------------------------------------------------------------------
// Validate a binary search tree (LeetCode 98)
// ---------------------------------------------------------------------------

/**
 * Validate a BST by carrying a (low, high) window down each branch.
 *
 * The bounds ARE the lesson. Checking a node only against its own two
 * children passes the classic counterexample, where a value smaller than the
 * root sits two levels down inside the root's right subtree, so the board has
 * to show the window narrowing as the recursion descends or the student never
 * sees why the local check is not enough. The window is annotated beside the
 * node it applies to, and the failing node keeps its window on screen while
 * the verdict is drawn.
 */
export function simulateBstValidate(input: TreeRecursionInput): AlgorithmTrace | null {
  const shape = buildTree(input.levelOrder);
  if (!shape) return null;

  interface Visit {
    id: string;
    low: number | null;
    high: number | null;
    ok: boolean;
  }

  const visits: Visit[] = [];
  const bounds = (low: number | null, high: number | null): string =>
    `(${low === null ? NEG_INF : low},${high === null ? POS_INF : high})`;

  // Preorder, stopping at the first violation: a walk that carried on past a
  // failure would draw checks the real algorithm never runs.
  const check = (id: string | null | undefined, low: number | null, high: number | null): boolean => {
    if (!id) return true;
    const value = shape.values.get(id)!;
    const ok = (low === null || value > low) && (high === null || value < high);
    visits.push({ id, low, high, ok });
    if (!ok) return false;
    return check(shape.left.get(id), low, value) && check(shape.right.get(id), value, high);
  };
  const valid = check(shape.root, null, null);
  if (visits.length === 0 || visits.length > 14) return null;

  const frames: TraceFrame[] = [];
  const settled = new Set<string>();
  for (const [step, visit] of visits.entries()) {
    const value = shape.values.get(visit.id)!;
    const marks = new Map<string, TraceMark>();
    for (const done of settled) marks.set(done, "done");
    marks.set(visit.id, "active");
    const annotations: TreeAnnotation[] = [{ nodeId: visit.id, text: bounds(visit.low, visit.high) }];
    if (visit.ok) {
      // The window each child inherits, drawn on the child rather than said in
      // prose: this is the single step the naive check gets wrong.
      const l = shape.left.get(visit.id);
      const r = shape.right.get(visit.id);
      if (l) annotations.push({ nodeId: l, text: bounds(visit.low, value) });
      if (r) annotations.push({ nodeId: r, text: bounds(value, visit.high) });
    }
    const lowText = visit.low === null ? NEG_INF : String(visit.low);
    const highText = visit.high === null ? POS_INF : String(visit.high);
    frames.push({
      id: `check${step}`,
      caption: visit.ok
        ? `${value} fits ${bounds(visit.low, visit.high)}, so keep going`
        : `${value} must sit inside ${bounds(visit.low, visit.high)}`,
      narrationIntent: visit.ok
        ? `Call ${step + 1} tests ${value} against the window ${lowText} to ${highText}, and it fits. Each child now inherits a narrower window: everything on the left of ${value} must stay below it, everything on the right must stay above it.`
        : `Call ${step + 1} tests ${value} against the window ${lowText} to ${highText}, and it fails. ${value} is a legal child of its own parent, which is why checking parent against child alone would have missed this, but it is on the wrong side of an ancestor further up.`,
      state: {
        kind: "tree",
        nodes: nodesWith(shape, marks),
        edges: shape.edges,
        ...fixedLayout(shape),
        annotations,
        note: `check(${value}, ${lowText}, ${highText})   ${visit.ok ? "ok" : "fails"}`,
      },
    });
    settled.add(visit.id);
  }

  const failure = visits.find((visit) => !visit.ok);
  const finalMarks = new Map<string, TraceMark>();
  if (failure) {
    for (const id of settled) finalMarks.set(id, "done");
    for (const id of subtree(shape, failure.id)) finalMarks.set(id, "excluded");
  } else {
    for (const id of shape.ids) finalMarks.set(id, "done");
  }
  const failValue = failure ? shape.values.get(failure.id)! : 0;
  const failLow = failure && failure.low !== null ? String(failure.low) : NEG_INF;
  frames.push({
    id: "verdict",
    caption: failure
      ? `not a valid BST, ${failValue} breaks the bound ${failLow}`
      : "every node fits its bounds, a valid BST",
    narrationIntent: failure
      ? `The moment one node misses its window the answer is settled, so the recursion returns false all the way up and the rest of that branch is never looked at. One value in the wrong place is enough to disqualify the whole tree.`
      : `Every node was tested against the window it inherited and every one of them fitted, so the answer is true. Notice that the windows alone did the work; no node was ever compared with a node outside its own path.`,
    state: {
      kind: "tree",
      nodes: nodesWith(shape, finalMarks),
      edges: shape.edges,
      ...fixedLayout(shape),
      ...(failure
        ? { annotations: [{ nodeId: failure.id, text: bounds(failure.low, failure.high) }] }
        : {}),
      note: failure ? "returns false" : "returns true",
    },
  });

  if (frames.length < 2 || frames.length > 16) return null;
  return {
    algorithmId: "bst_validate_bounds",
    title: "Validate a binary search tree",
    input: { levelOrder: input.levelOrder },
    result: valid,
    resultText: valid ? "valid BST" : "not a valid BST",
    earlyExit: !valid,
    frames,
  };
}

// ---------------------------------------------------------------------------
// Lowest common ancestor of a BST (LeetCode 235)
// ---------------------------------------------------------------------------

/**
 * Lowest common ancestor in a search tree.
 *
 * The general-tree answer needs a postorder walk that returns from both
 * children; the search tree answer needs neither, because one comparison per
 * node says which way BOTH targets lie. Drawing the discarded subtree struck
 * out on the frame where the comparison happens is what makes that visible:
 * the split node is the first node where the two targets stop agreeing.
 */
export function simulateBstLca(input: BstLcaInput): AlgorithmTrace | null {
  const shape = buildTree(input.levelOrder);
  if (!shape) return null;
  if (!Number.isFinite(input.p) || !Number.isFinite(input.q) || input.p === input.q) return null;

  const low = Math.min(input.p, input.q);
  const high = Math.max(input.p, input.q);
  const holding = (value: number): string | null =>
    shape.ids.find((id) => shape.values.get(id) === value) ?? null;
  const pNode = holding(input.p);
  const qNode = holding(input.q);
  // Both targets must actually be in the tree, or the walk would confidently
  // report an ancestor of a node that is not there.
  if (!pNode || !qNode) return null;

  const targets = new Map<string, TraceMark>([[pNode, "candidate"], [qNode, "candidate"]]);
  const baseMarks = (): Map<string, TraceMark> => new Map(targets);

  const frames: TraceFrame[] = [];
  frames.push({
    id: "targets",
    caption: `find where the paths to ${input.p} and ${input.q} split`,
    narrationIntent:
      `The two nodes we care about are ringed. Their lowest common ancestor is the last node that both paths from the root still share, and in a search tree we can find it without ever walking either path to the end.`,
    state: {
      kind: "tree",
      nodes: nodesWith(shape, baseMarks()),
      edges: shape.edges,
      ...fixedLayout(shape),
      note: `p = ${input.p}   q = ${input.q}`,
    },
  });

  const pruned = new Set<string>();
  const path: string[] = [];
  let current: string | null = shape.root;
  let answer: string | null = null;
  let step = 0;

  while (current && step < 12) {
    const node: string = current;
    const value = shape.values.get(node)!;
    path.push(node);
    const marks = baseMarks();
    for (const id of pruned) marks.set(id, "excluded");
    for (const id of path) if (id !== node) marks.set(id, "done");
    marks.set(node, "active");

    if (high < value || low > value) {
      const goLeft = high < value;
      for (const id of subtree(shape, goLeft ? shape.right.get(node) : shape.left.get(node))) {
        pruned.add(id);
        marks.set(id, "excluded");
      }
      frames.push({
        id: `descend${step}`,
        caption: `${input.p} and ${input.q} are both ${goLeft ? "below" : "above"} ${value}`,
        narrationIntent:
          `At ${value} both targets fall on the ${goLeft ? "left" : "right"}, so their ancestor cannot be ${value} and cannot be anything in the ${goLeft ? "right" : "left"} subtree either. One comparison throws that whole branch away and the walk moves down.`,
        state: {
          kind: "tree",
          nodes: nodesWith(shape, marks),
          edges: shape.edges,
          ...fixedLayout(shape),
          annotations: [{ nodeId: node, text: `${goLeft ? "<" : ">"}${value}` }],
          note: `lca(${value})   go ${goLeft ? "left" : "right"}`,
        },
      });
      current = (goLeft ? shape.left.get(node) : shape.right.get(node)) ?? null;
      step += 1;
      continue;
    }

    // Either the targets straddle this node or one of them IS this node. Both
    // are the same stopping rule, and both make this node the answer.
    answer = node;
    const isTarget = value === input.p || value === input.q;
    frames.push({
      id: `split${step}`,
      caption: isTarget
        ? `${value} is one of the two nodes, so it is the answer`
        : `${low} is left of ${value} and ${high} is right`,
      narrationIntent: isTarget
        ? `The walk has arrived at ${value}, which is one of the two nodes we are looking for. A node counts as its own descendant, so the search stops here rather than going further down past one of the targets.`
        : `At ${value} the two targets disagree for the first time: ${low} belongs in the left subtree and ${high} in the right. The paths part here, so ${value} is the last node they share.`,
      state: {
        kind: "tree",
        nodes: nodesWith(shape, marks),
        edges: shape.edges,
        ...fixedLayout(shape),
        annotations: [{ nodeId: node, text: "split" }],
        note: `lca(${value})   stop`,
      },
    });
    break;
  }

  if (!answer) return null;
  const answerValue = shape.values.get(answer)!;
  const finalMarks = baseMarks();
  for (const id of pruned) finalMarks.set(id, "excluded");
  for (const id of path) finalMarks.set(id, "done");
  frames.push({
    id: "ancestor",
    caption: `${input.p} and ${input.q} meet at ${answerValue}, so the LCA is ${answerValue}`,
    narrationIntent:
      `The answer is ${answerValue}. The walk touched ${path.length} node${path.length === 1 ? "" : "s"} out of ${shape.ids.length}, because in a search tree the comparison at each node settles the direction for both targets at once, which is why no recursion back up the tree is needed.`,
    state: {
      kind: "tree",
      nodes: nodesWith(shape, finalMarks),
      edges: shape.edges,
      ...fixedLayout(shape),
      annotations: [{ nodeId: answer, text: "LCA" }],
      note: `lca(${input.p}, ${input.q}) = ${answerValue}`,
    },
  });

  if (frames.length < 2 || frames.length > 16) return null;
  return {
    algorithmId: "bst_lca",
    title: "Lowest common ancestor in a BST",
    input: { levelOrder: input.levelOrder, p: input.p, q: input.q },
    result: answerValue,
    resultText: `LCA is ${answerValue}`,
    earlyExit: path.length < shape.ids.length,
    frames,
  };
}

// ---------------------------------------------------------------------------
// Binary tree maximum path sum (LeetCode 124)
// ---------------------------------------------------------------------------

/**
 * Maximum path sum.
 *
 * Two numbers live at every node and confusing them is the whole difficulty
 * of this problem: the gain a node can hand UPWARD, which may use only one of
 * its branches, and the best path THROUGH the node, which may use both and
 * can therefore never be passed up. A board that writes one number per node
 * teaches that the answer is whatever the root returns, and on the standard
 * example the root returns 25 while the answer is 42.
 *
 * So the annotation beside each node is the gain it returned, the note holds
 * the through-path being scored against the best so far, and the two are
 * never merged.
 */
export function simulateTreeMaxPathSum(input: TreeRecursionInput): AlgorithmTrace | null {
  const shape = buildTree(input.levelOrder);
  if (!shape) return null;

  interface Step {
    id: string;
    gain: number;
    through: number;
    best: number;
    improved: boolean;
    leftGain: number;
    rightGain: number;
  }

  const steps: Step[] = [];
  const gains = new Map<string, number>();
  let best = Number.NEGATIVE_INFINITY;

  // Postorder: a node cannot be scored until both children have returned,
  // which is exactly why the walk goes down before it does any arithmetic.
  const visit = (id: string | null | undefined): number => {
    if (!id) return 0;
    const leftGain = visit(shape.left.get(id));
    const rightGain = visit(shape.right.get(id));
    const value = shape.values.get(id)!;
    const through = value + leftGain + rightGain;
    // A negative branch is dropped rather than carried, which is what the
    // clamp at zero means; the branch is not deleted from the tree.
    const gain = Math.max(0, value + Math.max(leftGain, rightGain));
    const improved = through > best;
    if (improved) best = through;
    gains.set(id, gain);
    steps.push({ id, gain, through, best, improved, leftGain, rightGain });
    return gain;
  };
  visit(shape.root);
  if (steps.length === 0 || steps.length > 14) return null;

  const frames: TraceFrame[] = [];
  frames.push({
    id: "shape",
    caption: "a path may bend at one node and skip the root",
    narrationIntent:
      `Before any arithmetic, notice what counts as a path here: any chain of connected nodes, which may turn a corner at exactly one node and does not have to include the root. That freedom is why every node has to be scored, not just the top one.`,
    state: {
      kind: "tree",
      nodes: nodesWith(shape, new Map()),
      edges: shape.edges,
      ...fixedLayout(shape),
      note: "best = none yet",
    },
  });

  const settled = new Set<string>();
  for (const [step, item] of steps.entries()) {
    const value = shape.values.get(item.id)!;
    const marks = new Map<string, TraceMark>();
    for (const done of settled) marks.set(done, "done");
    marks.set(item.id, "active");
    settled.add(item.id);
    const annotations: TreeAnnotation[] = [...settled].map((id) => ({
      nodeId: id,
      text: `↑${gains.get(id)!}`,
    }));
    const isLeaf = !shape.left.get(item.id) && !shape.right.get(item.id);
    frames.push({
      id: `gain${step}`,
      caption: isLeaf
        ? `leaf ${value} returns ${item.gain}, best is ${item.best}`
        : item.improved
          ? `through ${value} the path sums to ${item.through}, a new best`
          : `through ${value} is only ${item.through}, best stays ${item.best}`,
      narrationIntent: isLeaf
        ? `The call on the leaf ${value} has no children to wait for, so it scores the one node path ${value} and hands ${item.gain} back up as the most this branch can contribute. The running best is now ${item.best}.`
        : `${value} now has both returns, ${item.leftGain} from the left and ${item.rightGain} from the right, so the best path bending at ${value} is worth ${item.through}. Upward it can only offer ${item.gain}, because a parent cannot use both of its branches at once.`,
      state: {
        kind: "tree",
        nodes: nodesWith(shape, marks),
        edges: shape.edges,
        ...fixedLayout(shape),
        annotations,
        note: `gain(${value}) = ${item.gain}   best = ${item.best}`,
      },
    });
  }

  // The winning path: the node the best turn happened at, plus the branches
  // it actually used. Drawing it is the only way the closing number stops
  // being an assertion and becomes something the student can count.
  const bestStep = steps.filter((item) => item.improved).pop() ?? steps[steps.length - 1]!;
  const onPath = new Set<string>([bestStep.id]);
  const descend = (id: string | null | undefined, needed: number): void => {
    if (!id || needed <= 0) return;
    onPath.add(id);
    const l = shape.left.get(id);
    const r = shape.right.get(id);
    const lg = l ? gains.get(l)! : 0;
    const rg = r ? gains.get(r)! : 0;
    if (l && lg >= rg && lg > 0) descend(l, lg);
    else if (r && rg > 0) descend(r, rg);
  };
  if (bestStep.leftGain > 0) descend(shape.left.get(bestStep.id), bestStep.leftGain);
  if (bestStep.rightGain > 0) descend(shape.right.get(bestStep.id), bestStep.rightGain);

  const finalMarks = new Map<string, TraceMark>();
  for (const id of shape.ids) finalMarks.set(id, onPath.has(id) ? "active" : "done");
  frames.push({
    id: "answer",
    caption: `maximum path sum is ${best}`,
    narrationIntent:
      `The answer is ${best}, and the highlighted nodes are the path that produced it. It was recorded when the call on ${shape.labels.get(bestStep.id)} closed, not by anything the root returned, which is why the running best has to be kept outside the recursion.`,
    state: {
      kind: "tree",
      nodes: nodesWith(shape, finalMarks),
      edges: shape.edges,
      ...fixedLayout(shape),
      annotations: [{ nodeId: bestStep.id, text: `${best}` }],
      note: `best = ${best}`,
    },
  });

  if (frames.length < 2 || frames.length > 16) return null;
  return {
    algorithmId: "tree_max_path_sum",
    title: "Binary tree maximum path sum",
    input: { levelOrder: input.levelOrder },
    result: best,
    resultText: `maximum path sum is ${best}`,
    frames,
  };
}

// ---------------------------------------------------------------------------
// Serialize a binary tree, preorder with nulls (LeetCode 297)
// ---------------------------------------------------------------------------

/** Tokens make the row wide; past this the tree itself stops being readable. */
const MAX_SERIAL_TOKENS = 13;

/**
 * Cells one aside row may hold before the figure stops fitting the diagram
 * zone. Measured, not guessed: at the standard 540 by 460 viewport a row of
 * eleven boxes squeezes the tree until a value no longer fits its own circle
 * and the whole trace refuses to compile. A five-node tree serializes to
 * eleven tokens, so the row has to wrap rather than the tree having to shrink.
 */
const MAX_ASIDE_CELLS = 10;

/**
 * Preorder serialization with an explicit marker for every empty child.
 *
 * The markers are the entire reason the string can be read back. A preorder
 * list of values alone does not determine a tree, so a board that draws only
 * the numbers being written teaches a format that cannot be deserialized, and
 * the student discovers this only when the rebuild fails. Every empty child
 * therefore gets its own written token and its own frame, and runs of empty
 * children are grouped so the walk still fits the lesson.
 */
export function simulateTreeSerialize(input: TreeRecursionInput): AlgorithmTrace | null {
  const shape = buildTree(input.levelOrder, 6);
  if (!shape) return null;

  const tokens: Array<{ text: string; nodeId?: string; parentId?: string }> = [];
  const write = (id: string | null | undefined, parentId: string): void => {
    if (!id) {
      tokens.push({ text: "#", parentId });
      return;
    }
    tokens.push({ text: shape.labels.get(id)!, nodeId: id });
    write(shape.left.get(id), id);
    write(shape.right.get(id), id);
  };
  write(shape.root, shape.root);
  if (tokens.length > MAX_SERIAL_TOKENS) return null;

  // Consecutive markers are one board move, not several: a run of them is the
  // recursion unwinding past several empty children in a row.
  const groups: Array<{ from: number; to: number }> = [];
  for (let at = 0; at < tokens.length; at += 1) {
    if (tokens[at]!.nodeId) {
      groups.push({ from: at, to: at });
      continue;
    }
    let end = at;
    while (end + 1 < tokens.length && !tokens[end + 1]!.nodeId) end += 1;
    groups.push({ from: at, to: end });
    at = end;
  }
  if (groups.length + 2 > 16) return null;

  const capacity = tokens.length;
  // One row when it fits, otherwise the line wraps onto a second row that
  // starts at the same left edge, which is what a teacher does when a string
  // runs off the board. The second row carries no title so it reads as a
  // continuation rather than as a different structure.
  const perRow = capacity <= MAX_ASIDE_CELLS ? capacity : Math.ceil(capacity / 2);
  const rows = [
    { id: "out", title: "preorder", from: 0, to: Math.min(perRow, capacity) },
    ...(capacity > perRow ? [{ id: "out2", title: "", from: perRow, to: capacity }] : []),
  ];
  const outAside = (written: number) =>
    rows.map((row) => {
      const last = written - 1;
      const marks = new Map<number, TraceMark>();
      if (last >= row.from && last < row.to) marks.set(last - row.from, "active");
      return aside(
        row.id,
        row.title,
        "row",
        tokens.slice(row.from, Math.max(row.from, Math.min(written, row.to))).map((token) => token.text),
        row.to - row.from,
        marks,
      );
    });

  const frames: TraceFrame[] = [];
  frames.push({
    id: "shape",
    caption: "write the tree down so it can be rebuilt",
    narrationIntent:
      `The job is to turn this tree into one line of text that can be turned back into the same tree. The row underneath is that line as it fills, and the recursion writing it is an ordinary preorder walk with one addition.`,
    state: {
      kind: "tree",
      nodes: nodesWith(shape, new Map()),
      edges: shape.edges,
      ...fixedLayout(shape),
      asides: outAside(0),
      note: "preorder walk",
    },
  });

  const emitted = new Set<string>();
  for (const [step, group] of groups.entries()) {
    const written = group.to + 1;
    const marks = new Map<string, TraceMark>();
    for (const id of emitted) marks.set(id, "done");
    const first = tokens[group.from]!;
    const annotations: TreeAnnotation[] = [];
    let caption: string;
    let narration: string;
    let note: string;

    if (first.nodeId) {
      emitted.add(first.nodeId);
      marks.set(first.nodeId, "active");
      const value = shape.labels.get(first.nodeId)!;
      caption = `write ${value}, then visit its left child`;
      narration =
        `The call on ${value} writes ${value} down first, before either child is looked at. That is what makes this preorder, and it is why the first token of the string is always the root of whatever subtree is being written.`;
      note = `write ${value}`;
    } else {
      const parents: string[] = [];
      for (let at = group.from; at <= group.to; at += 1) {
        const parentId = tokens[at]!.parentId!;
        if (!parents.includes(parentId)) parents.push(parentId);
      }
      for (const parentId of parents) {
        marks.set(parentId, "active");
        annotations.push({ nodeId: parentId, text: "#" });
      }
      const count = group.to - group.from + 1;
      const names = parents.map((id) => shape.labels.get(id)!).join(" and ");
      caption = count === 1
        ? `an empty child of ${names}, so write #`
        : `${count} empty children, so write ${count} of #`;
      narration =
        `The recursion still calls itself on ${count === 1 ? "an empty child" : "each empty child"} of ${names}, and an empty call writes a marker rather than nothing at all. Those markers are what tell the reader where a subtree ends; without them this string would fit several different trees.`;
      note = `write #   ${count} empty`;
    }

    frames.push({
      id: `token${step}`,
      caption,
      narrationIntent: narration,
      state: {
        kind: "tree",
        nodes: nodesWith(shape, marks),
        edges: shape.edges,
        ...fixedLayout(shape),
        ...(annotations.length > 0 ? { annotations } : {}),
        asides: outAside(written),
        note,
      },
    });
  }

  const text = tokens.map((token) => token.text).join(" ");
  frames.push({
    id: "serialized",
    caption: text.length <= 60 ? text : text.slice(0, 60),
    narrationIntent:
      `That is the whole tree as one string. Reading it back is the mirror image: take the next token, and if it is a marker return an empty branch, otherwise make a node and let the same reader fill its left branch and then its right.`,
    state: {
      kind: "tree",
      nodes: nodesWith(shape, new Map(shape.ids.map((id) => [id, "done" as const]))),
      edges: shape.edges,
      ...fixedLayout(shape),
      asides: outAside(capacity),
      note: `${capacity} tokens`,
    },
  });

  if (frames.length < 2 || frames.length > 16) return null;
  if (text.length > 60) return null;
  return {
    algorithmId: "tree_serialize_preorder",
    title: "Serialize a binary tree",
    input: { levelOrder: input.levelOrder },
    result: tokens.map((token) => token.text),
    resultText: text,
    frames,
  };
}

// ---------------------------------------------------------------------------
// Build a BST by insertion (textbook ask)
// ---------------------------------------------------------------------------

/**
 * Insert values into a search tree one at a time.
 *
 * Unlike the other five, the drawn tree here genuinely grows, so this is the
 * case `layoutNodes` exists for: the layout is the FINISHED tree, fixed from
 * the first frame, and each frame draws the part of it that exists so far.
 * Laying out each partial tree on its own would move every node sideways on
 * every insertion, and the sliding reads as part of the algorithm.
 *
 * The whole descent for one value goes on one frame, annotated with the
 * comparison made at each node it passed. Splitting a descent across frames
 * costs six frames for a six-value build and buries the point, which is that
 * the search for where a value goes is the same walk as searching for it.
 */
export function simulateBstInsert(input: BstInsertInput): AlgorithmTrace | null {
  const values = input.values;
  if (values.length < 3 || values.length > MAX_NODES) return null;
  if (values.some((value) => !Number.isFinite(value))) return null;
  // A repeat has no agreed behaviour (skip, or count it) and drawing either
  // as if it were the rule would teach a convention rather than the algorithm.
  if (new Set(values).size !== values.length) return null;

  interface Built {
    id: string;
    value: number;
    left: string | null;
    right: string | null;
  }
  const byId = new Map<string, Built>();
  const order: string[] = [];
  const paths: Array<Array<{ id: string; text: string; goLeft: boolean }>> = [];

  values.forEach((value, at) => {
    const id = `i${at}`;
    const path: Array<{ id: string; text: string; goLeft: boolean }> = [];
    if (at > 0) {
      let cursor = byId.get(order[0]!)!;
      for (;;) {
        const goLeft = value < cursor.value;
        path.push({ id: cursor.id, text: `${value}${goLeft ? "<" : ">"}${cursor.value}`, goLeft });
        const next = goLeft ? cursor.left : cursor.right;
        if (!next) {
          if (goLeft) cursor.left = id;
          else cursor.right = id;
          break;
        }
        cursor = byId.get(next)!;
      }
    }
    byId.set(id, { id, value, left: null, right: null });
    order.push(id);
    paths.push(path);
  });

  const layoutNodes = order.map((id): TraceNode => ({ id, label: String(byId.get(id)!.value) }));
  const layoutEdges: TraceEdge[] = [];
  for (const id of order) {
    const node = byId.get(id)!;
    if (node.left) layoutEdges.push({ from: id, to: node.left });
    if (node.right) layoutEdges.push({ from: id, to: node.right });
  }

  /** In-order over the nodes placed so far, which is sorted at every step. */
  const inorderSoFar = (placed: ReadonlySet<string>): string[] => {
    const out: string[] = [];
    const walk = (id: string | null): void => {
      if (!id || !placed.has(id)) return;
      const node = byId.get(id)!;
      walk(node.left);
      out.push(String(node.value));
      walk(node.right);
    };
    walk(order[0]!);
    return out;
  };

  const frames: TraceFrame[] = [];
  const placed = new Set<string>();
  values.forEach((value, at) => {
    const id = order[at]!;
    placed.add(id);
    const drawn = order.filter((candidate) => placed.has(candidate));
    const nodes = drawn.map((candidate): TraceNode => {
      const label = String(byId.get(candidate)!.value);
      if (candidate === id) return { id: candidate, label, mark: "active" };
      return paths[at]!.some((stop) => stop.id === candidate)
        ? { id: candidate, label, mark: "window" }
        : { id: candidate, label, mark: "done" };
    });
    const edges: TraceEdge[] = [];
    for (const candidate of drawn) {
      const node = byId.get(candidate)!;
      if (node.left && placed.has(node.left)) edges.push({ from: candidate, to: node.left });
      if (node.right && placed.has(node.right)) edges.push({ from: candidate, to: node.right });
    }
    const sorted = inorderSoFar(placed);
    const last = paths[at]![paths[at]!.length - 1];
    const comparisons = paths[at]!.map((stop) => stop.text).join(", ");
    frames.push({
      id: `insert${at}`,
      caption: at === 0
        ? `${value} arrives first, so it becomes the root`
        : `${comparisons.length <= 42 ? comparisons : `${paths[at]!.length} comparisons`}, so ${value} goes ${last!.goLeft ? "left" : "right"}`,
      narrationIntent: at === 0
        ? `Nothing exists yet, so ${value} simply becomes the root. Every value after this one is placed by comparing it with the values already here, which means the shape of the finished tree depends on the order they arrive in.`
        : `${value} starts at the root and takes ${paths[at]!.length} comparison${paths[at]!.length === 1 ? "" : "s"} to reach an empty spot: ${comparisons}. It is the same walk as searching for ${value}, and the place the search would have failed is exactly where the new node belongs.`,
      state: {
        kind: "tree",
        nodes,
        edges,
        layoutNodes,
        layoutEdges,
        ...(paths[at]!.length > 0
          ? { annotations: paths[at]!.map((stop): TreeAnnotation => ({ nodeId: stop.id, text: stop.text })) }
          : {}),
        asides: [aside("sorted", "in-order", "row", sorted, values.length)],
        note: `insert ${value}`,
      },
    });
  });

  const sorted = inorderSoFar(placed);
  frames.push({
    id: "inorder",
    caption: `in-order gives ${sorted.join(" ")}`,
    narrationIntent:
      `The tree is finished, and reading it in order, left subtree then node then right subtree, gives ${sorted.join(", ")}. That is not a coincidence: the insertion rule put every smaller value on the left of its node, so an in-order read of any search tree is sorted.`,
    state: {
      kind: "tree",
      nodes: layoutNodes.map((node): TraceNode => ({ ...node, mark: "done" })),
      edges: layoutEdges,
      layoutNodes,
      layoutEdges,
      asides: [aside("sorted", "in-order", "row", sorted, values.length, new Map(sorted.map((_, at) => [at, "done" as const])))],
      note: "in-order is sorted",
    },
  });

  if (frames.length < 2 || frames.length > 16) return null;
  const resultText = sorted.join(" ");
  if (resultText.length > 60) return null;
  return {
    algorithmId: "bst_insert",
    title: "Build a binary search tree by insertion",
    input: { values },
    result: sorted,
    resultText,
    frames,
  };
}
