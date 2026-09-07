/**
 * Backtracking drawn as the recursion tree it actually is.
 *
 * All four of these problems are the same picture with different choices on
 * the edges: a node is a partial answer, an edge is one choice, a leaf that
 * satisfies the goal is an answer collected, and a branch the algorithm walks
 * away from is a choice abandoned. Drawing anything else teaches the wrong
 * thing. An array of the current path with a pointer on it shows the state
 * but hides the search, and the search is the whole subject: a student who
 * cannot see the tree cannot see why the same value may be reused in
 * Combination Sum and may not in Permutations.
 *
 * Four choices here are load bearing.
 *
 * **The layout is fixed once and never moves.** `layoutNodes` and
 * `layoutEdges` carry the complete tree in every frame while `nodes` and
 * `edges` carry only the part the walk has reached. Laying each frame out on
 * its own would slide every node sideways as siblings appear, and a tree that
 * rearranges under the student is a tree they cannot follow. Node ids are
 * derived from the path, so an id names the same partial answer in every
 * frame of the trace.
 *
 * **A refused branch is drawn, not omitted.** The obvious rendering builds
 * the tree the algorithm explored and leaves out the moves it declined, which
 * is exactly backwards: the refusal is the lesson. Combination Sum draws the
 * first child that pushes the running total past the target and strikes it
 * through. Where a node has no legal move at all the node itself is struck,
 * because inventing a phantom child would claim the algorithm weighed an
 * option it never built.
 *
 * **Every narration names its own node.** Two frames deep in a search can
 * describe genuinely identical arithmetic ("adding 3 makes 11, too big") at
 * two different places in the tree, and the trace gate rejects a repeated
 * narration. Each line therefore carries the path it belongs to, which is
 * unique by construction and is also what a student needs to hear.
 *
 * **The walk is curated once the tree outgrows the frame budget.** Sixteen
 * frames is the whole lesson and a permutation tree of three values already
 * has sixteen nodes. The first branch is walked node by node so the student
 * sees a full descent and a real pop back out; every branch after it collapses
 * into a single frame, which is what a teacher says out loud anyway: the same
 * thing happens under 2.
 */
import {
  aside,
  type AlgorithmTrace,
  type TraceAside,
  type TraceEdge,
  type TraceFrame,
  type TraceNode,
  type TreeAnnotation,
} from "../types";

/** Frames one trace may spend; the lesson budget, not a rendering limit. */
const MAX_FRAMES = 16;

/**
 * Above this many nodes the walk stops giving every node its own frame.
 * Twelve is the largest tree that still leaves room for an opening frame and
 * a closing one inside the budget.
 */
const FULL_WALK_NODES = 12;

/**
 * Longest node label the board can letter inside a tree circle.
 *
 * One glyph, measured rather than guessed. A tree circle is 0.66 world units
 * across where an array cell is 1.42, and a nine leaf tree beside its output
 * row fits the diagram zone at about 26 pixels per unit, which leaves a chord
 * of roughly 20 pixels inside a node. Two characters of the board font are 26
 * pixels wide and spill. So the node carries the CHOICE that was made to
 * reach it and the path spells the partial answer, which is how the picture is
 * drawn on paper anyway: an edge is a choice, and the node is where it landed.
 */
const MAX_NODE_LABEL = 1;

/** Longest annotation the board can letter beside a node. */
const MAX_ANNOTATION = 8;

/** Longest aside title the board can letter beside a row. */
const MAX_ASIDE_TITLE = 12;

/**
 * Longest answer the board can letter inside an output cell.
 *
 * An aside cell is 1.42 world units wide, which at the scale a nine leaf tree
 * forces is about 38 pixels, and four characters of the board font are 46.
 * A family whose answers do not fit declines rather than drawing a row of
 * values lying across their own cell walls.
 */
const MAX_ANSWER_TEXT = 3;

/**
 * Answers per output row before the row wraps.
 *
 * The board fits the figure by width and the walk leaves most of the height
 * unused, so a long output row is what crushes the scale: nine answers in one
 * row put the tree at twenty pixels per unit and every node label spilled out
 * of its circle. Wrapping is also what a teacher does with a list that runs
 * off the edge of the board.
 */
const MAX_ASIDE_ROW = 5;

/** Longest caption the board can carry under a figure. */
const MAX_CAPTION = 60;

type NodeStatus =
  /** Expanded normally; the walk carried on below it. */
  | "open"
  /** A complete answer, added to the output row. */
  | "collect"
  /** Legal in itself, but no move from here is legal, so the walk turns back. */
  | "deadend"
  /** The move itself is illegal; drawn struck through as the branch refused. */
  | "prune";

interface BtNode {
  id: string;
  label: string;
  parent: string | null;
  status: NodeStatus;
  /** Running state drawn beside the node while it is the current one. */
  annotation: string;
  /** The answer text this node adds to the output row, when it collects one. */
  collects?: string;
  caption: string;
  narration: string;
  /** Caption used when this node's whole subtree is revealed in one frame. */
  branchCaption?: string;
  branchNarration?: string;
}

interface WalkSpec {
  algorithmId: string;
  title: string;
  input: Record<string, unknown>;
  result: unknown;
  resultText: string;
  /** Aside title over the collected answers; at most 12 characters. */
  outTitle: string;
  closingCaption: string;
  closingNarration: string;
  /** Depth-first order, root first, parents always before their children. */
  nodes: BtNode[];
}

interface Step {
  /** Index of the node this frame is about. */
  at: number;
  /** Node indices newly drawn by this frame, in depth-first order. */
  reveal: number[];
  /** The frame speaks for a whole subtree rather than a single node. */
  branch: boolean;
}

/**
 * The label for the root: nothing chosen yet.
 *
 * The whole board is one glyph wide per node, so the empty partial answer
 * cannot be written "{}" the way it would be on paper. Epsilon is what this
 * engine already writes for an empty prefix on the edit-distance and
 * subsequence tables, so a student meeting it twice meets the same idea.
 */
const EMPTY_LABEL = "\u03b5";

/**
 * The depth-1 branches of a depth-first node list, each with its subtree.
 *
 * Used to write the summary line for a branch the walk will not have room to
 * step through. The summary has to be computed from the tree rather than
 * guessed, because a branch that does reach an answer and a branch that
 * reaches nothing need opposite sentences.
 */
function topBranches(nodes: readonly BtNode[]): Array<{ node: BtNode; span: BtNode[] }> {
  const rootId = nodes[0]?.id;
  if (!rootId) return [];
  const starts = nodes.flatMap((node, index) => (node.parent === rootId ? [index] : []));
  return starts.map((start, order) => ({
    node: nodes[start]!,
    span: nodes.slice(start, order + 1 < starts.length ? starts[order + 1]! : nodes.length),
  }));
}

/** The answers collected inside one subtree, in the order they were found. */
function collectedIn(span: readonly BtNode[]): string[] {
  return span.flatMap((node) => (node.status === "collect" && node.collects ? [node.collects] : []));
}

/** The first line that fits the caption box; the last one is the safety net. */
function fitCaption(...options: string[]): string {
  return options.find((option) => option.length > 0 && option.length <= MAX_CAPTION) ?? "";
}

/**
 * Turn an authored recursion tree into frames.
 *
 * Shared by all four families because the drawing rules are identical and
 * only the choices differ. Every failure returns null rather than throwing:
 * the catalog then falls back to the family's canonical example, which is
 * always a tree this builder has already accepted.
 */
function buildBacktrackingTrace(spec: WalkSpec): AlgorithmTrace | null {
  const nodes = spec.nodes;
  if (nodes.length < 3 || nodes.length > 24) return null;
  if (spec.outTitle.length < 1 || spec.outTitle.length > MAX_ASIDE_TITLE) return null;
  if (spec.resultText.length < 1 || spec.resultText.length > MAX_CAPTION) return null;
  if (spec.closingCaption.length < 1 || spec.closingCaption.length > MAX_CAPTION) return null;
  if (spec.closingNarration.length <= 20) return null;

  const indexOf = new Map<string, number>();
  const depthOf: number[] = [];
  for (const [index, node] of nodes.entries()) {
    if (indexOf.has(node.id)) return null;
    if (node.label.length < 1 || node.label.length > MAX_NODE_LABEL) return null;
    if (node.annotation.length < 1 || node.annotation.length > MAX_ANNOTATION) return null;
    if (node.caption.length < 1 || node.caption.length > MAX_CAPTION) return null;
    if (node.narration.length <= 20) return null;
    if (index === 0) {
      if (node.parent !== null) return null;
      depthOf.push(0);
    } else {
      if (node.parent === null) return null;
      const parent = indexOf.get(node.parent);
      // A parent pushed after its child would leave a floating node, and
      // `layoutTree` refuses a frame it cannot root.
      if (parent === undefined) return null;
      depthOf.push(depthOf[parent]! + 1);
    }
    indexOf.set(node.id, index);
  }

  const layoutNodes: TraceNode[] = nodes.map((node) => ({ id: node.id, label: node.label }));
  const layoutEdges: TraceEdge[] = nodes
    .filter((node) => node.parent !== null)
    .map((node) => ({ from: node.parent!, to: node.id }));

  /**
   * A node and everything under it. The node list is depth first, so a
   * subtree is exactly the run of deeper nodes that follows its root.
   */
  const subtreeSpan = (index: number): number[] => {
    const base = depthOf[index]!;
    const span = [index];
    for (let cursor = index + 1; cursor < nodes.length && depthOf[cursor]! > base; cursor += 1) {
      span.push(cursor);
    }
    return span;
  };

  const topLevel = nodes.flatMap((node, index) => (depthOf[index] === 1 ? [index] : []));
  if (topLevel.length === 0) return null;

  const everyNode = (): Step[] => nodes.map((_, index) => ({ at: index, reveal: [index], branch: false }));

  /** First branch node by node, then one frame per branch after it. */
  const firstBranchThenSummaries = (): Step[] => {
    const steps: Step[] = [{ at: 0, reveal: [0], branch: false }];
    for (const [order, index] of topLevel.entries()) {
      const span = subtreeSpan(index);
      // A one-node branch has nothing to summarise, and its own caption is
      // more concrete than any summary of it would be.
      if (order === 0 || span.length === 1) {
        for (const at of span) steps.push({ at, reveal: [at], branch: false });
      } else {
        steps.push({ at: index, reveal: span, branch: true });
      }
    }
    return steps;
  };

  /** One frame per branch, for a tree too wide even for the first walk. */
  const summariesOnly = (): Step[] => [
    { at: 0, reveal: [0], branch: false },
    ...topLevel.map((index) => {
      const span = subtreeSpan(index);
      return { at: index, reveal: span, branch: span.length > 1 };
    }),
  ];

  const plans = nodes.length <= FULL_WALK_NODES
    ? [everyNode(), firstBranchThenSummaries(), summariesOnly()]
    : [firstBranchThenSummaries(), summariesOnly()];
  const steps = plans.find((plan) => plan.length >= 1 && plan.length + 1 <= MAX_FRAMES);
  if (!steps) return null;

  // A branch frame speaks for a whole subtree, so it needs its own words.
  for (const step of steps) {
    if (!step.branch) continue;
    const node = nodes[step.at]!;
    if (!node.branchCaption || !node.branchNarration) return null;
    if (node.branchCaption.length < 1 || node.branchCaption.length > MAX_CAPTION) return null;
    if (node.branchNarration.length <= 20) return null;
  }

  const capacity = nodes.filter((node) => node.status === "collect").length;
  if (capacity < 1) return null;
  for (const node of nodes) {
    if (node.collects && node.collects.length > MAX_ANSWER_TEXT) return null;
  }

  /** The collected answers so far, as one or more fixed width output rows. */
  const outputRows = (found: readonly string[], newest: boolean): TraceAside[] => {
    const rows: TraceAside[] = [];
    for (let start = 0; start < capacity; start += MAX_ASIDE_ROW) {
      const width = Math.min(MAX_ASIDE_ROW, capacity - start);
      const at = found.length - 1 - start;
      rows.push(
        aside(
          `out${rows.length}`,
          rows.length === 0 ? spec.outTitle : "more",
          "row",
          found.slice(start, start + width),
          width,
          new Map(newest && at >= 0 && at < width ? [[at, "active" as const]] : []),
        ),
      );
    }
    return rows;
  };

  const revealed = new Set<string>();
  const excluded = new Set<string>();
  const collected: string[] = [];
  const frames: TraceFrame[] = [];

  const ancestorsOf = (index: number): Set<string> => {
    const path = new Set<string>();
    let cursor = nodes[index]!.parent;
    while (cursor) {
      path.add(cursor);
      cursor = nodes[indexOf.get(cursor)!]!.parent;
    }
    return path;
  };

  for (const step of steps) {
    for (const at of step.reveal) {
      const node = nodes[at]!;
      revealed.add(node.id);
      if (node.status === "collect" && node.collects) collected.push(node.collects);
      if (node.status === "deadend" || node.status === "prune") excluded.add(node.id);
    }

    const node = nodes[step.at]!;
    // A pruned move is a move the CURRENT node refused, so the spotlight stays
    // on the node doing the refusing and the refused child is struck through.
    // Putting `active` on the pruned child would read as the walk having gone
    // there, which is the one thing it did not do.
    const currentId = node.status === "prune" && node.parent ? node.parent : node.id;
    const path = ancestorsOf(indexOf.get(currentId)!);

    frames.push({
      id: `n_${node.id}`,
      caption: (step.branch ? node.branchCaption : node.caption)!,
      narrationIntent: (step.branch ? node.branchNarration : node.narration)!,
      state: {
        kind: "tree",
        nodes: nodes
          .filter((candidate) => revealed.has(candidate.id))
          .map((candidate) => ({
            id: candidate.id,
            label: candidate.label,
            ...(candidate.id === currentId
              ? { mark: "active" as const }
              : path.has(candidate.id)
                ? { mark: "window" as const }
                : excluded.has(candidate.id)
                  ? { mark: "excluded" as const }
                  // Depth first means everything drawn that is not on the
                  // current path is behind the walk and will not be revisited.
                  // Leaving those nodes unmarked made a finished branch look
                  // identical to one the walk had not started.
                  : { mark: "done" as const }),
          })),
        edges: layoutEdges.filter((edge) => revealed.has(edge.from) && revealed.has(edge.to)),
        layoutNodes,
        layoutEdges,
        annotations: [{ nodeId: node.id, text: node.annotation }] satisfies TreeAnnotation[],
        asides: outputRows(collected, collected.length > 0),
      },
    });
  }

  // The search is over, so nothing is still being expanded: every surviving
  // node is settled and every refused one keeps its strike. That is the
  // picture the student should be left holding.
  frames.push({
    id: "collected",
    caption: spec.closingCaption,
    narrationIntent: spec.closingNarration,
    state: {
      kind: "tree",
      nodes: nodes.map((node) => ({
        id: node.id,
        label: node.label,
        mark: excluded.has(node.id) ? ("excluded" as const) : ("done" as const),
      })),
      edges: layoutEdges,
      layoutNodes,
      layoutEdges,
      asides: outputRows(collected, false),
    },
  });

  if (frames.length < 2 || frames.length > MAX_FRAMES) return null;
  return {
    algorithmId: spec.algorithmId,
    title: spec.title,
    input: spec.input,
    result: spec.result,
    resultText: spec.resultText,
    frames,
  };
}

/**
 * Single digits only. A path label is its digits run together, so two values
 * that need more than one character each would make 1 beside 2 unreadable
 * from 12, and a board that cannot be read back is worse than no board.
 */
function singleDigits(values: readonly number[]): string[] | null {
  if (!Array.isArray(values)) return null;
  const digits: string[] = [];
  for (const value of values) {
    if (!Number.isInteger(value) || value < 0 || value > 9) return null;
    digits.push(String(value));
  }
  return digits;
}

// --- Subsets (LeetCode 78) -------------------------------------------------

export interface SubsetsInput {
  values: number[];
}

/**
 * Every node of this tree is an answer, which is exactly what separates
 * Subsets from the other three: there is no goal test and no leaf condition,
 * the output row fills on arrival. The start index is the only rule, and it
 * is drawn as the annotation beside the current node, because a student who
 * cannot see which values are still addable cannot see why {2,1} never turns
 * up beside {1,2}.
 */
export function simulateSubsets(input: SubsetsInput): AlgorithmTrace | null {
  const values = input?.values;
  // Four values make sixteen subsets, and the longest of them needs four
  // glyphs in an output cell that can letter three. The honest answer for a
  // bigger input is the canonical example, not a board that cannot be read.
  if (!Array.isArray(values) || values.length < 2 || values.length > 3) return null;
  if (new Set(values).size !== values.length) return null;
  const digits = singleDigits(values);
  if (!digits) return null;

  const nodes: BtNode[] = [];
  const answers: number[][] = [];
  // The start index is the only rule this algorithm has, so it is what the
  // note beside the current node carries: the values still addable from here.
  const stillAddable = (start: number): string =>
    start < values.length ? digits.slice(start).join("") : "end";

  nodes.push({
    id: "s",
    label: EMPTY_LABEL,
    parent: null,
    status: "collect",
    annotation: stillAddable(0),
    collects: "{}",
    caption: "The empty subset is collected first",
    narration:
      "Nothing has been chosen yet, which is what the epsilon at the root means. The empty set is itself a subset, so it is written down before a single choice is made, and the note beside the root lists the values that may still be added.",
  });
  answers.push([]);

  const walk = (parentId: string, chosen: number[], start: number): void => {
    for (let index = start; index < values.length; index += 1) {
      const value = values[index]!;
      const picked = [...chosen, value];
      // The node carries the choice; the path from the root spells the subset.
      const label = String(value);
      const key = picked.join("");
      const spoken = picked.join(" and ");
      const parentSpoken = chosen.length === 0 ? "the empty set" : chosen.join(" and ");
      // The walk arrived straight from its parent only when the parent was the
      // last node pushed; otherwise it climbed back out of a sibling subtree
      // first, and that pop is the backtracking step worth naming out loud.
      const camePopping = nodes[nodes.length - 1]!.id !== parentId;
      const previousSubset = nodes[nodes.length - 1]!.collects ?? "";
      nodes.push({
        id: `s${key}`,
        label,
        parent: parentId,
        status: "collect",
        annotation: stillAddable(index + 1),
        collects: key,
        caption: camePopping
          ? `Pop back, take ${value}: subset ${picked.join(" ")}`
          : `Take ${value}: subset ${picked.join(" ")}`,
        narration: camePopping
          ? `The branch under ${previousSubset} has nothing left, so the walk pops back to ${parentSpoken} and takes ${value} instead. That makes the subset ${spoken}, which is written down the moment it is reached.`
          : `Adding ${value} to ${parentSpoken} makes the subset ${spoken}. Every node of this tree is itself a subset, so ${spoken} goes into the output row on arrival rather than at a leaf.`,
      });
      answers.push(picked);
      walk(`s${key}`, picked, index + 1);
    }
  };
  walk("s", [], 0);

  for (const { node, span } of topBranches(nodes)) {
    if (span.length < 2) continue;
    const found = collectedIn(span);
    node.branchCaption = fitCaption(
      `Branch ${node.label}: ${found.length} subsets start with ${node.label}`,
      `Branch ${node.label}: ${found.length} more subsets`,
    );
    node.branchNarration = `Everything below this node is a subset that begins with ${node.label}, and there are ${found.length} of them: ${found.join(", ")}. Because a value may only be added from further right, ${node.label} can never appear again lower down, and that single rule is what stops the same subset being built twice in a different order.`;
  }

  return buildBacktrackingTrace({
    algorithmId: "backtracking_subsets",
    title: "Subsets by backtracking",
    input: { values },
    result: answers,
    resultText: `${answers.length} subsets, the power set`,
    outTitle: "out",
    closingCaption: `${answers.length} subsets: the power set of ${digits.join(" ")}`,
    closingNarration: `Every node of the tree was an answer, so the ${answers.length} nodes are the ${answers.length} subsets. That is two multiplied by itself ${values.length} times, one choice of in or out per value, and the walk produced each one exactly once.`,
    nodes,
  });
}

// --- Permutations (LeetCode 46) --------------------------------------------

export interface PermutationsInput {
  values: number[];
}

/**
 * Only the leaves are answers here, and that is the whole contrast with
 * Subsets. The annotation carries the pool of values still unused, which is
 * why the tree narrows by one at every level rather than staying as wide as
 * the input: three choices, then two, then one.
 */
export function simulatePermutations(input: PermutationsInput): AlgorithmTrace | null {
  const values = input?.values;
  // Four distinct values give sixty-five nodes, a tree far past what a board
  // can letter, so the honest answer for a bigger input is no picture.
  if (!Array.isArray(values) || values.length < 2 || values.length > 3) return null;
  if (new Set(values).size !== values.length) return null;
  const digits = singleDigits(values);
  if (!digits) return null;

  const nodes: BtNode[] = [];
  const answers: number[][] = [];
  // The pool of values still unused: the one piece of state that makes this
  // tree narrow by one at every level instead of staying as wide as the input.
  const poolText = (used: readonly number[]): string => {
    const left = values.filter((value) => !used.includes(value));
    return left.length === 0 ? "end" : left.join("");
  };

  nodes.push({
    id: "p",
    label: EMPTY_LABEL,
    parent: null,
    status: "open",
    annotation: poolText([]),
    caption: `Nothing chosen yet, ${values.length} ways to start`,
    narration: `No value has been placed yet, which is what the epsilon at the root means, so any of ${digits.join(", ")} may go first. That is why ${values.length} edges leave the root, and the note beside it is the pool of values still unused.`,
  });

  const walk = (parentId: string, chosen: number[]): void => {
    for (const value of values) {
      if (chosen.includes(value)) continue;
      const picked = [...chosen, value];
      // The node carries the choice; the path from the root spells the
      // arrangement so far.
      const label = String(value);
      const key = picked.join("");
      const complete = picked.length === values.length;
      const left = values.filter((item) => !picked.includes(item));
      const camePopping = nodes[nodes.length - 1]!.id !== parentId;
      const previousPath = nodes[nodes.length - 1]!.id.slice(1);
      nodes.push({
        id: `p${key}`,
        label,
        parent: parentId,
        status: complete ? "collect" : "open",
        annotation: poolText(picked),
        ...(complete ? { collects: key } : {}),
        caption: complete
          ? `${picked.join(" ")} is complete, write it down`
          : camePopping
            ? `Pop back, choose ${value} instead: ${picked.join(" ")}`
            : `Choose ${value}, ${left.join(" and ")} left`,
        narration: complete
          ? `The path ${picked.join(", then ")} uses every value exactly once, so this leaf is a finished permutation and goes into the output row. There is nothing left to place, so the walk turns around here.`
          : camePopping
            ? `The subtree under ${previousPath} is used up, so the walk takes that choice back out and puts ${value} in the slot instead. The path is now ${picked.join(" and ")}, with ${left.join(" and ")} still in the pool.`
            : `Choosing ${value} takes it out of the pool, so below the path ${picked.join(" and ")} only ${left.join(" and ")} can still be placed. The tree gets narrower at every level for exactly that reason.`,
      });
      if (complete) answers.push(picked);
      else walk(`p${key}`, picked);
    }
  };
  walk("p", []);

  for (const { node, span } of topBranches(nodes)) {
    if (span.length < 2) continue;
    const found = collectedIn(span);
    node.branchCaption = fitCaption(
      `Starting with ${node.label} gives ${found.join(" and ")}`,
      `Branch ${node.label} gives ${found.length} more permutations`,
    );
    node.branchNarration = `The branch under ${node.label} repeats the reasoning we just watched, with ${node.label} crossed off the pool. It produces ${found.join(" and ")}, and no new idea is needed to reach them.`;
  }

  return buildBacktrackingTrace({
    algorithmId: "backtracking_permutations",
    title: "Permutations by backtracking",
    input: { values },
    result: answers,
    resultText: `${answers.length} permutations of ${digits.join(" ")}`,
    outTitle: "out",
    closingCaption: `${answers.length} permutations of ${digits.join(" ")} collected`,
    closingNarration: `Only the leaves were answers, and there are ${answers.length} of them because the pool shrank by one at every level. The internal nodes were never written down: a partial arrangement is not a permutation, however far down the tree it sits.`,
    nodes,
  });
}

// --- Combination Sum (LeetCode 39) -----------------------------------------

export interface CombinationSumInput {
  candidates: number[];
  target: number;
}

/**
 * The only one of the four with a real prune, and the prune is the point.
 *
 * Candidates are read smallest first so that one overshoot ends the row: if
 * the smallest remaining candidate already passes the target, every larger
 * one does too. That first overshooting child is drawn and struck through,
 * because a branch the algorithm refused is invisible if you only draw what
 * it explored, and "why did it stop there" is the question the picture has to
 * answer. A node whose very first move overshoots is struck itself: giving it
 * a phantom child would claim the algorithm weighed something it never built.
 *
 * The recursive call restarts at the same index rather than the next one,
 * which is how a candidate gets reused, and it is why 2 appears three times
 * down the left spine of the canonical example.
 */
export function simulateCombinationSum(input: CombinationSumInput): AlgorithmTrace | null {
  const raw = input?.candidates;
  const target = input?.target;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 4) return null;
  if (!Number.isInteger(target) || target < 2 || target > 20) return null;
  if (new Set(raw).size !== raw.length) return null;
  if (raw.some((value) => !Number.isInteger(value) || value < 1)) return null;
  const candidates = [...raw].sort((a, b) => a - b);
  const digits = singleDigits(candidates);
  if (!digits) return null;

  const nodes: BtNode[] = [];

  nodes.push({
    id: "c",
    label: EMPTY_LABEL,
    parent: null,
    status: "open",
    // Every note beside a node in this walk is the running total along its
    // path, prune nodes included, so the strike through and the number that
    // caused it are read together.
    annotation: "0",
    caption: `Start at 0, the target is ${target}`,
    narration: `Nothing is chosen yet, which is what the epsilon at the root means, so the running total beside it is zero and the target is ${target}. The candidates ${digits.join(", ")} are read smallest first, which matters in a moment: once one of them overshoots, every larger one must overshoot too.`,
  });

  const walk = (parentId: string, chosen: number[], sum: number, start: number): void => {
    let children = 0;
    for (let index = start; index < candidates.length; index += 1) {
      const value = candidates[index]!;
      const next = sum + value;
      const picked = [...chosen, value];
      // The node carries the candidate that was added; the path spells the
      // combination and the note carries the running total.
      const label = String(value);
      const key = picked.join("");

      if (next > target) {
        if (children === 0) {
          // No legal move at all, so the node itself is the dead end. The
          // caption and note it was pushed with described a live node.
          const dead = nodes.find((node) => node.id === parentId)!;
          const deadPath = chosen.length > 0 ? chosen.join("+") : "the empty path";
          dead.status = "deadend";
          dead.caption = fitCaption(`${deadPath} is ${sum}, no candidate fits`, `Total ${sum}, no candidate fits`);
          dead.narration = `The total along ${deadPath} is ${sum}, and the smallest candidate still allowed is ${value}, which would take it to ${next}. That is already past ${target}, so there is no move at all from here and the walk turns straight around.`;
        } else {
          nodes.push({
            id: `c${key}`,
            label,
            parent: parentId,
            status: "prune",
            annotation: String(next),
            caption: fitCaption(`${sum}+${value} is ${next}, past ${target}, so stop`),
            narration: `The path ${picked.join("+")} would total ${next}, which is past ${target}. Because the candidates are in increasing order, every candidate after ${value} is worse still, so the whole rest of this row is abandoned in one step instead of being tried one by one.`,
          });
        }
        break;
      }

      children += 1;
      const hit = next === target;
      const camePopping = nodes[nodes.length - 1]!.id !== parentId;
      nodes.push({
        id: `c${key}`,
        label,
        parent: parentId,
        status: hit ? "collect" : "open",
        annotation: String(next),
        ...(hit ? { collects: key } : {}),
        caption: hit
          ? fitCaption(`${picked.join("+")} hits the target ${target}`, `A combination reaches ${target}`)
          : camePopping
            ? `Pop back, add ${value}: total ${next}`
            : `Add ${value}: total ${next}`,
        narration: hit
          ? `The path ${picked.join(" plus ")} makes exactly ${target}, so it is a combination and goes into the output row. The walk stops here rather than adding more, because every candidate is positive and could only overshoot.`
          : camePopping
            ? `That branch is finished, so the walk pops back and adds ${value} instead. The path ${picked.join("+")} now totals ${next}, still short of ${target}.`
            : `Adding ${value} takes the path ${picked.join("+")} to ${next}, still under ${target}. The next choice may start at ${value} again rather than moving past it, which is how a candidate gets reused.`,
      });
      if (!hit) walk(`c${key}`, picked, next, index);
    }
  };
  walk("c", [], 0, 0);

  const answers = nodes.flatMap((node) =>
    node.status === "collect" && node.collects ? [[...node.collects].map((digit) => Number(digit))] : [],
  );
  if (answers.length === 0) return null;

  for (const { node, span } of topBranches(nodes)) {
    if (span.length < 2) continue;
    const found = collectedIn(span);
    node.branchCaption = found.length
      ? fitCaption(
          `Branch ${node.label} gives ${found.join(" and ")}`,
          `Branch ${node.label} gives ${found.length} combinations`,
        )
      : fitCaption(`Branch ${node.label}: nothing here reaches ${target}`, `Branch ${node.label} reaches nothing`);
    node.branchNarration = found.length
      ? `Under ${node.label} the same walk runs again against a smaller gap, and it closes that gap ${found.length === 1 ? "once" : `${found.length} times`}, giving ${found.join(" and ")}. The rest of the branch overshoots and is struck out.`
      : `Under ${node.label} the same walk runs again against a smaller gap, and every path it can build either lands past ${target} or runs out of candidates. Nothing from this branch reaches the output row.`;
  }

  const listed = answers.map((answer) => answer.join("+")).join(" and ");
  const longCaption = `${answers.length} combinations found: ${listed}`;
  const longResult = `${answers.length} combinations: ${listed}`;
  const short = `${answers.length} combinations sum to ${target}`;
  const useLong = longCaption.length <= MAX_CAPTION && longResult.length <= MAX_CAPTION;

  return buildBacktrackingTrace({
    algorithmId: "backtracking_combination_sum",
    title: "Combination sum by backtracking",
    input: { candidates, target },
    result: answers,
    resultText: useLong ? longResult : short,
    outTitle: "out",
    closingCaption: useLong ? longCaption : short,
    closingNarration: `The struck out nodes are the moves the search refused, and there are more of them than there are answers. That is what backtracking buys: the tree of every possible path is enormous, and the running total kills most of it before it is ever built.`,
    nodes,
  });
}

// --- Letter Combinations of a Phone Number (LeetCode 17) --------------------

export interface PhoneLettersInput {
  digits: string;
}

const PHONE_LETTERS: Record<string, string> = {
  "2": "abc",
  "3": "def",
  "4": "ghi",
  "5": "jkl",
  "6": "mno",
  "7": "pqrs",
  "8": "tuv",
  "9": "wxyz",
};

/**
 * The tree with no pruning at all, which is exactly why it belongs beside the
 * other three: every leaf is an answer, the depth is fixed by the number of
 * digits, and the leaf count is the product of the row widths. A student who
 * has seen this one can see that backtracking with no constraint is nested
 * loops written recursively, and that the constraint is what makes the other
 * three interesting.
 */
export function simulatePhoneLetters(input: PhoneLettersInput): AlgorithmTrace | null {
  const digits = input?.digits;
  if (typeof digits !== "string" || !/^[2-9]{1,2}$/.test(digits)) return null;
  const rows = [...digits].map((digit) => PHONE_LETTERS[digit]!);
  const leaves = rows.reduce((product, row) => product * row.length, 1);
  // Four letters twice over is sixteen leaves, a tree wider than the board can
  // letter, and a bigger example teaches nothing the small one does not.
  if (leaves > 9) return null;

  const nodes: BtNode[] = [];
  const answers: string[] = [];
  // The note beside a node is the key whose letters hang below it, so the
  // fan out of the next level is readable before it is drawn.
  const keypad = (depth: number): string => (depth < digits.length ? rows[depth]! : "end");

  nodes.push({
    id: "w",
    label: EMPTY_LABEL,
    parent: null,
    status: "open",
    annotation: keypad(0),
    caption:
      digits.length === 1
        ? "One digit, so every word is one letter"
        : `${digits.length} digits, so every word is ${digits.length} letters`,
    narration: `The word is empty so far, which is what the epsilon at the root means. Digit ${digits[0]} carries the letters ${[...rows[0]!].join(", ")}, so the root has ${rows[0]!.length} edges leaving it, one for each letter printed on that key.`,
  });

  const walk = (parentId: string, prefix: string, depth: number): void => {
    if (depth >= digits.length) return;
    const row = rows[depth]!;
    for (const letter of row) {
      const word = prefix + letter;
      const complete = word.length === digits.length;
      const camePopping = nodes[nodes.length - 1]!.id !== parentId;
      const previousWord = nodes[nodes.length - 1]!.id.slice(1);
      nodes.push({
        id: `w${word}`,
        // The node carries the letter chosen; the path spells the word.
        label: letter,
        parent: parentId,
        status: complete ? "collect" : "open",
        annotation: keypad(depth + 1),
        ...(complete ? { collects: word } : {}),
        caption: complete
          ? `${word} is one full combination`
          : camePopping
            ? `Pop back and take ${letter} instead: ${word}`
            : `Digit ${digits[depth]} offers ${row}, take ${letter}`,
        narration: complete
          ? `The word ${word} now has one letter for every digit, so it is finished and joins the output row. Nothing is ever rejected here: with no constraint to break, every leaf of this tree is an answer.`
          : camePopping
            ? `The letters under ${previousWord} are used up, so the walk pops back and takes ${letter} from digit ${digits[depth]} instead, which starts the word ${word}.`
            : `Taking ${letter} from digit ${digits[depth]} starts the word ${word}. The next digit hangs its own letters below, so the depth of this tree is fixed by how many digits there are and nothing else.`,
      });
      if (complete) answers.push(word);
      else walk(`w${word}`, word, depth + 1);
    }
  };
  walk("w", "", 0);

  for (const { node, span } of topBranches(nodes)) {
    if (span.length < 2) continue;
    const found = collectedIn(span);
    node.branchCaption = fitCaption(
      `Branch ${node.label} gives ${found.join(" ")}`,
      `Branch ${node.label} gives ${found.length} words`,
    );
    node.branchNarration = `The branch under ${node.label} has the same shape as the one just walked: ${node.label} is fixed and the letters of the next key fan out below it, giving ${found.join(", ")}. Nothing is pruned, so every path here reaches a leaf.`;
  }

  const shape = rows.map((row) => row.length).join(" times ");
  return buildBacktrackingTrace({
    algorithmId: "backtracking_phone_letters",
    title: "Letter combinations of a phone number",
    input: { digits },
    result: answers,
    resultText:
      digits.length === 1
        ? `${answers.length} combinations, one per letter`
        : `${answers.length} combinations, ${shape}`,
    outTitle: "out",
    closingCaption:
      digits.length === 1
        ? `${answers.length} combinations, one per letter`
        : `${answers.length} combinations: ${shape} choices`,
    closingNarration: `Every leaf is an answer and not one was thrown away, so the count is simply the letters on one key multiplied by the letters on the next. With no constraint to violate there is nothing to prune, which is what makes this the plainest search tree of the four.`,
    nodes,
  });
}
