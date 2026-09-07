/**
 * Binary heaps: sift up, sift down, and the three problems a size-k heap
 * answers.
 *
 * The hard part of a heap is not the sifting, it is that the tree and the
 * array are the same object. A board that draws only the tree teaches a
 * shape the code never touches; a board that draws only the array teaches an
 * ordering rule with no reason behind it. Every frame here is a `stacked`
 * pair, the heap as a tree over the array that backs it, so one exchange
 * repaints two circles and two cells at the same instant and the student can
 * see that they are one move.
 *
 * Three decisions follow from that, and each of them is a place where the
 * obvious rendering would teach something false.
 *
 * **A slot is the identity, a value is not.** Node ids are `h0`..`hN`, which
 * are the array indices. Values move between slots; slots never move. Ids
 * stay stable across frames, the exchange is visibly the same exchange in
 * both figures, and the "children of i are 2i+1 and 2i+2" arithmetic can be
 * read straight off the board. Naming a node after its value would have made
 * every swap look like two nodes trading places in a tree that reshapes
 * itself, which is not what the code does.
 *
 * **A vacated slot is drawn empty, not removed.** A heap's array keeps its
 * capacity while its size shrinks, so a popped tail slot is an empty box and
 * an empty circle. Dropping the slot instead would relayout the tree between
 * frames and make the whole figure jump, and it would hide the one move an
 * array-backed heap is built around: the LAST element is the one that goes
 * to the root. The empty slot before an insert is the same idea read
 * forwards, and it is where the new value is about to land.
 *
 * **The comparison lives in the frame note, never only in the caption.** A
 * sift is a chain of two-value decisions. "14 < 21, so it rises" beside the
 * picture is the reason the arrangement changed; without it the board shows
 * an arrangement that reorganises itself for no visible cause.
 *
 * Every simulator here is pure: same input, same frames, and an input it
 * cannot honour returns null rather than throwing or half drawing.
 */
import {
  aside,
  type AlgorithmTrace,
  type TraceAside,
  type TraceCell,
  type TraceEdge,
  type TraceFrame,
  type TraceFrameState,
  type TraceMark,
  type TraceNode,
  type TreeAnnotation,
} from "../types";

/** Frames one heap walk may spend; the gate allows 16 per family. */
const MAX_FRAMES = 16;

/** Slot ids are array indices, so `h3` is cell 3 in every frame of a trace. */
function slotId(index: number): string {
  return `h${index}`;
}

interface HeapLayout {
  nodes: TraceNode[];
  edges: TraceEdge[];
}

/**
 * The full slot tree, used as `layoutNodes` in every frame so positions are
 * fixed once for the whole walk. Edges are emitted in index order, which
 * gives every parent its left child before its right one and lays the tree
 * out in the same left-to-right order as the array underneath it.
 */
function layoutFor(slots: number): HeapLayout {
  const nodes: TraceNode[] = [];
  const edges: TraceEdge[] = [];
  for (let index = 0; index < slots; index += 1) {
    nodes.push({ id: slotId(index), label: slotId(index) });
    if (index > 0) edges.push({ from: slotId(Math.floor((index - 1) / 2)), to: slotId(index) });
  }
  return { nodes, edges };
}

interface HeapFrameInput {
  layout: HeapLayout;
  /** One entry per slot; an empty string is a slot the heap is not using. */
  slots: readonly string[];
  marks: ReadonlyMap<number, TraceMark>;
  note?: string;
  asides?: TraceAside[];
  annotations?: TreeAnnotation[];
}

/**
 * One frame: the heap as a tree above its backing array. Both parts are
 * built from the same slot array and the same mark map, so the two figures
 * cannot disagree about what the heap holds. An empty slot carries no mark,
 * because a wash or a tick on an empty box says the algorithm is doing
 * something to a value that is not there.
 */
function heapState(input: HeapFrameInput): TraceFrameState {
  const nodes: TraceNode[] = input.slots.map((text, index) => {
    const mark = text ? input.marks.get(index) : undefined;
    return { id: slotId(index), label: text, ...(mark ? { mark } : {}) };
  });
  const row: TraceCell[] = input.slots.map((text, index) => {
    const mark = text ? input.marks.get(index) : undefined;
    return mark ? { text, mark } : { text };
  });
  return {
    kind: "stacked",
    ...(input.note ? { note: input.note } : {}),
    parts: [
      {
        label: "heap",
        state: {
          kind: "tree",
          nodes,
          edges: input.layout.edges,
          layoutNodes: input.layout.nodes,
          layoutEdges: input.layout.edges,
          ...(input.annotations?.length ? { annotations: input.annotations } : {}),
        },
      },
      {
        label: "array",
        state: {
          kind: "array",
          cells: row,
          showIndices: true,
          ...(input.asides?.length ? { asides: input.asides } : {}),
        },
      },
    ],
  };
}

function isMinHeap(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || values[Math.floor((index - 1) / 2)]! <= value);
}

function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
}

function times(count: number): string {
  return count === 1 ? "1 time" : `${count} times`;
}

// --- Explain a heap: one insert that sifts up, one pop that sifts down. ---

export interface HeapSiftInput {
  /** A heap that already satisfies the min-heap rule, written as its array. */
  values: number[];
  /** The value inserted before the root is popped. */
  insert: number;
}

/**
 * The textbook ask. An insert and a pop are the only two operations a heap
 * has, and they are the same idea run in opposite directions: a value that
 * arrives at the wrong end walks to its place one comparison at a time.
 *
 * The input has to be a heap already. Quietly heapifying an arbitrary array
 * would put a different arrangement on the board from the one the question
 * wrote down, so a non-heap declines and the family falls back to its own
 * example instead.
 */
export function simulateHeapSift(input: HeapSiftInput): AlgorithmTrace | null {
  const start = input.values;
  if (start.length < 3 || start.length > 6) return null;
  if (!start.every((value) => Number.isFinite(value))) return null;
  if (!Number.isFinite(input.insert)) return null;
  if (!isMinHeap(start)) return null;

  const slots = start.length + 1;
  const layout = layoutFor(slots);
  const heap = [...start];
  const frames: TraceFrame[] = [];

  const row = (): string[] =>
    Array.from({ length: slots }, (_, index) => (index < heap.length ? String(heap[index]!) : ""));

  const push = (
    id: string,
    caption: string,
    narrationIntent: string,
    marks: ReadonlyMap<number, TraceMark>,
    note: string,
  ): void => {
    frames.push({ id, caption, narrationIntent, state: heapState({ layout, slots: row(), marks, note }) });
  };

  push(
    "heap",
    "A min heap: no parent is bigger than its children",
    `This is a min heap, drawn twice. The tree on top and the array underneath are the same object: the value in slot i lives in array cell i, and its two children are cells 2i plus 1 and 2i plus 2. The only rule is that a parent is never larger than either child, and that rule alone forces the smallest value in the whole heap to be sitting at the root. The empty slot at the end is where the next value will go.`,
    new Map(),
    "min heap  parent <= child",
  );

  const landing = heap.length;
  heap.push(input.insert);
  push(
    "insert",
    `${input.insert} lands in the next free slot, index ${landing}`,
    `A heap always fills the next free cell of the array, which keeps the tree complete and is why no space is ever wasted. So ${input.insert} goes into cell ${landing}, and in the tree that cell is a new leaf. It is almost certainly in the wrong place, and the only thing that can be wrong about it is its own parent.`,
    new Map<number, TraceMark>([[landing, "active"]]),
    `insert ${input.insert}  slot ${landing}`,
  );

  let index = heap.length - 1;
  let rises = 0;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent]! <= heap[index]!) break;
    rises += 1;
    const child = heap[index]!;
    const above = heap[parent]!;
    push(
      `rise${rises}`,
      `${child} is smaller than its parent ${above}, so it rises`,
      `Compare cell ${index} with its parent, cell ${parent}. ${child} is smaller than ${above}, which breaks the rule, so the two swap. Watch both figures at once: the circles trade values and cells ${index} and ${parent} trade values, because that is one exchange, not two.`,
      new Map<number, TraceMark>([[index, "active"], [parent, "candidate"]]),
      `${child} < ${above}  it rises`,
    );
    heap[index] = above;
    heap[parent] = child;
    index = parent;
  }

  const settledParent = index > 0 ? Math.floor((index - 1) / 2) : null;
  push(
    "upstop",
    settledParent === null
      ? `${heap[index]} climbed all the way to the root`
      : `${heap[index]} is not smaller than ${heap[settledParent]}, so it stops`,
    settledParent === null
      ? `The climb reached cell 0, and the root has no parent to break the rule against, so it stops there. ${heap[index]} is now the smallest value in the heap, which is exactly what an insert of a new minimum should do. The insert cost ${rises} comparison${rises === 1 ? "" : "s"}, one per level, never a scan of the whole array.`
      : `Now compare cell ${index} with its parent, cell ${settledParent}. ${heap[index]} is not smaller than ${heap[settledParent]}, so the rule already holds and the climb stops here after ${rises} swap${rises === 1 ? "" : "s"}. Everything below is untouched, because nothing under a value that only got smaller can be out of order.`,
    settledParent === null
      ? new Map<number, TraceMark>([[index, "active"]])
      : new Map<number, TraceMark>([[index, "active"], [settledParent, "candidate"]]),
    settledParent === null ? `${heap[index]} is the root` : `${heap[index]} >= ${heap[settledParent]}  it stops`,
  );

  const min = heap[0]!;
  push(
    "pop",
    `The root is the smallest, so ${min} comes out`,
    `Popping a heap always means taking the root, because the rule guarantees nothing in the heap is smaller than it. ${min} is the answer to "what is the minimum", and it took no searching at all to find it. The problem is the hole it leaves at cell 0.`,
    new Map<number, TraceMark>([[0, "excluded"]]),
    `pop the root  min = ${min}`,
  );

  const last = heap.pop()!;
  heap[0] = last;
  push(
    "refill",
    `The last value ${last} moves up into the root`,
    `The hole is filled with the last cell of the array, ${last}, and the array shrinks by one so the tree stays complete. Any other choice would leave a gap in the middle of the array. ${last} almost certainly does not belong at the top, so now it has to walk back down.`,
    new Map<number, TraceMark>([[0, "active"]]),
    `last to root  ${last} on top`,
  );

  let cursor = 0;
  let sinks = 0;
  while (frames.length < MAX_FRAMES - 1) {
    const left = 2 * cursor + 1;
    const right = 2 * cursor + 2;
    let best = cursor;
    if (left < heap.length && heap[left]! < heap[best]!) best = left;
    if (right < heap.length && heap[right]! < heap[best]!) best = right;
    if (best === cursor) break;
    sinks += 1;
    const parent = heap[cursor]!;
    const winner = heap[best]!;
    const marks = new Map<number, TraceMark>([[cursor, "active"]]);
    if (left < heap.length) marks.set(left, "candidate");
    if (right < heap.length) marks.set(right, "candidate");
    push(
      `sink${sinks}`,
      `${winner} is the smaller child, so ${parent} sinks`,
      `Cell ${cursor} is compared with both of its children at once, cells ${left}${right < heap.length ? ` and ${right}` : ""}. The smaller child is ${winner}, and ${parent} is bigger than it, so those two swap and ${parent} drops to cell ${best}. Swapping with the smaller child matters: swapping with the larger one would leave the rule broken on the other side.`,
      marks,
      `${winner} < ${parent}  it sinks`,
    );
    heap[cursor] = winner;
    heap[best] = parent;
    cursor = best;
  }

  push(
    "settled",
    `${min} is out, ${heap[0]} is the new root`,
    `Cell ${cursor} has no child smaller than it, so the walk down is finished and the heap rule holds again everywhere. The pop cost ${sinks} swap${sinks === 1 ? "" : "s"}, one per level, and the new smallest value ${heap[0]} is sitting at the root ready for the next pop. That is the whole trade a heap makes: never sorted, always able to hand you the minimum.`,
    new Map<number, TraceMark>([[0, "done"], [cursor, "done"]]),
    `heap restored  min was ${min}`,
  );

  if (frames.length < 2 || frames.length > MAX_FRAMES) return null;
  return {
    algorithmId: "heap_sift",
    title: "Min heap sift up and sift down",
    input: { values: start, insert: input.insert },
    result: { min, heap: [...heap] },
    resultText: `min ${min} out, ${heap[0]} is the new root`,
    frames,
  };
}

// --- Kth largest with a size-k min heap (LeetCode 215). ---

export interface HeapTopKInput {
  values: number[];
  k: number;
}

/**
 * A size-k min heap answers "kth largest" because of one property that is
 * easy to state and hard to believe until you watch it: the root of a heap
 * holding the k largest values seen so far IS the kth largest of them. So
 * the whole algorithm is a doorman. Everything the heap has ever turned away
 * was no bigger than the root at the time, and everything it evicted was the
 * smallest thing it was holding.
 *
 * The eviction is the lesson, so it gets its own frame and the value leaving
 * is struck through. A walk that only showed the heap before and after each
 * value would show k values changing with no visible reason.
 */
export function simulateHeapTopK(input: HeapTopKInput): AlgorithmTrace | null {
  const values = input.values;
  const k = input.k;
  if (values.length < 4 || values.length > 7) return null;
  if (!values.every((value) => Number.isFinite(value))) return null;
  if (!Number.isInteger(k) || k < 2 || k > 3 || k >= values.length) return null;

  const layout = layoutFor(k);
  const heap: number[] = [];
  const frames: TraceFrame[] = [];
  /** The final mark of each input cell: kept, or turned away. */
  const settled = new Map<number, TraceMark>();

  const row = (): string[] =>
    Array.from({ length: k }, (_, index) => (index < heap.length ? String(heap[index]!) : ""));

  const push = (
    id: string,
    caption: string,
    narrationIntent: string,
    marks: ReadonlyMap<number, TraceMark>,
    note: string,
    current: number | null,
  ): void => {
    const numsMarks = new Map(settled);
    if (current !== null) numsMarks.set(current, "active");
    frames.push({
      id,
      caption,
      narrationIntent,
      state: heapState({
        layout,
        slots: row(),
        marks,
        note,
        asides: [aside("nums", "nums", "row", values, values.length, numsMarks)],
      }),
    });
  };

  // Filling phase: the first k values go in unconditionally, because a heap
  // that is not yet full has nothing to compare a newcomer against.
  for (let at = 0; at < k; at += 1) {
    const value = values[at]!;
    let index = heap.length;
    heap.push(value);
    let rises = 0;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (heap[parent]! <= heap[index]!) break;
      rises += 1;
      const above = heap[parent]!;
      push(
        `fill${at}_${rises}`,
        `${value} is smaller than ${above}, so it rises`,
        `The heap is still filling, so ${value} simply goes into cell ${index} and then sifts up. ${value} is smaller than its parent ${above}, so they swap, and in a min heap that is how the smallest value so far finds its way to cell 0.`,
        new Map<number, TraceMark>([[index, "active"], [parent, "candidate"]]),
        `${value} < ${above}  it rises`,
        at,
      );
      heap[index] = above;
      heap[parent] = value;
      index = parent;
    }
    settled.set(at, "done");
    const parent = index > 0 ? Math.floor((index - 1) / 2) : null;
    push(
      `fill${at}`,
      at === 0
        ? `${value} goes in first, and the heap keeps only ${k}`
        : heap.length < k
          ? `${value} joins, so the heap holds ${heap.length} of ${k}`
          : `The heap is full and ${heap[0]} is the smallest kept`,
      at === 0
        ? `The heap will never hold more than ${k} values, because we only ever care about the ${k} largest. ${value} is the first one in, so it sits at the root by default. The row underneath is the input we are walking through, and it is the only place the values ever come from.`
        : heap.length < k
          ? `${value} is in at cell ${index}, and the heap still has room, so nothing has to leave yet. Until the heap is full every value is kept, whatever it is worth.`
          : `That fills the heap. ${heap[0]} is at the root, which means ${heap[0]} is the smallest of the ${k} values we are keeping, and from here it is the value every newcomer has to beat.`,
      parent === null
        ? new Map<number, TraceMark>([[index, "active"]])
        : new Map<number, TraceMark>([[index, "active"], [parent, "candidate"]]),
      heap.length < k ? `keep ${k}  holding ${heap.length}` : `keep ${k}  root = ${heap[0]}`,
      at,
    );
  }

  // Offering phase: the root is the bar, and the heap never changes size.
  for (let at = k; at < values.length; at += 1) {
    const value = values[at]!;
    const root = heap[0]!;
    if (value <= root) {
      settled.set(at, "excluded");
      push(
        `turn${at}`,
        `${value} is not bigger than ${root}, so it is out`,
        `${value} is compared with the root, ${root}. The root is the smallest of the ${k} values we are keeping, so anything that cannot beat it cannot belong in the top ${k} either, and ${value} is struck out without ever entering the heap. One comparison retires a value for good.`,
        new Map<number, TraceMark>([[0, "candidate"]]),
        `${value} <= ${root}  no room`,
        at,
      );
      continue;
    }
    push(
      `evict${at}`,
      `${value} beats ${root}, so ${root} is evicted`,
      `${value} is bigger than the root ${root}, so it belongs in the top ${k} and something has to leave to make room. The value that leaves is the root itself, because it is the weakest thing the heap is holding. ${root} is struck out and ${value} takes cell 0.`,
      new Map<number, TraceMark>([[0, "excluded"]]),
      `${value} > ${root}  ${root} out`,
      at,
    );
    heap[0] = value;
    let cursor = 0;
    while (true) {
      const left = 2 * cursor + 1;
      const right = 2 * cursor + 2;
      let best = cursor;
      if (left < heap.length && heap[left]! < heap[best]!) best = left;
      if (right < heap.length && heap[right]! < heap[best]!) best = right;
      if (best === cursor) break;
      const parent = heap[cursor]!;
      heap[cursor] = heap[best]!;
      heap[best] = parent;
      cursor = best;
    }
    settled.set(at, "done");
    push(
      `take${at}`,
      `${value} is in, and the smallest kept is now ${heap[0]}`,
      `${value} sinks from the root until no child is smaller than it, landing in cell ${cursor}, and the root is now ${heap[0]}. The heap is still exactly ${k} values and it is still the ${k} largest seen so far, which is the invariant the whole method rests on.`,
      new Map<number, TraceMark>([[cursor, "active"], [0, cursor === 0 ? "active" : "candidate"]]),
      `${value} sinks  root = ${heap[0]}`,
      at,
    );
  }

  const answer = heap[0]!;
  push(
    "answer",
    `The ${ordinal(k)} largest is ${answer}`,
    `Every value in the input has been offered to the heap, and what survives is the ${k} largest of them. The root of a min heap is its smallest value, so the root of this heap is the smallest of the ${k} largest, and that is the ${ordinal(k)} largest overall: ${answer}. Nothing was ever sorted, and the heap never grew past ${k}.`,
    new Map<number, TraceMark>(Array.from({ length: heap.length }, (_, index) => [index, "done" as TraceMark])),
    `answer ${answer}`,
    null,
  );

  if (frames.length < 2 || frames.length > MAX_FRAMES) return null;
  return {
    algorithmId: "heap_top_k",
    title: "Kth largest with a size-k heap",
    input: { values, k },
    result: answer,
    resultText: `the ${ordinal(k)} largest is ${answer}`,
    frames,
  };
}

// --- Top k frequent elements (LeetCode 347). ---

export interface HeapFrequencyInput {
  values: number[];
  k: number;
}

interface Tally {
  value: number;
  count: number;
}

/**
 * The same size-k heap, ordered by a count rather than by the value itself.
 * That swap of key is the entire difference between this problem and Kth
 * Largest, and it is the thing a student most often gets wrong, so the heap
 * cells read "value:count" and every comparison in a note is written between
 * two counts. Drawing only the values would have made the board identical to
 * the Kth Largest board while the algorithm was ordering by something else.
 *
 * The counts are taken in first-appearance order, which is the order a real
 * hash map hands them back, so the walk is the walk the code performs.
 */
export function simulateHeapFrequency(input: HeapFrequencyInput): AlgorithmTrace | null {
  const values = input.values;
  const k = input.k;
  if (values.length < 4 || values.length > 12) return null;
  if (!values.every((value) => Number.isFinite(value))) return null;

  const tally: Tally[] = [];
  for (const value of values) {
    const seen = tally.find((entry) => entry.value === value);
    if (seen) seen.count += 1;
    else tally.push({ value, count: 1 });
  }
  if (tally.length < 2 || tally.length > 5) return null;
  if (!Number.isInteger(k) || k < 2 || k > 3 || k > tally.length) return null;

  const layout = layoutFor(k);
  const heap: Tally[] = [];
  const frames: TraceFrame[] = [];
  const settled = new Map<number, TraceMark>();
  const chip = (entry: Tally): string => `${entry.value}:${entry.count}`;

  const row = (): string[] =>
    Array.from({ length: k }, (_, index) => (index < heap.length ? chip(heap[index]!) : ""));

  const push = (
    id: string,
    caption: string,
    narrationIntent: string,
    marks: ReadonlyMap<number, TraceMark>,
    note: string,
    current: number | null,
  ): void => {
    const tallyMarks = new Map(settled);
    if (current !== null) tallyMarks.set(current, "active");
    frames.push({
      id,
      caption,
      narrationIntent,
      state: heapState({
        layout,
        slots: row(),
        marks,
        note,
        asides: [aside("count", "counts", "row", tally.map(chip), tally.length, tallyMarks)],
      }),
    });
  };

  for (let at = 0; at < k; at += 1) {
    const entry = tally[at]!;
    let index = heap.length;
    heap.push(entry);
    let rises = 0;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (heap[parent]!.count <= heap[index]!.count) break;
      rises += 1;
      const above = heap[parent]!;
      push(
        `fill${at}_${rises}`,
        `${entry.value} has count ${entry.count}, under ${above.count}, so it rises`,
        `The heap is ordered by count, never by the value itself. ${entry.value} was seen ${times(entry.count)} against ${above.count} for ${above.value}, so the smaller count rises and the pair in cells ${index} and ${parent} swap.`,
        new Map<number, TraceMark>([[index, "active"], [parent, "candidate"]]),
        `${entry.count} < ${above.count}  it rises`,
        at,
      );
      heap[index] = above;
      heap[parent] = entry;
      index = parent;
    }
    settled.set(at, "done");
    const parent = index > 0 ? Math.floor((index - 1) / 2) : null;
    push(
      `fill${at}`,
      at === 0
        ? `${entry.value} appears ${times(entry.count)} and goes in first`
        : heap.length < k
          ? `${chip(entry)} joins, ${heap.length} of ${k} kept`
          : `${chip(heap[0]!)} is on top, the weakest count kept`,
      at === 0
        ? `First the counts, in the row underneath: each chip reads value colon count, so ${chip(entry)} means the number ${entry.value} appeared ${times(entry.count)}. Those pairs are what goes into the heap, and the heap is ordered by the count half. ${entry.value} is the first pair in.`
        : heap.length < k
          ? `${chip(entry)} goes in while the heap still has room, so nothing is turned away yet. The heap will never hold more than ${k} pairs, because only ${k} answers are wanted.`
          : `The heap is full at ${k} pairs and the root is ${chip(heap[0]!)}, the smallest count in it. That count is now the bar: any pair that cannot beat it cannot be in the top ${k} either.`,
      parent === null
        ? new Map<number, TraceMark>([[index, "active"]])
        : new Map<number, TraceMark>([[index, "active"], [parent, "candidate"]]),
      heap.length < k ? `keep ${k}  holding ${heap.length}` : `keep ${k}  root ${chip(heap[0]!)}`,
      at,
    );
  }

  for (let at = k; at < tally.length; at += 1) {
    const entry = tally[at]!;
    const root = heap[0]!;
    if (entry.count <= root.count) {
      settled.set(at, "excluded");
      push(
        `turn${at}`,
        `${entry.value} appears ${times(entry.count)}, not more than ${root.count}`,
        `${entry.value} was seen ${times(entry.count)}, and the weakest pair the heap is keeping has count ${root.count}. A pair that cannot beat the weakest one kept cannot be in the top ${k}, so ${entry.value} is struck out on a single comparison and never enters the heap.`,
        new Map<number, TraceMark>([[0, "candidate"]]),
        `${entry.count} <= ${root.count}  out`,
        at,
      );
      continue;
    }
    push(
      `evict${at}`,
      `${entry.value} beats ${root.value} on count, so ${root.value} leaves`,
      `${entry.value} was seen ${times(entry.count)} against ${root.count} for ${root.value}, so ${entry.value} belongs in the top ${k} and the weakest pair has to go. The root ${chip(root)} is struck out and ${chip(entry)} takes cell 0.`,
      new Map<number, TraceMark>([[0, "excluded"]]),
      `${entry.count} > ${root.count}  ${root.value} out`,
      at,
    );
    heap[0] = entry;
    let cursor = 0;
    while (true) {
      const left = 2 * cursor + 1;
      const right = 2 * cursor + 2;
      let best = cursor;
      if (left < heap.length && heap[left]!.count < heap[best]!.count) best = left;
      if (right < heap.length && heap[right]!.count < heap[best]!.count) best = right;
      if (best === cursor) break;
      const parent = heap[cursor]!;
      heap[cursor] = heap[best]!;
      heap[best] = parent;
      cursor = best;
    }
    settled.set(at, "done");
    push(
      `take${at}`,
      `${chip(entry)} is in, the weakest is now ${chip(heap[0]!)}`,
      `${chip(entry)} sinks by count until no child has a smaller one, landing in cell ${cursor}, and the root is now ${chip(heap[0]!)}. The heap is back to exactly ${k} pairs and they are the ${k} most frequent seen so far.`,
      new Map<number, TraceMark>([[cursor, "active"], [0, cursor === 0 ? "active" : "candidate"]]),
      `sinks  root ${chip(heap[0]!)}`,
      at,
    );
  }

  const answer = [...heap]
    .sort((a, b) => b.count - a.count || tally.indexOf(a) - tally.indexOf(b))
    .map((entry) => entry.value);
  push(
    "answer",
    `Top ${k} most frequent: ${answer.join(", ")}`,
    `Every distinct value has been offered to the heap once, and what is left inside is the ${k} with the highest counts: ${answer.join(" and ")}. The heap never held more than ${k} pairs, so the work is one pass to count and one small heap operation per distinct value, which is the point of doing it this way rather than sorting every count.`,
    new Map<number, TraceMark>(Array.from({ length: heap.length }, (_, index) => [index, "done" as TraceMark])),
    `answer ${answer.join(" ")}`,
    null,
  );

  if (frames.length < 2 || frames.length > MAX_FRAMES) return null;
  const resultText = `top ${k} most frequent: ${answer.join(", ")}`;
  if (resultText.length > 60) return null;
  return {
    algorithmId: "heap_frequency",
    title: "Top k frequent elements",
    input: { values, k },
    result: answer,
    resultText,
    frames,
  };
}

// --- Merge k sorted lists with a heap of heads (LeetCode 23). ---

export interface HeapKWayMergeInput {
  lists: number[][];
}

const LIST_LETTERS = ["A", "B", "C", "D"] as const;

/**
 * The heap here holds one value per list, never a whole list, and that is
 * the claim worth drawing: the next value of the merged output has to be the
 * front of one of the lists, so a heap of just the fronts is enough to find
 * it. The tree annotation beside each node says which list a value came
 * from, because the refill step is "the list that just lost its head sends
 * its next value", and without the letters that step has no visible cause.
 *
 * The merged output is an aside row of fixed capacity, so the answer is
 * built in front of the student rather than announced at the end, and the
 * slots that empty as lists run out stay drawn: a heap that shrank by
 * deleting circles would relayout and move the array underneath it.
 */
export function simulateHeapKWayMerge(input: HeapKWayMergeInput): AlgorithmTrace | null {
  const lists = input.lists;
  if (lists.length < 2 || lists.length > 4) return null;
  if (lists.some((list) => list.length < 1 || list.length > 5)) return null;
  if (lists.some((list) => !list.every((value) => Number.isFinite(value)))) return null;
  // An unsorted list breaks the one assumption the method rests on, and the
  // walk would silently produce an unsorted answer.
  if (lists.some((list) => list.some((value, index) => index > 0 && list[index - 1]! > value))) return null;
  const total = lists.reduce((sum, list) => sum + list.length, 0);
  if (total < 4 || total > 10) return null;

  const slots = lists.length;
  const layout = layoutFor(slots);
  const cursors = lists.map(() => 0);
  const heap: Array<{ value: number; list: number }> = [];
  const out: number[] = [];
  const frames: TraceFrame[] = [];

  const row = (): string[] =>
    Array.from({ length: slots }, (_, index) => (index < heap.length ? String(heap[index]!.value) : ""));

  const annotations = (): TreeAnnotation[] =>
    heap.map((entry, index) => ({ nodeId: slotId(index), text: LIST_LETTERS[entry.list]! }));

  const outputAside = (): TraceAside => {
    const marks = new Map<number, TraceMark>();
    for (let index = 0; index < out.length; index += 1) {
      marks.set(index, index === out.length - 1 ? "active" : "done");
    }
    return aside("out", "output", "row", out, total, marks);
  };

  const push = (
    id: string,
    caption: string,
    narrationIntent: string,
    marks: ReadonlyMap<number, TraceMark>,
    note: string,
  ): void => {
    frames.push({
      id,
      caption,
      narrationIntent,
      state: heapState({
        layout,
        slots: row(),
        marks,
        note,
        asides: [outputAside()],
        annotations: annotations(),
      }),
    });
  };

  const siftDown = (): number => {
    let cursor = 0;
    while (true) {
      const left = 2 * cursor + 1;
      const right = 2 * cursor + 2;
      let best = cursor;
      if (left < heap.length && heap[left]!.value < heap[best]!.value) best = left;
      if (right < heap.length && heap[right]!.value < heap[best]!.value) best = right;
      if (best === cursor) return cursor;
      const parent = heap[cursor]!;
      heap[cursor] = heap[best]!;
      heap[best] = parent;
      cursor = best;
    }
  };

  // Build the heap of heads. The heads are put in one at a time and sifted
  // up, but no head can be out of order with more than its own parent, so
  // this is a setup step rather than a lesson and it gets one frame.
  for (const [list, values] of lists.entries()) {
    let index = heap.length;
    heap.push({ value: values[0]!, list });
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (heap[parent]!.value <= heap[index]!.value) break;
      const above = heap[parent]!;
      heap[parent] = heap[index]!;
      heap[index] = above;
      index = parent;
    }
  }

  push(
    "heads",
    "Each list puts its head into the heap",
    `Every list is already sorted, so the smallest value left anywhere has to be the front of one of them. That means a heap holding just the ${slots} heads is enough: the letter beside each node says which list that value came from. The root, ${heap[0]!.value} from list ${LIST_LETTERS[heap[0]!.list]}, is the smallest of the heads and therefore the first value of the merged answer.`,
    new Map<number, TraceMark>([[0, "active"]]),
    `${slots} lists  root = ${heap[0]!.value}`,
  );

  while (heap.length > 0 && frames.length < MAX_FRAMES) {
    const popped = heap[0]!;
    const letter = LIST_LETTERS[popped.list]!;
    out.push(popped.value);
    cursors[popped.list] = cursors[popped.list]! + 1;
    const next = lists[popped.list]![cursors[popped.list]!];

    let moved: number | null;
    let note: string;
    let caption: string;
    let narrationIntent: string;
    if (next !== undefined) {
      heap[0] = { value: next, list: popped.list };
      moved = siftDown();
      note = `${popped.value} out  ${next} from ${letter}`;
      caption = `${popped.value} leaves and ${letter} sends ${next} in`;
      narrationIntent = `${popped.value} comes off the root and joins the output. Only list ${letter} lost a value, so only list ${letter} refills: its next value ${next} takes cell 0 and sinks to cell ${moved}. The heap is still one value per live list, which is why it never grows with the total number of values.`;
    } else if (heap.length > 1) {
      const last = heap.pop()!;
      heap[0] = last;
      moved = siftDown();
      note = `${popped.value} out  ${letter} is done`;
      caption = `${popped.value} leaves and list ${letter} is empty`;
      narrationIntent = `${popped.value} joins the output, and list ${letter} has nothing left to send, so the heap simply gets smaller: the last entry moves into cell 0, sinks to cell ${moved}, and slot ${heap.length} is now unused. From here the merge runs on ${heap.length} lists.`;
    } else {
      heap.pop();
      moved = null;
      note = `${popped.value} out  heap is empty`;
      caption = `Merged: ${out.join(" ")}`;
      narrationIntent = `${popped.value} was the last value in the heap, so it goes out and every slot is now empty. The output row is the full merged list, in order, and each value passed through the heap exactly once, which is why this costs one small comparison chain per value instead of a fresh scan of every list.`;
    }

    const marks = new Map<number, TraceMark>();
    if (moved !== null) marks.set(moved, "active");
    if (heap.length > 0 && moved !== 0) marks.set(0, "candidate");
    push(`out${out.length}`, caption.slice(0, 60), narrationIntent, marks, note);
  }

  const merged = out.join(" ");
  const complete = out.length === total;
  const resultText = complete && merged.length <= 50 ? `merged: ${merged}` : `${out.length} values merged in order`;
  if (frames.length < 2 || frames.length > MAX_FRAMES) return null;
  // The closing caption has to state the answer, and a long merge would have
  // overflowed the 60-character cap; say the count instead of the values.
  if (!(complete && merged.length <= 50)) {
    const last = frames[frames.length - 1]!;
    frames[frames.length - 1] = { ...last, caption: `${out.length} values merged in order` };
  }
  return {
    algorithmId: "heap_k_way_merge",
    title: "Merge k sorted lists with a heap",
    input: { lists },
    result: out,
    resultText,
    frames,
  };
}
