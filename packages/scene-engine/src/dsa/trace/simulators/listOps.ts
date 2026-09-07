/**
 * Linked list surgery: merging two lists, gap pointers, digit carry, and
 * reversing k nodes at a time.
 *
 * These four are all "the arrows move" problems, so the arrows are the
 * lesson. Every frame records the real link map after the step, which means a
 * rewired `next` shows up as a redrawn arrow rather than as a sentence the
 * tutor says over a picture that never changed. `reverse_linked_list` already
 * proved the shape works; these carry it into the cases where two lists, a
 * dropped node, or a block boundary are what actually moves.
 *
 * Three drawing facts about `buildListFrame` shaped every choice below, and
 * they are worth stating because a naive rendering teaches the wrong thing:
 *
 *   - a link to the next position in the row draws as a plain arrow, a link
 *     that runs backwards hooks under the row in its own band, but every
 *     forward skip arcs over the row at ONE shared height. Two forward skips
 *     that span overlapping columns therefore land on the same line and read
 *     as a single arrow. Node order is chosen to keep those apart.
 *   - a node's position is its index in `nodes`, so the node set and its order
 *     are fixed for the whole trace. Nodes are never added or removed mid
 *     walk; a node that leaves the list is marked `excluded` and the link out
 *     of it is marked `excluded` too, which draws it dashed.
 *   - an aside row keeps one capacity for the whole trace. Where a list is
 *     being produced, the aside spells the output order out in digits so the
 *     student can read the answer even while the arrows zigzag.
 */
import {
  aside,
  type AlgorithmTrace,
  type TraceAside,
  type TraceEdge,
  type TraceFrame,
  type TraceMark,
  type TraceNode,
  type TracePointer,
} from "../types";

/** The lesson budget the trace gate enforces. */
const MAX_FRAMES = 16;

/** A note is drawn as chips of at most sixteen characters each. */
function chips(...pieces: ReadonlyArray<string>): string {
  return pieces.filter((piece) => piece.trim().length > 0).join("  ");
}

/** A value that fits in a node box, so the board never draws a spilling label. */
function drawable(values: ReadonlyArray<number>): boolean {
  return values.every((value) => Number.isFinite(value) && String(value).length <= 4);
}

function nonDecreasing(values: ReadonlyArray<number>): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! <= value);
}

/** "the 2nd node from the end" reads as English; "the 2 node" does not. */
function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  return `${value}${["th", "st", "nd", "rd"][value % 10] ?? "th"}`;
}

/**
 * One drawn row: ids in board order, the value under each id, and the live
 * `next` map. Everything below works through this so the four walks agree on
 * what a frame is.
 */
interface ListBoard {
  ids: string[];
  valueOf: Map<string, number>;
  next: Map<string, string | null>;
  indexOf: Map<string, number>;
}

function board(chains: ReadonlyArray<{ prefix: string; values: ReadonlyArray<number> }>): ListBoard {
  const ids: string[] = [];
  const valueOf = new Map<string, number>();
  const next = new Map<string, string | null>();
  for (const chain of chains) {
    chain.values.forEach((value, index) => {
      const id = `${chain.prefix}${index}`;
      ids.push(id);
      valueOf.set(id, value);
      next.set(id, index + 1 < chain.values.length ? `${chain.prefix}${index + 1}` : null);
    });
  }
  const indexOf = new Map(ids.map((id, index) => [id, index] as const));
  return { ids, valueOf, next, indexOf };
}

function nodesOf(state: ListBoard, marks: ReadonlyMap<string, TraceMark>): TraceNode[] {
  return state.ids.map((id) => {
    const mark = marks.get(id);
    return { id, label: String(state.valueOf.get(id)), ...(mark ? { mark } : {}) };
  });
}

/**
 * The arrow set as it stands right now, in row order so a backward link keeps
 * the same hook band from frame to frame.
 */
function linksOf(state: ListBoard, marks: ReadonlyMap<string, TraceMark> = new Map()): TraceEdge[] {
  const edges: TraceEdge[] = [];
  for (const from of state.ids) {
    const to = state.next.get(from);
    if (!to) continue;
    const mark = marks.get(from);
    edges.push({ from, to, ...(mark ? { mark } : {}) });
  }
  return edges;
}

function pointersOf(state: ListBoard, named: ReadonlyArray<[string, string | null]>): TracePointer[] {
  const out: TracePointer[] = [];
  for (const [name, id] of named) {
    if (!id) continue;
    const index = state.indexOf.get(id);
    if (index === undefined) continue;
    out.push({ name, index });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Merge two sorted lists (LeetCode 21)
 * ------------------------------------------------------------------ */

export interface MergeListsInput {
  list1: number[];
  list2: number[];
}

/**
 * Merge two sorted lists by splicing, which is what the statement asks for:
 * no node is created, the existing nodes are re-linked. The board draws list1
 * then list2 in one row and rewires as the merge runs, so the finished list
 * weaves through both blocks. That weave IS the answer to "where did the
 * merged list come from", and drawing the output as a fresh row of copied
 * values would teach the opposite.
 *
 * Ties go to list2. The statement does not fix the order of equal values, and
 * the choice is not cosmetic: taking list1 on a tie makes the merge alternate
 * between the blocks on the canonical example, which means every one of the
 * five links changes and three of them become forward skips at the same
 * drawn height, on top of each other. Breaking the tie the other way leaves
 * runs inside each block, so two links never move at all and the finished
 * board has one forward skip, two hooks, and two plain arrows. Same values in
 * the same order, a board a student can actually read.
 */
export function simulateMergeTwoLists(input: MergeListsInput): AlgorithmTrace | null {
  const first = input.list1;
  const second = input.list2;
  if (first.length < 1 || second.length < 1) return null;
  if (first.length > 4 || second.length > 4) return null;
  if (first.length + second.length > 8) return null;
  if (!drawable(first) || !drawable(second)) return null;
  // An unsorted input makes the one pass merge wrong, and a wrong merge drawn
  // confidently is worse than the family declining.
  if (!nonDecreasing(first) || !nonDecreasing(second)) return null;

  const state = board([
    { prefix: "a", values: first },
    { prefix: "b", values: second },
  ]);
  const total = first.length + second.length;
  const value = (id: string) => state.valueOf.get(id)!;
  const frames: TraceFrame[] = [];
  const placed: string[] = [];

  const out = (): TraceAside =>
    aside(
      "out",
      "merged",
      "row",
      placed.map((id) => value(id)),
      total,
      new Map(placed.length > 0 ? [[placed.length - 1, "active" as const]] : []),
    );

  const marksNow = (fronts: ReadonlyArray<string | null>): Map<string, TraceMark> => {
    const marks = new Map<string, TraceMark>();
    for (const id of placed) marks.set(id, "done");
    for (const front of fronts) if (front) marks.set(front, "active");
    return marks;
  };

  const push = (
    id: string,
    caption: string,
    say: string,
    cursors: ReadonlyArray<[string, string | null]>,
    fronts: ReadonlyArray<string | null>,
    note: string,
  ) => {
    frames.push({
      id,
      caption,
      narrationIntent: say,
      state: {
        kind: "list",
        nodes: nodesOf(state, marksNow(fronts)),
        links: linksOf(state),
        pointers: pointersOf(state, cursors),
        note,
        asides: [out()],
      },
    });
  };

  let p1: string | null = state.ids[0]!;
  let p2: string | null = state.ids[first.length]!;
  let tail: string | null = null;

  push(
    "input",
    "Two sorted lists, one cursor on each",
    `Both lists are already in order, so the smallest value left in either one is always sitting under p1 or under p2. The merged list is built by taking whichever of those two is smaller, over and over. Nothing is copied: the nodes on the board are the nodes the answer is made of.`,
    [["p1", p1], ["p2", p2]],
    [p1, p2],
    chips("both are sorted", "tail is empty"),
  );

  // No frame budget inside the loop: a walk that stopped early here would
  // report a merged list it never finished building. The input guards above
  // cap the row at eight nodes, which is at most ten frames.
  let step = 0;
  while (p1 && p2) {
    const front1: string = p1;
    const front2: string = p2;
    const before = value(front1);
    const after = value(front2);
    const tie = before === after;
    // Strictly smaller, so equal fronts take the list2 node. See the note
    // above the function: this is the choice that keeps the arrows readable.
    const takeFirst = before < after;
    const taken: string = takeFirst ? front1 : front2;
    // The splice. When the tail already points at the taken node this writes
    // the arrow it already had, and the board is honest about that: nothing
    // moves, which is exactly why runs inside one list are cheap.
    const alreadyLinked = tail !== null && state.next.get(tail) === taken;
    if (tail) state.next.set(tail, taken);
    placed.push(taken);
    tail = taken;
    if (takeFirst) p1 = state.next.get(taken) ?? null;
    else p2 = state.next.get(taken) ?? null;
    step += 1;

    const source = takeFirst ? 1 : 2;
    push(
      `take${step}`,
      tie
        ? `${before} and ${after} tie, so list2 goes on`
        : `${before} vs ${after}, so list${source} goes on`,
      tie
        ? `Step ${step}. Both cursors are on a ${before}, so the two are equal and either could go first. This walk takes the node from list2 and steps p2 past it. ${
            alreadyLinked
              ? "The tail already pointed here, so no arrow had to move."
              : "The tail's arrow now points at it, which is the splice."
          }`
        : `Step ${step}. ${before} against ${after}, so the smaller one is ${Math.min(before, after)} from list${source}, and that is the node that joins the merged list. ${
            alreadyLinked
              ? "It was already the tail's next node, so the arrow stays exactly where it was."
              : "The tail's arrow swings across to it, and that redrawn arrow is the whole step."
          }`,
      [["p1", p1], ["p2", p2], ["tail", tail]],
      [p1, p2],
      chips(`tail = ${value(tail)}`, `placed ${placed.length} of ${total}`),
    );
  }

  // One list is empty, so the other one is already sorted and already linked:
  // the rest hangs on in a single step rather than node by node.
  const remaining = p1 ?? p2;
  if (remaining && tail) {
    const emptied = p1 ? 2 : 1;
    const kept = p1 ? 1 : 2;
    const restIds: string[] = [];
    for (let cursor: string | null = remaining; cursor; cursor = state.next.get(cursor) ?? null) restIds.push(cursor);
    state.next.set(tail, remaining);
    placed.push(...restIds);
    push(
      "rest",
      `list${emptied} is empty, so list${kept}'s rest hangs on`,
      `p${emptied} has run off the end, so every node still unplaced belongs to list${kept}, and they are already in order behind ${value(remaining)}. One arrow from the tail picks up the whole run, which is why the merge never walks the leftovers.`,
      [["tail", tail], [`p${kept}`, remaining]],
      [remaining],
      chips(`tail = ${value(tail)}`, `placed ${placed.length} of ${total}`),
    );
  }

  const head = placed[0]!;
  const order = placed.map((id) => value(id));
  push(
    "merged",
    `Merged list: ${order.join(" ")}`.slice(0, 60),
    `The merged list starts at ${value(head)} and every arrow now points at the next smallest value, weaving between the two blocks. The nodes never moved on the board; only their arrows did, and that is what splicing means.`,
    [["head", head]],
    [],
    chips(`placed ${total} of ${total}`),
  );
  if (frames.length > MAX_FRAMES) return null;

  return {
    algorithmId: "merge_two_lists",
    title: "Merge two sorted lists",
    input: { list1: first, list2: second },
    result: order,
    resultText: order.join(" ").slice(0, 60),
    frames,
  };
}

/* ------------------------------------------------------------------ *
 * Remove the nth node from the end (LeetCode 19)
 * ------------------------------------------------------------------ */

export interface RemoveNthInput {
  values: number[];
  /** How far from the end the doomed node sits; 1 is the last node. */
  n: number;
}

/**
 * The one pass version: open a gap of n nodes between two cursors, then walk
 * both until the leading cursor is on the last node. The trailing cursor is
 * then standing on the node BEFORE the one to remove, which is the only
 * position from which a singly linked list can drop a node at all.
 *
 * The gap is drawn by moving `fast` alone for n frames. Collapsing that into
 * one frame is the version of this lesson that fails: the student sees two
 * cursors apart by some distance and no reason why that distance is n, which
 * is the entire idea.
 *
 * n equal to the length would remove the head, and the head has no node
 * before it. Real solutions buy that case with a dummy node in front of the
 * list; drawing a dummy node would put a box on the board that the statement
 * never mentions, so the simulator declines instead and the narration says
 * what the dummy would have been for.
 */
export function simulateRemoveNthFromEnd(input: RemoveNthInput): AlgorithmTrace | null {
  const values = input.values;
  const n = input.n;
  if (values.length < 3 || values.length > 7) return null;
  if (!drawable(values)) return null;
  if (!Number.isInteger(n) || n < 1 || n >= values.length) return null;

  const state = board([{ prefix: "n", values }]);
  const value = (id: string) => state.valueOf.get(id)!;
  const frames: TraceFrame[] = [];
  const last = state.ids[state.ids.length - 1]!;

  const push = (
    id: string,
    caption: string,
    say: string,
    cursors: ReadonlyArray<[string, string | null]>,
    marks: ReadonlyMap<string, TraceMark>,
    note: string,
    linkMarks: ReadonlyMap<string, TraceMark> = new Map(),
  ) => {
    frames.push({
      id,
      caption,
      narrationIntent: say,
      state: {
        kind: "list",
        nodes: nodesOf(state, marks),
        links: linksOf(state, linkMarks),
        pointers: pointersOf(state, cursors),
        note,
      },
    });
  };

  let slow = state.ids[0]!;
  let fast = state.ids[0]!;

  push(
    "input",
    `n = ${n}: remove the ${ordinal(n)} node from the end`.slice(0, 60),
    `Nothing in a singly linked list can be counted from the back, because every arrow points forward. Two cursors fix that: open a gap of ${n} nodes between them, then slide both along together, and when the leading one reaches the end the trailing one is ${n} nodes from the end as well.`,
    [["slow", slow], ["fast", fast]],
    new Map([[slow, "active"]]),
    chips(`n = ${n}`, "gap is 0"),
  );

  for (let stride = 1; stride <= n; stride += 1) {
    fast = state.next.get(fast)!;
    push(
      `gap${stride}`,
      stride === n ? `fast is now ${n} nodes ahead of slow` : `fast takes step ${stride} of ${n}`,
      stride === n
        ? `fast has taken all ${n} steps and sits on ${value(fast)}, so the gap between the cursors is exactly ${n} nodes and it will stay ${n} from here on. slow has not moved yet.`
        : `fast moves on its own to ${value(fast)}. That is step ${stride} of ${n}, and slow stays at the head while the gap opens.`,
      [["slow", slow], ["fast", fast]],
      new Map([[slow, "active"], [fast, "active"]]),
      chips(`n = ${n}`, `gap is ${stride}`),
    );
  }

  let walk = 0;
  while (fast !== last) {
    slow = state.next.get(slow)!;
    fast = state.next.get(fast)!;
    walk += 1;
    push(
      `walk${walk}`,
      `Both step on: slow at ${value(slow)}, fast at ${value(fast)}`.slice(0, 60),
      `Move ${walk} of the pair. Both cursors take one step, so the gap is still ${n}: slow is on ${value(slow)} and fast is on ${value(fast)}. The moment fast lands on the last node this stops.`,
      [["slow", slow], ["fast", fast]],
      new Map([[slow, "active"], [fast, "active"]]),
      chips(`gap stays ${n}`, `moves ${walk}`),
    );
  }

  const doomed = state.next.get(slow)!;
  const after = state.next.get(doomed) ?? null;
  state.next.set(slow, after);
  const removedValue = value(doomed);
  const kept = state.ids.filter((id) => id !== doomed).map((id) => value(id));

  push(
    "unlink",
    `slow points past ${removedValue}, so it leaves the list`.slice(0, 60),
    `fast is on the last node, so slow is standing one before the node that has to go. Pointing slow's arrow at the node after ${removedValue} takes ${removedValue} out of the chain. Nothing else in the list changes, and the dashed arrow out of ${removedValue} leads nowhere any student can reach.`,
    [["slow", slow], ["fast", fast]],
    new Map([[slow, "active"], [doomed, "excluded"]]),
    chips(`drop ${removedValue}`),
    new Map([[doomed, "excluded"]]),
  );

  push(
    "done",
    `The list is now ${kept.join(" ")}`.slice(0, 60),
    `One walk down the list and one arrow moved. The gap did the counting, which is why this never needs a first pass to measure the length. If n had been the length itself the doomed node would be the head, and a dummy node placed in front of the list is the usual way to give the head something standing before it.`,
    [["slow", slow]],
    new Map<string, TraceMark>([
      ...state.ids.filter((id) => id !== doomed).map((id) => [id, "done" as const] as const),
      [doomed, "excluded" as const],
    ]),
    chips(`removed ${removedValue}`),
    new Map([[doomed, "excluded"]]),
  );
  if (frames.length > MAX_FRAMES) return null;

  return {
    algorithmId: "two_pass_or_gap_pointers",
    title: "Remove the nth node from the end",
    input: { values, n },
    result: kept,
    resultText: kept.join(" ").slice(0, 60),
    frames,
  };
}

/* ------------------------------------------------------------------ *
 * Add two numbers (LeetCode 2)
 * ------------------------------------------------------------------ */

export interface DigitCarryInput {
  l1: number[];
  l2: number[];
}

/**
 * Column addition over two lists whose digits are stored least significant
 * first. This is the one walk of the four that does NOT rewire its input: the
 * answer is a new list, so the inputs keep every arrow they started with and
 * the sum grows in the aside row beside them.
 *
 * The carry is the whole difficulty, so it is in the note on every frame
 * rather than only in the frames where it happens to be 1. A student who sees
 * "carry 1" appear from nowhere on the second column has been shown the
 * arithmetic and not the algorithm.
 */
export function simulateAddTwoNumbers(input: DigitCarryInput): AlgorithmTrace | null {
  const first = input.l1;
  const second = input.l2;
  if (first.length < 1 || second.length < 1) return null;
  if (first.length > 4 || second.length > 4) return null;
  if (first.length + second.length > 8) return null;
  // Every node must hold one digit, or the "carry when the column reaches
  // ten" rule the board is about does not hold.
  const digits = [...first, ...second];
  if (!digits.every((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9)) return null;

  const state = board([
    { prefix: "a", values: first },
    { prefix: "b", values: second },
  ]);
  const value = (id: string) => state.valueOf.get(id)!;
  const width = Math.max(first.length, second.length) + 1;
  const frames: TraceFrame[] = [];
  const sum: number[] = [];

  const sumAside = (): TraceAside =>
    aside(
      "sum",
      "sum",
      "row",
      sum,
      width,
      new Map(sum.length > 0 ? [[sum.length - 1, "active" as const]] : []),
    );

  const push = (
    id: string,
    caption: string,
    say: string,
    cursors: ReadonlyArray<[string, string | null]>,
    marks: ReadonlyMap<string, TraceMark>,
    note: string,
  ) => {
    frames.push({
      id,
      caption,
      narrationIntent: say,
      state: {
        kind: "list",
        nodes: nodesOf(state, marks),
        links: linksOf(state),
        pointers: pointersOf(state, cursors),
        note,
        asides: [sumAside()],
      },
    });
  };

  const readsAs = (values: ReadonlyArray<number>) => [...values].reverse().join("");
  let p1: string | null = state.ids[0]!;
  let p2: string | null = state.ids[first.length]!;

  push(
    "input",
    `Digits back to front: ${readsAs(first)} plus ${readsAs(second)}`.slice(0, 60),
    `Each list holds one digit per node with the ones column first, which looks backwards until you notice it is exactly the order column addition wants. p1 and p2 start on the two ones digits, and the sum is built as a new list while both inputs are left untouched.`,
    [["p1", p1], ["p2", p2]],
    new Map<string, TraceMark>([[p1, "active"], [p2, "active"]]),
    chips("ones column", "carry 0"),
  );

  let carry = 0;
  let column = 0;
  const consumed = new Set<string>();
  while (p1 || p2 || carry > 0) {
    const left = p1 ? value(p1) : 0;
    const right = p2 ? value(p2) : 0;
    const totalHere = left + right + carry;
    const digit = totalHere % 10;
    const carried = Math.floor(totalHere / 10);
    const parts = [String(left), String(right), ...(carry > 0 ? [String(carry)] : [])];
    const marks = new Map<string, TraceMark>();
    for (const id of consumed) marks.set(id, "done");
    if (p1) marks.set(p1, "active");
    if (p2) marks.set(p2, "active");

    sum.push(digit);
    column += 1;
    push(
      `col${column}`,
      `${parts.join(" + ")} = ${totalHere}, write ${digit} carry ${carried}`.slice(0, 60),
      `Column ${column}. ${parts.join(" plus ")} makes ${totalHere}, so the node written into the sum holds ${digit} and ${
        carried > 0
          ? `a carry of ${carried} waits for the next column, exactly as it would in written addition.`
          : "there is nothing to carry, so the next column starts clean."
      }`,
      [["p1", p1], ["p2", p2]],
      marks,
      chips(`column ${column}`, `carry ${carried}`),
    );

    carry = carried;
    if (p1) {
      consumed.add(p1);
      p1 = state.next.get(p1) ?? null;
    }
    if (p2) {
      consumed.add(p2);
      p2 = state.next.get(p2) ?? null;
    }
  }

  push(
    "done",
    `The sum list is ${sum.join(" ")}, which reads ${readsAs(sum)}`.slice(0, 60),
    `Both cursors have run off the end and no carry is left, so the loop stops. Read the sum list back to front and it is ${readsAs(sum)}, the answer to ${readsAs(first)} plus ${readsAs(second)}, and the two input lists are exactly as they started.`,
    [],
    new Map<string, TraceMark>(state.ids.map((id) => [id, "done" as const])),
    chips("no carry left", `${sum.length} digits`),
  );
  if (frames.length > MAX_FRAMES) return null;

  return {
    algorithmId: "digit_carry_list",
    title: "Add two numbers stored as lists",
    input: { l1: first, l2: second },
    result: sum,
    resultText: sum.join(" ").slice(0, 60),
    frames,
  };
}

/* ------------------------------------------------------------------ *
 * Reverse nodes in k-group (LeetCode 25)
 * ------------------------------------------------------------------ */

export interface ReverseKGroupInput {
  values: number[];
  k: number;
}

/**
 * Reverse each block of k nodes, leave a short final block alone.
 *
 * The board keeps every node where it started, so a reversed block draws as
 * arrows hooking backwards under the row and the join between blocks draws as
 * an arc over it. That is the honest picture: the nodes never move in memory,
 * only the arrows do, and a board that reordered the boxes would be showing
 * an array being sorted rather than a list being relinked.
 *
 * The reversal and the join are separate frames on purpose. Between them the
 * list is genuinely broken: the previous block's tail still points at the old
 * head of this block, which is now its tail, so the new head hangs off
 * nothing. Every real implementation passes through that state, and hiding it
 * is what makes k-group feel like magic instead of bookkeeping.
 */
export function simulateReverseKGroup(input: ReverseKGroupInput): AlgorithmTrace | null {
  const values = input.values;
  const k = input.k;
  if (values.length < 3 || values.length > 7) return null;
  if (!drawable(values)) return null;
  if (!Number.isInteger(k) || k < 2 || k > 4 || k > values.length) return null;

  const groups = Math.floor(values.length / k);
  const leftover = values.length - groups * k;
  // input + (block, flip) per group + a join for every group after the first
  // + the short tail + the answer.
  if (1 + 2 * groups + (groups - 1) + (leftover > 0 ? 1 : 0) + 1 > MAX_FRAMES) return null;

  const state = board([{ prefix: "n", values }]);
  const value = (id: string) => state.valueOf.get(id)!;
  const frames: TraceFrame[] = [];
  const order: number[] = [];

  const orderAside = (): TraceAside =>
    aside(
      "order",
      "order",
      "row",
      order,
      values.length,
      new Map(order.length > 0 ? [[order.length - 1, "active" as const]] : []),
    );

  const push = (
    id: string,
    caption: string,
    say: string,
    cursors: ReadonlyArray<[string, string | null]>,
    marks: ReadonlyMap<string, TraceMark>,
    note: string,
  ) => {
    frames.push({
      id,
      caption,
      narrationIntent: say,
      state: {
        kind: "list",
        nodes: nodesOf(state, marks),
        links: linksOf(state),
        pointers: pointersOf(state, cursors),
        note,
        asides: [orderAside()],
      },
    });
  };

  const settled = new Map<string, TraceMark>();

  push(
    "input",
    `Reverse every block of ${k}, k = ${k}`.slice(0, 60),
    `The list is cut into blocks of ${k} nodes and each block is reversed on its own, so this is the plain reversal done ${groups} times with one extra job: the tail of a finished block has to be pointed at the head of the next one. Blocks shorter than ${k} at the end are left exactly as they are.`,
    [["curr", state.ids[0]!]],
    new Map(),
    chips(`k = ${k}`, `${groups} full blocks`),
  );

  let previousTail: string | null = null;
  for (let g = 0; g < groups; g += 1) {
    const start = g * k;
    const blockIds = state.ids.slice(start, start + k);
    const blockHead = blockIds[0]!;
    const blockLast = blockIds[blockIds.length - 1]!;
    const after = state.ids[start + k] ?? null;
    const blockValues = blockIds.map((id) => value(id));

    const window = new Map(settled);
    for (const id of blockIds) window.set(id, "window");
    push(
      `blk${g + 1}`,
      `Block ${g + 1} holds ${blockValues.join(" ")}`.slice(0, 60),
      `Block ${g + 1} is the next ${k} nodes, holding ${blockValues.join(" and ")}. curr is on its first node and kth is on its last, and counting ${k} nodes ahead before touching anything is what proves a full block is there to reverse.`,
      [["curr", blockHead], ["kth", blockLast]],
      window,
      chips(`block ${g + 1}`, `k = ${k}`),
    );

    // Reverse inside the block, leaving the old head pointing at whatever
    // follows the block. This is the plain prev/curr walk with a stop.
    for (let index = blockIds.length - 1; index > 0; index -= 1) {
      state.next.set(blockIds[index]!, blockIds[index - 1]!);
    }
    state.next.set(blockHead, after);
    order.push(...[...blockValues].reverse());

    const flipped = new Map(settled);
    for (const id of blockIds) flipped.set(id, "window");
    flipped.set(blockLast, "active");
    push(
      `flip${g + 1}`,
      `Block ${g + 1} now reads ${[...blockValues].reverse().join(" ")}`.slice(0, 60),
      `Every arrow inside block ${g + 1} is turned round, so the block now reads ${[...blockValues].reverse().join(" then ")}, and its old head ${value(blockHead)} has become its tail pointing at ${
        after ? `${value(after)}, the first node after the block` : "null, the end of the list"
      }. ${
        g === 0
          ? `${value(blockLast)} is the head of the whole answer from here on.`
          : `The new head ${value(blockLast)} is hanging off nothing yet, which the next step fixes.`
      }`,
      [["prev", previousTail], ["head", blockLast], ["tail", blockHead]],
      flipped,
      chips(`block ${g + 1} done`, `head ${value(blockLast)}`),
    );

    if (previousTail) {
      state.next.set(previousTail, blockLast);
      for (const id of blockIds) settled.set(id, "done");
      push(
        `join${g + 1}`,
        `Block ${g}'s tail ${value(previousTail)} now points at ${value(blockLast)}`.slice(0, 60),
        `The tail left behind by block ${g} was still pointing at the old head of block ${g + 1}. Swinging it onto ${value(blockLast)} stitches the two reversed blocks together, and this single arrow is the only thing k-group adds to an ordinary reversal.`,
        [["prev", previousTail], ["head", blockLast]],
        new Map(settled),
        chips(`joined block ${g + 1}`),
      );
    } else {
      for (const id of blockIds) settled.set(id, "done");
    }
    previousTail = blockHead;
  }

  if (leftover > 0) {
    const restIds = state.ids.slice(groups * k);
    const restValues = restIds.map((id) => value(id));
    order.push(...restValues);
    push(
      "rest",
      `${leftover} node left, fewer than ${k}, so it stays`.slice(0, 60),
      `Only ${leftover} node is left after the last full block, and ${leftover} is fewer than ${k}, so the statement says to leave it alone. The tail of the block before it already points at ${restValues[0]}, so there is nothing to do at all.`,
      [["curr", restIds[0]!]],
      new Map(settled),
      chips(`${leftover} left over`, `fewer than ${k}`),
    );
  }

  const head = state.ids[k - 1]!;
  push(
    "done",
    `Result: ${order.join(" ")}`.slice(0, 60),
    `Reading from the new head ${value(head)} and following the arrows gives ${order.join(" then ")}. Each block was reversed in place and joined to the one before it, so the whole thing is one pass over the list with no new nodes anywhere.`,
    [["head", head]],
    new Map<string, TraceMark>(state.ids.map((id) => [id, "done" as const])),
    chips("all blocks joined"),
  );
  if (frames.length > MAX_FRAMES) return null;

  return {
    algorithmId: "reverse_k_group",
    title: "Reverse nodes in k-group",
    input: { values, k },
    result: order,
    resultText: order.join(" ").slice(0, 60),
    frames,
  };
}
