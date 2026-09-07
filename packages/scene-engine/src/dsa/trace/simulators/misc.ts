/**
 * The algorithms whose board is a shape of its own.
 *
 * Everything in this file was left out of the earlier simulator modules for
 * the same reason: each one has a single idea that only becomes teachable
 * when it is drawn as ink rather than said in a sentence. Intervals need a
 * number line, because "these two overlap" is a claim about two spans on the
 * same axis and a row of boxes cannot make it. Quick sort needs a bracket,
 * because the partition boundary is the algorithm and a swap without it is
 * two numbers changing places for no visible reason. Insertion sort needs a
 * bracket for the opposite reason: the prefix is sorted but not settled, and
 * saying so is the difference between insertion sort and selection sort. XOR
 * needs the binary written out, or the cancellation is a magic trick. Bit
 * count needs the bits as cells, or `n & (n - 1)` is an incantation. A trie
 * needs the whole tree laid out from the first frame, or the shared prefix
 * looks like a coincidence of drawing. A spiral needs a path, or the
 * shrinking boundary is invisible.
 *
 * House rules that cost real debugging here:
 *
 * A declared `swap` is checked against the previous frame by recomputing it,
 * so a swap is only ever declared for an exchange of two distinct cells that
 * actually happened between those two frames. Lomuto's inner exchange is a
 * self swap whenever the boundary has kept up with the scan; those frames
 * declare no swap and say so in words, because crossing arcs from a cell to
 * itself would draw a move the array never made.
 *
 * Bars are on for both sorts and indices are therefore off. That is not a
 * style choice: the index row and the crossing swap arcs are drawn in the
 * same band under the row, so a frame with both has digits lying across the
 * arrows. Bars also make sortedness readable at a glance, which is the whole
 * claim a sorting walk-through is making.
 */
import {
  aside,
  cells,
  marked,
  type AlgorithmTrace,
  type NumberLineBar,
  type TraceAside,
  type TraceBracket,
  type TraceCell,
  type TraceEdge,
  type TraceFrame,
  type TraceMark,
  type TraceNode,
  type TreeAnnotation,
} from "../types";
import type { SortInput } from "./sorting";

/** Position words, so two passes over equal values never share a narration. */
const ORDINALS = [
  "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth",
  "ninth", "tenth", "eleventh", "twelfth",
];

function ordinal(index: number): string {
  return ORDINALS[index] ?? `number ${index + 1}`;
}

/**
 * A note chip the renderer will draw whole.
 *
 * `noteChunks` splits anything over 16 characters at its spaces and truncates
 * a long unbroken run, so an arithmetic chip that overflows comes out as two
 * half sentences. Anything that would overflow falls back to the shorter form
 * the caller supplies instead of being cut in the middle.
 */
const MAX_CHIP = 16;
function chip(text: string, fallback: string): string {
  return text.length <= MAX_CHIP ? text : fallback;
}

/**
 * Bars are a magnitude channel: a zero or a negative value has no honest
 * height, and the renderer refuses a column whose spread would draw the
 * smallest value as an invisible stub. Returning null means the frame draws
 * no bars rather than a lie about size.
 */
function barsFor(values: readonly number[]): number[] | null {
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  const largest = Math.max(...values);
  const smallest = Math.min(...values);
  return largest / smallest <= 20 ? [...values] : null;
}

// ---------------------------------------------------------------------------
// Merge intervals (LeetCode 56)
// ---------------------------------------------------------------------------

export interface MergeIntervalsInput {
  intervals: Array<[number, number]>;
}

/** A tick every 1, 2, 5, 10 ... so a span of any size gets four to six marks. */
function ticksFor(min: number, max: number): number[] {
  const span = max - min;
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 250, 500, 1000];
  const step = steps.find((candidate) => span / candidate <= 6) ?? 1000;
  const out: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max; value += step) out.push(value);
  return out;
}

const MAX_INTERVALS = 5;

/**
 * Sort by start, then sweep: a new interval either touches the run that is
 * open or it does not, and that single comparison is the whole algorithm.
 *
 * Lane 0 is the output lane, so the merged run grows directly above the axis
 * and every input stays where it was put. Drawing the output on top of the
 * inputs, or reusing an input's lane once it had been absorbed, made the
 * merged bar look like one of the inputs having moved rather than a new
 * interval being written out.
 */
export function simulateMergeIntervals(input: MergeIntervalsInput): AlgorithmTrace | null {
  const given = input.intervals;
  if (!Array.isArray(given) || given.length < 2 || given.length > MAX_INTERVALS) return null;
  for (const pair of given) {
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    if (!Number.isFinite(pair[0]) || !Number.isFinite(pair[1])) return null;
    if (pair[1] < pair[0]) return null;
  }

  // Sorting is step zero of the algorithm, so the board shows the sorted
  // order from the first frame and the caption says the sort happened. A
  // frame of the unsorted input followed by an identical frame of the sorted
  // input (which is what an already sorted example gives) teaches nothing.
  const sorted = [...given].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const count = sorted.length;
  const min = Math.min(...sorted.map((pair) => pair[0])) - 1;
  const max = Math.max(...sorted.map((pair) => pair[1])) + 1;
  if (!(max > min)) return null;
  const ticks = ticksFor(min, max);

  /** Input `i` sits on lane `count - i`, so reading down the lanes is reading the sorted order. */
  const laneOf = (index: number): number => count - index;
  const inputBar = (index: number, mark?: TraceMark): NumberLineBar => ({
    id: `in${index}`,
    from: sorted[index]![0],
    to: sorted[index]![1],
    lane: laneOf(index),
    label: `${sorted[index]![0]},${sorted[index]![1]}`,
    ...(mark ? { mark } : {}),
  });
  const outputBar = (index: number, run: readonly [number, number], mark?: TraceMark): NumberLineBar => ({
    id: `out${index}`,
    from: run[0],
    to: run[1],
    lane: 0,
    label: `${run[0]},${run[1]}`,
    ...(mark ? { mark } : {}),
  });

  const frames: TraceFrame[] = [];
  const emitted: Array<[number, number]> = [];
  const push = (
    id: string,
    caption: string,
    narrationIntent: string,
    bars: NumberLineBar[],
    note: string,
  ) => {
    frames.push({ id, caption, narrationIntent, state: { kind: "numberline", min, max, ticks, bars, note } });
  };

  const startsList = sorted.map((pair) => pair[0]).join(" ");
  push(
    "sorted",
    `Sorted by start: ${startsList}`.slice(0, 60),
    `Sorting by start is what makes one comparison enough. Once the intervals are in start order, ${startsList}, anything that can overlap the run we are holding has to be the very next one, so we never look backwards.`,
    sorted.map((_, index) => inputBar(index)),
    "sort by start",
  );

  let open: [number, number] = [sorted[0]![0], sorted[0]![1]];
  push(
    "open",
    `Open a run at [${open[0]},${open[1]}]`,
    `The first interval opens the run we are building. Nothing is written out yet: the run stays open because a later interval could still stretch its end.`,
    [...sorted.map((_, index) => inputBar(index, index === 0 ? "done" : undefined)), outputBar(0, open, "active")],
    chip(`run = ${open[0]} to ${open[1]}`, `run ends ${open[1]}`),
  );

  for (let index = 1; index < count; index += 1) {
    const [start, end] = sorted[index]!;
    const overlaps = start <= open[1];
    const settled = (upTo: number) => sorted.map((_, at) => inputBar(at, at <= upTo ? "done" : at === index ? "active" : undefined));

    push(
      `test${index}`,
      overlaps ? `${start} is not past ${open[1]}, so they overlap` : `${start} is past ${open[1]}, so the run closes`,
      `Compare the start of the ${ordinal(index)} interval, ${start}, with the end of the open run, ${open[1]}. ${
        overlaps
          ? `${start} is not past ${open[1]}, so the two spans touch and there is no gap between them.`
          : `${start} is past ${open[1]}, so there is clear air between them and nothing later can close it.`
      }`,
      [
        ...settled(index - 1),
        ...emitted.map((run, at) => outputBar(at, run, "done")),
        outputBar(emitted.length, open, "candidate"),
      ],
      overlaps ? chip(`${start} <= ${open[1]}`, "they overlap") : chip(`${start} > ${open[1]}`, "a gap opens"),
    );

    if (overlaps) {
      const grown: [number, number] = [open[0], Math.max(open[1], end)];
      push(
        `grow${index}`,
        `Run grows to [${grown[0]},${grown[1]}]`,
        `The run absorbs the ${ordinal(index)} interval. Its start does not move, because the sort guarantees ${open[0]} is the earliest start in the run; its end becomes the larger of ${open[1]} and ${end}, which is ${grown[1]}.`,
        [
          ...sorted.map((_, at) => inputBar(at, at <= index ? "done" : undefined)),
          ...emitted.map((run, at) => outputBar(at, run, "done")),
          outputBar(emitted.length, grown, "active"),
        ],
        chip(`end = max(${open[1]},${end})`, `end = ${grown[1]}`),
      );
      open = grown;
      continue;
    }

    emitted.push(open);
    open = [start, end];
    push(
      `emit${index}`,
      `Write out [${emitted[emitted.length - 1]![0]},${emitted[emitted.length - 1]![1]}] and open [${start},${end}]`.slice(0, 60),
      `The closed run is written to the answer and can never change again, and the ${ordinal(index)} interval opens a fresh run. This is why one pass is enough: each interval is looked at once and each run is written once.`,
      [
        ...sorted.map((_, at) => inputBar(at, at <= index ? "done" : undefined)),
        ...emitted.map((run, at) => outputBar(at, run, "done")),
        outputBar(emitted.length, open, "active"),
      ],
      chip(`run = ${open[0]} to ${open[1]}`, `run ends ${open[1]}`),
    );
  }

  emitted.push(open);
  const answer = emitted.map((run) => `[${run[0]},${run[1]}]`).join(" ");
  // A long answer would blow the 60 character caption budget, and the closing
  // caption has to be able to state the result, so a wide case falls back to
  // counting the runs and the result text counts them the same way.
  const fits = `Merged: ${answer}`.length <= 60;
  const resultText = fits ? answer : `${emitted.length} merged intervals`;
  push(
    "merged",
    fits ? `Merged: ${answer}` : `${emitted.length} merged intervals`,
    `Every input has been looked at once, so the sweep is over and the output lane holds the answer: ${answer}. The sort costs n log n and the sweep itself is linear, which is where the whole cost of this algorithm sits.`,
    [
      ...sorted.map((_, at) => inputBar(at, "done")),
      ...emitted.map((run, at) => outputBar(at, run, "done")),
    ],
    chip(`${emitted.length} runs written`, `${emitted.length} runs out`),
  );

  return {
    algorithmId: "merge_intervals",
    title: "Merge intervals",
    input: { intervals: given },
    result: emitted.map((run) => [run[0], run[1]]),
    resultText,
    frames,
  };
}

// ---------------------------------------------------------------------------
// Quick sort (textbook ask)
// ---------------------------------------------------------------------------

const MIN_SORT_LENGTH = 4;
const MAX_SORT_LENGTH = 6;

/**
 * Lomuto partition with the first value as the pivot.
 *
 * The pivot choice is the one that decides whether this walk teaches
 * anything. With the last value as the pivot, the canonical small examples in
 * the probe set ([5,3,8,4,2] and [8,3,7,1,9,2]) both end their scan with the
 * pivot landing at an end of the range, so the board shows a partition that
 * partitions nothing. Taking the first value scans the rest of the range
 * against it and lands the pivot in the middle, which is the picture the
 * lesson is about.
 *
 * The boundary is drawn as a bracket in every frame, never as a per-cell
 * mark. A region claim ("everything here is at most the pivot") is a claim
 * about a run, and marks on individual cells say the algorithm is looking at
 * them, which it is not.
 */
export function simulateQuickSort(input: SortInput): AlgorithmTrace | null {
  const original = [...input.values];
  if (original.length < MIN_SORT_LENGTH || original.length > MAX_SORT_LENGTH) return null;
  if (!original.every((value) => Number.isFinite(value))) return null;

  const values = [...original];
  const length = values.length;
  const lo = 0;
  const hi = length - 1;
  const pivot = values[lo]!;
  const frames: TraceFrame[] = [];

  const bars = () => barsFor(values);
  const push = (
    id: string,
    caption: string,
    narrationIntent: string,
    options: {
      marks?: Map<number, TraceMark>;
      pointers?: Array<{ name: string; index: number }>;
      swap?: { from: number; to: number };
      brackets: TraceBracket[];
      note: string;
    },
  ) => {
    const column = bars();
    frames.push({
      id,
      caption,
      narrationIntent,
      state: {
        kind: "array",
        cells: marked(cells(values), options.marks ?? new Map<number, TraceMark>()),
        ...(options.pointers ? { pointers: options.pointers } : {}),
        ...(column ? { bars: column } : {}),
        ...(options.swap ? { swap: options.swap } : {}),
        brackets: options.brackets,
        // Indices and the swap arcs share the band under the row, so a frame
        // that draws both has the digits lying across the arrows.
        showIndices: false,
        note: options.note,
      },
    });
  };

  /** The two claims the partition makes, as brackets: at most the pivot, and over it. */
  const regions = (boundary: number, scanned: number): TraceBracket[] => {
    const out: TraceBracket[] = [{ from: lo, to: boundary, label: `${pivot} or less` }];
    if (scanned > boundary) out.push({ from: boundary + 1, to: scanned, label: `over ${pivot}` });
    return out;
  };

  push(
    "pivot",
    `Pivot is ${pivot}, the first value`,
    `Quick sort picks one value as the pivot and puts every other value on the correct side of it. Here the pivot is ${pivot}, the first value in the range. Nothing is sorted yet: the goal of this pass is only to get ${pivot} to the place it belongs.`,
    {
      marks: new Map<number, TraceMark>([[lo, "candidate"]]),
      pointers: [{ name: "pivot", index: lo }],
      brackets: [{ from: lo, to: lo, label: "pivot" }],
      note: `pivot = ${pivot}`,
    },
  );

  let boundary = lo;
  for (let j = lo + 1; j <= hi; j += 1) {
    const value = values[j]!;
    const smaller = value < pivot;
    const marks = new Map<number, TraceMark>([[lo, "candidate"], [j, "active"]]);
    const pointers = [{ name: "pivot", index: lo }, { name: "j", index: j }];

    if (!smaller) {
      push(
        `keep${j}`,
        `Is ${value} < ${pivot}? No, it stays right`,
        `The ${ordinal(j)} value is ${value}, which is not smaller than the pivot ${pivot}, so it already belongs on the right hand side. The boundary does not move and nothing is exchanged.`,
        { marks, pointers, brackets: regions(boundary, j), note: chip(`${value} >= ${pivot}`, "not smaller") },
      );
      continue;
    }

    const target = boundary + 1;
    if (target === j) {
      // The boundary had kept up with the scan, so Lomuto's exchange is a
      // cell with itself. Declaring a swap here would draw crossing arcs for
      // a move that never happened, and the gate recomputes and rejects it.
      boundary = target;
      push(
        `slide${j}`,
        `${value} < ${pivot}, so the boundary moves`,
        `The ${ordinal(j)} value is ${value}, which is smaller than the pivot ${pivot}. It is already sitting just past the boundary, so nothing has to move: the boundary simply widens to take it in.`,
        { marks, pointers, brackets: regions(boundary, j), note: chip(`boundary = ${boundary}`, `line at ${boundary}`) },
      );
      continue;
    }

    push(
      `cmp${j}`,
      `Is ${value} < ${pivot}? Yes`,
      `The ${ordinal(j)} value is ${value}, which is smaller than the pivot ${pivot}, so it has to cross to the left of the boundary. The cell just past the boundary holds ${values[target]!}, which belongs on the right, so the two trade places.`,
      { marks, pointers, brackets: regions(boundary, j), note: chip(`boundary = ${boundary}`, `line at ${boundary}`) },
    );

    const displaced = values[target]!;
    values[target] = value;
    values[j] = displaced;
    boundary = target;
    push(
      `swp${j}`,
      `Swap ${displaced} and ${value} across the line`,
      `The arcs show the exchange: ${value} moves into the region of values at most ${pivot}, and ${displaced} moves out to the region above it. The boundary has grown by one, and every value it covers is still at most ${pivot}.`,
      {
        marks: new Map<number, TraceMark>([[lo, "candidate"], [boundary, "active"]]),
        swap: { from: target, to: j },
        brackets: regions(boundary, j),
        note: chip(`boundary = ${boundary}`, `line at ${boundary}`),
      },
    );
  }

  // The pivot has been sitting at the front the whole pass; the last move
  // drops it onto the boundary, which is the only cell whose left is all at
  // most the pivot and whose right is all above it.
  if (boundary === lo) {
    push(
      "place",
      `${pivot} is smallest, so it is already home`,
      `Nothing in the range was smaller than ${pivot}, so the boundary never moved and the pivot is already in its final place at the front. Every other value sits to its right, which is exactly where they belong.`,
      {
        marks: new Map<number, TraceMark>([[lo, "done"]]),
        brackets: [{ from: lo, to: lo, label: "final" }, { from: lo + 1, to: hi, label: `over ${pivot}` }],
        note: chip(`${pivot} is final`, "pivot is final"),
      },
    );
  } else {
    const displaced = values[boundary]!;
    values[lo] = displaced;
    values[boundary] = pivot;
    push(
      "place",
      `Pivot ${pivot} drops onto the boundary`,
      `The last move puts the pivot on the boundary itself, trading it with ${displaced}. Everything to the left of ${pivot} is at most ${pivot} and everything to the right is above it, so ${pivot} is in its final position and will never move again.`,
      {
        marks: new Map<number, TraceMark>([[boundary, "done"]]),
        swap: { from: lo, to: boundary },
        brackets: [
          ...(boundary > lo ? [{ from: lo, to: boundary - 1, label: `under ${pivot}` }] : []),
          ...(boundary < hi ? [{ from: boundary + 1, to: hi, label: `over ${pivot}` }] : []),
        ],
        note: chip(`${pivot} is final`, "pivot is final"),
      },
    );
  }

  const left = values.slice(lo, boundary);
  const right = values.slice(boundary + 1);
  push(
    "sides",
    `Sort [${left.join(" ")}] and [${right.join(" ")}] the same way`.slice(0, 60),
    `The pivot has cut the problem into two smaller ones that never interact: ${left.length === 0 ? "nothing" : left.join(" ")} on the left and ${right.length === 0 ? "nothing" : right.join(" ")} on the right. Quick sort now runs on each side by itself, and when both are sorted the whole array is sorted with no merging step at all.`,
    {
      marks: new Map<number, TraceMark>([[boundary, "done"]]),
      brackets: [
        ...(left.length > 0 ? [{ from: lo, to: boundary - 1, label: "left side" }] : []),
        ...(right.length > 0 ? [{ from: boundary + 1, to: hi, label: "right side" }] : []),
      ],
      note: "recurse both",
    },
  );

  const answer = [...original].sort((a, b) => a - b);
  for (let index = 0; index < length; index += 1) values[index] = answer[index]!;
  push(
    "sorted",
    `Sorted: ${answer.join(" ")}`.slice(0, 60),
    `Each side is partitioned the same way until every range holds one value, and because every value ends up on the correct side of some pivot the array comes out sorted without anything being merged back together.`,
    {
      marks: new Map<number, TraceMark>(answer.map((_, index) => [index, "done" as TraceMark])),
      brackets: [{ from: lo, to: hi, label: "sorted" }],
      note: "all pivots final",
    },
  );

  if (frames.length < 2 || frames.length > 16) return null;
  return {
    algorithmId: "quick_sort",
    title: "Quick sort",
    input: { values: original },
    result: answer,
    resultText: answer.join(" "),
    frames,
  };
}

// ---------------------------------------------------------------------------
// Insertion sort (textbook ask)
// ---------------------------------------------------------------------------

/**
 * The sorted prefix, drawn as a bracket and never as a tick.
 *
 * A `done` mark on the prefix would be the obvious rendering and it would be
 * a lie: insertion sort's prefix is sorted but not settled, because a later
 * key is inserted into the middle of it and pushes those cells right. Bubble
 * sort's tail really is settled, so it earns the tick; this one earns a
 * bracket that says "sorted so far" and nothing stronger.
 *
 * A key that moves exactly one place left is an exchange of two neighbouring
 * cells, so that frame declares a real `swap` and gets the crossing arcs. A
 * key that travels further is a rotation, not a swap, and declaring one would
 * fail the gate's recomputation.
 */
export function simulateInsertionSort(input: SortInput): AlgorithmTrace | null {
  const original = [...input.values];
  if (original.length < MIN_SORT_LENGTH || original.length > MAX_SORT_LENGTH) return null;
  if (!original.every((value) => Number.isFinite(value))) return null;

  const values = [...original];
  const length = values.length;
  const frames: TraceFrame[] = [];

  const push = (
    id: string,
    caption: string,
    narrationIntent: string,
    options: {
      marks?: Map<number, TraceMark>;
      pointers?: Array<{ name: string; index: number }>;
      swap?: { from: number; to: number };
      bracket: TraceBracket;
      note: string;
    },
  ) => {
    const column = barsFor(values);
    frames.push({
      id,
      caption,
      narrationIntent,
      state: {
        kind: "array",
        cells: marked(cells(values), options.marks ?? new Map<number, TraceMark>()),
        ...(options.pointers ? { pointers: options.pointers } : {}),
        ...(column ? { bars: column } : {}),
        ...(options.swap ? { swap: options.swap } : {}),
        brackets: [options.bracket],
        showIndices: false,
        note: options.note,
      },
    });
  };

  push(
    "input",
    `One value on its own is already sorted`,
    `Insertion sort grows a sorted region from the left. It starts with the first value alone, which is sorted for free, and then takes the next value and walks it back into the region until it is in the right place.`,
    {
      marks: new Map<number, TraceMark>(),
      bracket: { from: 0, to: 0, label: "sorted so far" },
      note: chip(`sorted = ${values[0]}`, "one value sorted"),
    },
  );

  for (let i = 1; i < length; i += 1) {
    const key = values[i]!;
    push(
      `key${i}`,
      `Take ${key}, the ${ordinal(i)} value`,
      `The sorted region covers the first ${i} value${i === 1 ? "" : "s"}. Lift the ${ordinal(i)} value, ${key}, out of the row and compare it with the sorted values to its left, working from the right hand end of them.`,
      {
        marks: new Map<number, TraceMark>([[i, "active"]]),
        pointers: [{ name: "key", index: i }],
        bracket: { from: 0, to: i - 1, label: "sorted so far" },
        note: chip(`key = ${key}`, "key lifted out"),
      },
    );

    let at = i;
    while (at > 0 && values[at - 1]! > key) {
      values[at] = values[at - 1]!;
      at -= 1;
    }
    values[at] = key;
    const shifted = i - at;

    push(
      `put${i}`,
      shifted === 0
        ? `${key} is already past ${values[i - 1]}, so it stays`
        : `${key} settles ${shifted} place${shifted === 1 ? "" : "s"} left`,
      shifted === 0
        ? `The value to the left of ${key} is ${values[i - 1]!}, which is not larger, so ${key} is already in the right place and the sorted region simply widens by one. This is the case that makes insertion sort fast on nearly sorted data.`
        : `${shifted} value${shifted === 1 ? "" : "s"} larger than ${key} slid one place right to open a gap, and ${key} dropped into it. The region on the left is sorted again, one value wider, and no value outside it was touched.`,
      {
        marks: new Map<number, TraceMark>([[at, "active"]]),
        // One place left is exactly an exchange of two neighbours; anything
        // further is a rotation and must not claim to be a swap.
        ...(shifted === 1 ? { swap: { from: at, to: at + 1 } } : {}),
        ...(shifted === 1 ? {} : { pointers: [{ name: "key", index: at }] }),
        bracket: { from: 0, to: i, label: "sorted so far" },
        note: shifted === 0 ? "nothing moved" : chip(`${shifted} shifted right`, `${shifted} slid right`),
      },
    );
  }

  const answer = [...original].sort((a, b) => a - b);
  push(
    "sorted",
    `Sorted: ${answer.join(" ")}`.slice(0, 60),
    `The sorted region has reached the end of the row, so the whole array is in order. Every value was compared only with the ones already sorted, which is why an array that is nearly in order costs almost nothing.`,
    {
      marks: new Map<number, TraceMark>(answer.map((_, index) => [index, "done" as TraceMark])),
      bracket: { from: 0, to: length - 1, label: "sorted" },
      note: "all sorted now",
    },
  );

  if (frames.length < 2 || frames.length > 16) return null;
  return {
    algorithmId: "insertion_sort",
    title: "Insertion sort",
    input: { values: original },
    result: answer,
    resultText: answer.join(" "),
    frames,
  };
}

// ---------------------------------------------------------------------------
// Single number by XOR (LeetCode 136)
// ---------------------------------------------------------------------------

export interface XorFoldInput {
  values: number[];
}

function binary(value: number, width: number): string {
  return value.toString(2).padStart(width, "0");
}

/**
 * The cancelling pairs are the lesson, so they are struck out on the board.
 *
 * A naive rendering walks the array with a running total in an aside and
 * leaves the student to take on faith that the duplicates disappeared. The
 * binary in the note is what makes it checkable: on the frame where the
 * second copy of a value is folded in, both copies are struck through and the
 * note shows the two bit patterns that cancelled to zero in those columns.
 */
export function simulateXorFold(input: XorFoldInput): AlgorithmTrace | null {
  const values = [...input.values];
  if (values.length < 3 || values.length > 9) return null;
  // A wider value makes the "a xor b = c" chip overflow the 16 character
  // note budget and the renderer splits it into two half sentences.
  if (!values.every((value) => Number.isInteger(value) && value >= 0 && value <= 99)) return null;

  // The claim the walk makes is that everything pairs off except one value.
  // On input that does not have that shape the last frame would announce a
  // number that is not an answer to anything.
  const seen = new Map<number, number>();
  for (const value of values) seen.set(value, (seen.get(value) ?? 0) + 1);
  const singles = [...seen.entries()].filter(([, times]) => times === 1);
  if (singles.length !== 1) return null;
  if ([...seen.values()].some((times) => times !== 1 && times !== 2)) return null;

  const width = Math.max(4, Math.max(...values, 1).toString(2).length);
  const frames: TraceFrame[] = [];
  const running: number[] = [];
  const paired = new Set<number>();
  const firstAt = new Map<number, number>();

  const runningAside = (marks: ReadonlyMap<number, TraceMark> = new Map()): TraceAside[] => [
    aside("x", "running x", "row", running, values.length, marks),
  ];

  frames.push({
    id: "start",
    caption: "Start the running value at 0",
    narrationIntent: `XOR has two properties that do all the work here: a value XOR itself is 0, and XOR does not care what order things come in. So folding the whole array together with XOR makes every value that appears twice cancel itself out, whatever order it appears in.`,
    state: {
      kind: "array",
      cells: cells(values),
      showIndices: true,
      note: `x = 0  ${binary(0, width)}`,
      asides: runningAside(),
    },
  });

  let x = 0;
  for (const [index, value] of values.entries()) {
    const previous = x;
    x ^= value;
    running.push(x);
    const marks = new Map<number, TraceMark>();
    const partner = firstAt.get(value);
    if (partner === undefined) firstAt.set(value, index);
    else {
      paired.add(partner);
      paired.add(index);
    }
    for (const at of paired) marks.set(at, "excluded");
    marks.set(index, "active");

    frames.push({
      id: `fold${index}`,
      caption: partner === undefined
        ? `x = ${previous} xor ${value} = ${x}`
        : `The ${ordinal(index)} value cancels the ${ordinal(partner)}`,
      narrationIntent: partner === undefined
        ? `Fold the ${ordinal(index)} value, ${value}, into the running value. ${previous} XOR ${value} is ${x}: in binary, a column ends up 1 exactly when the two patterns disagree there.`
        : `This is the second ${value} in the array. The first one is already inside the running value, so folding this one in cancels it: every bit ${value} set is set again and turns back to 0. The running value drops from ${previous} to ${x}, and both copies are struck out.`,
      state: {
        kind: "array",
        cells: marked(cells(values), marks),
        showIndices: true,
        note: `${previous} xor ${value} = ${x}  ${binary(x, width)}`,
        asides: runningAside(new Map([[running.length - 1, "active" as TraceMark]])),
      },
    });
  }

  const single = singles[0]![0];
  const finalMarks = new Map<number, TraceMark>();
  for (const at of paired) finalMarks.set(at, "excluded");
  finalMarks.set(values.indexOf(single), "done");
  frames.push({
    id: "answer",
    caption: `${single} appears once, the rest cancel out`,
    narrationIntent: `Every value that appeared twice has cancelled itself, so the only bits left standing are the ones belonging to ${single}. That is the answer, and it took one pass and a single integer of extra memory.`,
    state: {
      kind: "array",
      cells: marked(cells(values), finalMarks),
      showIndices: true,
      note: `x = ${single}  ${binary(single, width)}`,
      asides: runningAside(new Map([[running.length - 1, "done" as TraceMark]])),
    },
  });

  if (frames.length < 2 || frames.length > 16) return null;
  return {
    algorithmId: "xor_fold",
    title: "Single number by XOR",
    input: { values: [...input.values] },
    result: single,
    resultText: `${single} appears once`,
    frames,
  };
}

// ---------------------------------------------------------------------------
// Number of 1 bits (LeetCode 191)
// ---------------------------------------------------------------------------

export interface BitCountInput {
  n: number;
}

/**
 * The cells are the bits, so `n & (n - 1)` becomes something you can watch.
 *
 * Drawing the number as a single value and counting in the caption teaches
 * nothing: the trick is a statement about one column of the binary, and the
 * column has to exist on the board for the statement to be checkable. `n - 1`
 * is drawn as an aside directly under the bits, so the borrow that flips the
 * lowest 1 to 0 and fills every column below it with 1s is visible, and the
 * AND then obviously clears exactly one bit.
 */
export function simulateBitCount(input: BitCountInput): AlgorithmTrace | null {
  const n = input.n;
  if (!Number.isInteger(n) || n < 1) return null;
  const width = Math.max(4, n.toString(2).length);
  // A 31 bit row would be 31 cells wide and unreadable at board size, so the
  // walk declines rather than drawing a strip nobody can follow.
  if (width > 8) return null;

  const bitCells = (value: number, marks: ReadonlyMap<number, TraceMark>): TraceCell[] =>
    marked(cells([...binary(value, width)]), marks);
  /** Column index of the lowest set bit, in a row written most significant first. */
  const lowestSetColumn = (value: number): number => {
    const bits = binary(value, width);
    return bits.lastIndexOf("1");
  };
  const minusOne = (value: number): TraceAside[] => [
    aside("prev", "n minus 1", "row", value >= 1 ? [...binary(value - 1, width)] : [], width),
  ];

  const frames: TraceFrame[] = [];
  const cleared = new Set<number>();
  let value = n;

  frames.push({
    id: "binary",
    caption: `${n} in binary is ${binary(n, width)}`,
    narrationIntent: `Each cell is one bit of ${n}, written most significant first, so the row reads ${binary(n, width)}. The job is to count the 1s, and the fast way does not look at the 0s at all.`,
    state: {
      kind: "array",
      cells: bitCells(n, new Map()),
      showIndices: false,
      note: `n = ${n}  count = 0`,
      asides: minusOne(n),
    },
  });

  frames.push({
    id: "lowest",
    caption: "Subtracting 1 flips the lowest 1 and all below",
    narrationIntent: `Look at the lowest 1 in the row and at ${n} minus 1 underneath it. Subtracting 1 borrows: that lowest 1 becomes 0, every 0 to the right of it becomes 1, and everything to its left is untouched. So ANDing the two rows keeps the left part and wipes out everything from the lowest 1 rightwards.`,
    state: {
      kind: "array",
      cells: bitCells(n, new Map([[lowestSetColumn(n), "active" as TraceMark]])),
      showIndices: false,
      note: `n = ${n}  n minus 1 = ${n - 1}`,
      asides: minusOne(n),
    },
  });

  let count = 0;
  while (value > 0 && frames.length < 15) {
    const column = lowestSetColumn(value);
    const next = value & (value - 1);
    count += 1;
    cleared.add(column);
    const marks = new Map<number, TraceMark>();
    for (const at of cleared) marks.set(at, "excluded");
    if (next > 0) marks.set(lowestSetColumn(next), "active");
    value = next;
    frames.push({
      id: `clear${count}`,
      caption: next > 0
        ? `One 1 cleared, ${count} so far, n is now ${value}`
        : `${n} has ${count} set bit${count === 1 ? "" : "s"}`,
      narrationIntent: next > 0
        ? `The AND clears exactly one bit, the lowest 1, and leaves every other bit alone. That is one 1 counted, ${count} so far, and n has dropped to ${value}. Notice the loop runs once per set bit, not once per bit.`
        : `The last set bit is cleared and n is 0, so the loop ends. It went round ${count} time${count === 1 ? "" : "s"}, once for each 1 in ${n}, which is the whole point of the trick: an 8 bit number with one 1 costs one step, not eight.`,
      state: {
        kind: "array",
        cells: bitCells(value, marks),
        showIndices: false,
        note: `count = ${count}  n = ${value}`,
        asides: minusOne(value),
      },
    });
  }

  if (value !== 0) return null;
  if (frames.length < 2 || frames.length > 16) return null;
  return {
    algorithmId: "bit_count",
    title: "Count set bits",
    input: { n },
    result: count,
    resultText: `${count} set bit${count === 1 ? "" : "s"}`,
    frames,
  };
}

// ---------------------------------------------------------------------------
// Trie insert and search (LeetCode 208)
// ---------------------------------------------------------------------------

export interface TrieInput {
  words: string[];
  search: string;
}

interface TrieShape {
  ids: string[];
  label: Map<string, string>;
  edges: TraceEdge[];
  /** Node id for each prefix, so a walk can address a node by the letters read. */
  idOf: Map<string, string>;
  ends: Set<string>;
  /** Node ids the given word created, in order. */
  createdBy: Map<string, string[]>;
  /** Node ids the given word reused, in order. */
  reusedBy: Map<string, string[]>;
}

const MAX_TRIE_NODES = 12;
const MAX_TRIE_DEPTH = 4;

function buildTrie(words: readonly string[]): TrieShape | null {
  const shape: TrieShape = {
    ids: ["root"],
    label: new Map([["root", ""]]),
    edges: [],
    idOf: new Map([["", "root"]]),
    ends: new Set(),
    createdBy: new Map(),
    reusedBy: new Map(),
  };
  for (const word of words) {
    const created: string[] = [];
    const reused: string[] = [];
    let prefix = "";
    for (const letter of word) {
      const parent = shape.idOf.get(prefix)!;
      prefix += letter;
      const existing = shape.idOf.get(prefix);
      if (existing) {
        reused.push(existing);
        continue;
      }
      const id = `n_${prefix}`;
      shape.idOf.set(prefix, id);
      shape.ids.push(id);
      shape.label.set(id, letter);
      shape.edges.push({ from: parent, to: id });
      created.push(id);
    }
    shape.ends.add(shape.idOf.get(word)!);
    shape.createdBy.set(word, created);
    shape.reusedBy.set(word, reused);
  }
  return shape.ids.length <= MAX_TRIE_NODES ? shape : null;
}

/**
 * Insert a few words, then search one, on a trie whose layout never moves.
 *
 * `layoutNodes` is pinned to the finished trie in every frame, including the
 * frame that draws only the root. Without it each frame is laid out on its
 * own, so inserting the second word slides the first word's nodes sideways
 * and the shared prefix looks like a drawing coincidence rather than the one
 * fact the data structure exists for.
 *
 * The root is drawn without a label. A word in a node of this radius spills
 * its own circle, and a spilling value fails the whole trace closed, so the
 * root is a bare ring and the caption says what it is.
 */
export function simulateTrieInsertSearch(input: TrieInput): AlgorithmTrace | null {
  const words = input.words.map((word) => word.toLowerCase());
  const search = input.search.toLowerCase();
  if (words.length < 2 || words.length > 4) return null;
  // A word longer than this draws a chain deeper than the board can read, so
  // the walk declines the question's own example and the caller falls back to
  // the canonical branching one rather than drawing an unreadable ladder.
  const wordOk = (word: string) => /^[a-z]+$/.test(word) && word.length >= 2 && word.length <= MAX_TRIE_DEPTH;
  if (!words.every(wordOk)) return null;
  if (!/^[a-z]+$/.test(search) || search.length < 2 || search.length > MAX_TRIE_DEPTH) return null;
  if (new Set(words).size !== words.length) return null;

  const shape = buildTrie(words);
  if (!shape) return null;

  const layoutNodes: TraceNode[] = shape.ids.map((id) => ({ id, label: shape.label.get(id)! }));
  const layoutEdges = shape.edges;
  const wordWidth = Math.max(...words.map((word) => word.length), search.length);

  /** active beats done beats candidate: a word end is a fact about the trie and must not blink. */
  const nodesFor = (
    drawn: readonly string[],
    active: ReadonlySet<string>,
    candidate: ReadonlySet<string>,
  ): TraceNode[] =>
    drawn.map((id) => ({
      id,
      label: shape.label.get(id)!,
      ...(active.has(id)
        ? { mark: "active" as TraceMark }
        : shape.ends.has(id)
          ? { mark: "done" as TraceMark }
          : candidate.has(id)
            ? { mark: "candidate" as TraceMark }
            : {}),
    }));

  const endMarks = (drawn: readonly string[]): TreeAnnotation[] =>
    drawn.filter((id) => shape.ends.has(id)).map((id) => ({ nodeId: id, text: "$" }));

  const letterAside = (word: string, active: number, settled: number): TraceAside[] => {
    const marks = new Map<number, TraceMark>();
    for (let at = 0; at < settled; at += 1) marks.set(at, "candidate");
    if (active >= 0) marks.set(active, "active");
    return [aside("word", "word", "row", [...word], wordWidth, marks)];
  };

  const frames: TraceFrame[] = [];
  frames.push({
    id: "empty",
    caption: "An empty trie is a single root node",
    narrationIntent: `A trie stores words as paths, not as strings. Every edge carries one letter, and the word you get by reading the letters from the root down to a node is the prefix that node stands for. It starts as one empty root.`,
    state: {
      kind: "tree",
      nodes: [{ id: "root", label: "" }],
      edges: [],
      layoutNodes,
      layoutEdges,
      note: "no words yet",
      asides: [aside("word", "word", "row", [], wordWidth)],
    },
  });

  const drawn: string[] = ["root"];
  for (const [index, word] of words.entries()) {
    const created = shape.createdBy.get(word)!;
    const reused = shape.reusedBy.get(word)!;
    for (const id of created) drawn.push(id);
    const order = shape.ids.filter((id) => drawn.includes(id));
    frames.push({
      id: `insert${index}`,
      caption: reused.length === 0
        ? `Insert ${word}: ${created.length} new node${created.length === 1 ? "" : "s"}`
        : `Insert ${word}: it reuses ${word.slice(0, reused.length)}`,
      narrationIntent: reused.length === 0
        ? `Insert the ${ordinal(index)} word, ${word}. Nothing in the trie starts with ${word[0]}, so the walk falls off the tree straight away and ${created.length} new node${created.length === 1 ? " is" : "s are"} hung under the root. The last one is marked as the end of a word.`
        : `Insert ${word}. The walk follows the existing path for ${word.slice(0, reused.length)}, because that prefix is already stored, and only then adds ${created.length} new node${created.length === 1 ? "" : "s"}. That reuse is the whole reason a trie is compact: a shared prefix is stored once, however many words carry it.`,
      state: {
        kind: "tree",
        nodes: nodesFor(order, new Set(created), new Set(reused)),
        edges: layoutEdges.filter((edge) => drawn.includes(edge.from) && drawn.includes(edge.to)),
        layoutNodes,
        layoutEdges,
        annotations: endMarks(order),
        note: `${index + 1} word${index === 0 ? "" : "s"} stored`,
        asides: letterAside(word, word.length - 1, reused.length),
      },
    });
  }

  const allNodes = shape.ids;
  let walked: string[] = [];
  let missing = false;
  for (let at = 0; at < search.length; at += 1) {
    const prefix = search.slice(0, at + 1);
    const id = shape.idOf.get(prefix);
    if (!id) {
      missing = true;
      frames.push({
        id: `miss${at}`,
        caption: `No ${search[at]} edge here, so ${search} is absent`,
        narrationIntent: `The walk needs an edge labelled ${search[at]} out of the node for ${search.slice(0, at)}, and there is none. The search stops here and returns false, after reading only ${at + 1} letter${at === 0 ? "" : "s"} however many words the trie holds.`,
        state: {
          kind: "tree",
          nodes: nodesFor(allNodes, new Set(), new Set(walked)),
          edges: layoutEdges,
          layoutNodes,
          layoutEdges,
          annotations: endMarks(allNodes),
          note: chip(`${search} not found`, "no such word"),
          asides: letterAside(search, at, at),
        },
      });
      break;
    }
    walked = [...walked, id];
    const isLast = at === search.length - 1;
    frames.push({
      id: `step${at}`,
      caption: isLast
        ? shape.ends.has(id)
          ? `${search} is in the trie`
          : `${search} is only a prefix here, not a word`
        : `Follow ${search[at]} to the node for ${prefix}`,
      narrationIntent: isLast
        ? shape.ends.has(id)
          ? `The last letter lands on a node that is marked as the end of a word, so ${search} really was inserted and the search returns true. It took ${search.length} steps, one per letter, and the size of the trie never entered into it.`
          : `The last letter lands on a real node, so ${search} is a prefix of something stored, but the node carries no end marker, so no one ever inserted ${search} itself. Search returns false here while startsWith would return true, and that end marker is the only thing separating the two.`
        : `Follow the edge labelled ${search[at]}. The walk is now at the node for ${prefix}, and everything the trie knows that begins with ${prefix} hangs below this node.`,
      state: {
        kind: "tree",
        nodes: nodesFor(allNodes, new Set([id]), new Set(walked.slice(0, -1))),
        edges: layoutEdges,
        layoutNodes,
        layoutEdges,
        annotations: endMarks(allNodes),
        note: isLast ? (shape.ends.has(id) ? "end marker found" : "no end marker") : `at ${prefix}`,
        asides: letterAside(search, at, at),
      },
    });
  }

  const found = !missing && shape.ends.has(shape.idOf.get(search) ?? "");
  if (frames.length < 2 || frames.length > 16) return null;
  return {
    algorithmId: "trie_insert_search",
    title: "Trie insert and search",
    input: { words, search },
    result: { words, search, found },
    resultText: found ? `${search} is in the trie` : `${search} is not a stored word`,
    frames,
  };
}

// ---------------------------------------------------------------------------
// Spiral matrix (LeetCode 54)
// ---------------------------------------------------------------------------

export interface SpiralInput {
  rows: Array<Array<string | number>>;
}

interface SpiralSide {
  id: string;
  name: string;
  steps: Array<[number, number]>;
  /** The boundary after this side has been walked. */
  top: number;
  bottom: number;
  left: number;
  right: number;
  moved: string;
}

const MAX_SPIRAL_CELLS = 12;

/**
 * One frame per side of the spiral, with the path growing and the boundary
 * shrinking.
 *
 * The temptation is one frame per cell, which is 9 frames of a dot moving and
 * no visible reason for any turn. The turns are the algorithm: each side ends
 * because a boundary moved, so a side is the unit of a frame and the note
 * carries the boundary that just changed. Cells outside the live boundary are
 * marked done, which is what makes the rectangle visibly shrink.
 */
export function simulateSpiralLayers(input: SpiralInput): AlgorithmTrace | null {
  const grid = input.rows.map((row) => row.map((value) => String(value)));
  const rows = grid.length;
  const columns = grid[0]?.length ?? 0;
  if (rows < 2 || columns < 2 || rows > 4 || columns > 4) return null;
  if (grid.some((row) => row.length !== columns)) return null;
  if (rows * columns > MAX_SPIRAL_CELLS) return null;
  if (grid.some((row) => row.some((text) => text.length === 0 || text.length > 3))) return null;

  let top = 0;
  let bottom = rows - 1;
  let left = 0;
  let right = columns - 1;
  const sides: SpiralSide[] = [];
  let serial = 0;
  while (top <= bottom && left <= right) {
    const across: Array<[number, number]> = [];
    // A one cell remainder is not a "top row" in any sense a student would
    // accept, and calling it one is the sort of caption that makes a board
    // read as generated rather than drawn.
    const single = top === bottom && left === right;
    for (let column = left; column <= right; column += 1) across.push([top, column]);
    top += 1;
    serial += 1;
    sides.push({
      id: `top${serial}`,
      name: single ? "last cell" : "top row",
      steps: across,
      top,
      bottom,
      left,
      right,
      moved: `top = ${top}`,
    });

    if (left <= right && top <= bottom) {
      const down: Array<[number, number]> = [];
      for (let row = top; row <= bottom; row += 1) down.push([row, right]);
      right -= 1;
      serial += 1;
      sides.push({ id: `right${serial}`, name: "right column", steps: down, top, bottom, left, right, moved: `right = ${right}` });
    }
    if (top <= bottom && left <= right) {
      const back: Array<[number, number]> = [];
      for (let column = right; column >= left; column -= 1) back.push([bottom, column]);
      bottom -= 1;
      serial += 1;
      sides.push({ id: `bottom${serial}`, name: "bottom row", steps: back, top, bottom, left, right, moved: `bottom = ${bottom}` });
    }
    if (left <= right && top <= bottom) {
      const up: Array<[number, number]> = [];
      for (let row = bottom; row >= top; row -= 1) up.push([row, left]);
      left += 1;
      serial += 1;
      sides.push({ id: `left${serial}`, name: "left column", steps: up, top, bottom, left, right, moved: `left = ${left}` });
    }
  }
  const walkable = sides.filter((side) => side.steps.length > 0);
  if (walkable.length === 0 || walkable.length > 12) return null;

  const order: Array<[number, number]> = walkable.flatMap((side) => side.steps);
  const answer = order.map(([row, column]) => grid[row]![column]!);
  const answerText = answer.join(" ");
  if (answerText.length > 48) return null;

  const frames: TraceFrame[] = [];
  const cellsAt = (
    visited: ReadonlySet<string>,
    active: ReadonlySet<string>,
    box: { top: number; bottom: number; left: number; right: number },
  ): TraceCell[][] =>
    grid.map((row, r) =>
      row.map((text, c) => {
        const key = `${r},${c}`;
        if (active.has(key)) return { text, mark: "active" as TraceMark };
        // Outside the live rectangle means peeled off and never revisited,
        // which is exactly what the shrinking boundary claims.
        if (visited.has(key) && (r < box.top || r > box.bottom || c < box.left || c > box.right)) {
          return { text, mark: "done" as TraceMark };
        }
        return { text };
      }),
    );

  frames.push({
    id: "input",
    caption: `A ${rows} by ${columns} matrix read in a spiral`,
    narrationIntent: `Spiral order is not a formula, it is four boundaries that close in on each other: a top row, a right column, a bottom row and a left column. Each time one side is read, that boundary steps inwards by one, and the walk stops when the boundaries cross.`,
    state: {
      kind: "matrix",
      cells: cellsAt(new Set(), new Set(), { top: 0, bottom: rows - 1, left: 0, right: columns - 1 }),
      showIndices: true,
      note: `top 0 bottom ${rows - 1}  left 0 right ${columns - 1}`,
    },
  });

  const visited = new Set<string>();
  const path: Array<[number, number]> = [];
  for (const [index, side] of walkable.entries()) {
    const active = new Set(side.steps.map(([row, column]) => `${row},${column}`));
    for (const key of active) visited.add(key);
    path.push(...side.steps);
    const read = side.steps.map(([row, column]) => grid[row]![column]!).join(" ");
    const box = { top: side.top, bottom: side.bottom, left: side.left, right: side.right };
    const closed = box.top > box.bottom || box.left > box.right;
    frames.push({
      id: side.id,
      caption: `Read the ${side.name}: ${read}`.slice(0, 60),
      narrationIntent: `Read the ${side.name} of what is left, which gives ${read}. That side is finished, so its boundary steps in: ${side.moved}. ${
        closed
          ? `The boundaries have now crossed, so there is nothing left inside and the walk is over.`
          : `The live rectangle is smaller, and the next side is read from inside it.`
      }`,
      state: {
        kind: "matrix",
        cells: cellsAt(visited, active, box),
        showIndices: true,
        path: [...path],
        note: closed ? "boundaries meet" : side.moved,
      },
    });
  }

  frames.push({
    id: "spiral",
    caption: `Spiral: ${answerText}`.slice(0, 60),
    narrationIntent: `Every cell has been read exactly once, in the order ${answerText}. The arrows trace the whole route, and the cost is one visit per cell with four integers of bookkeeping, no extra grid of flags.`,
    state: {
      kind: "matrix",
      cells: grid.map((row) => row.map((text) => ({ text, mark: "done" as TraceMark }))),
      showIndices: true,
      path: [...order],
      note: `${answer.length} cells read`,
    },
  });

  if (frames.length < 2 || frames.length > 16) return null;
  return {
    algorithmId: "spiral_layers",
    title: "Spiral matrix",
    input: { rows: input.rows },
    result: answer,
    resultText: answerText,
    frames,
  };
}
