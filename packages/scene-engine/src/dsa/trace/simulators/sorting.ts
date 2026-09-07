/**
 * Divide-and-conquer and in-place sorts.
 *
 * Merge sort follows the real recursion tree. Splitting the whole row into
 * fixed-width blocks looked similar and was not the algorithm: on six values
 * it merged the pair straddling the halves and produced runs top-down merge
 * sort never holds, while the narration said "cut in half again". The blocks
 * a frame draws are now the segments the recursive calls actually own, and
 * the last merge is walked front against front, which is the step the whole
 * n log n argument rests on.
 */
import {
  aside,
  cells,
  marked,
  type AlgorithmTrace,
  type TraceCell,
  type TraceFrame,
  type TraceGroup,
  type TraceMark,
} from "../types";

export interface SortInput {
  values: number[];
}

interface Segment {
  start: number;
  end: number;
}

/** The segments top-down merge sort owns at one depth of its recursion. */
function segmentsAtDepth(length: number, depth: number): Segment[] {
  let segments: Segment[] = [{ start: 0, end: length }];
  for (let level = 0; level < depth; level += 1) {
    const next: Segment[] = [];
    for (const segment of segments) {
      const size = segment.end - segment.start;
      if (size <= 1) {
        next.push(segment);
        continue;
      }
      const mid = segment.start + Math.floor(size / 2);
      next.push({ start: segment.start, end: mid }, { start: mid, end: segment.end });
    }
    segments = next;
  }
  return segments;
}

function depthOf(length: number): number {
  let depth = 0;
  while (segmentsAtDepth(length, depth).some((segment) => segment.end - segment.start > 1)) depth += 1;
  return depth;
}

function groupsFrom(values: readonly number[], segments: readonly Segment[], mark?: TraceMark): TraceGroup[] {
  return segments.map((segment, index) => ({
    id: `g${index}`,
    cells: values.slice(segment.start, segment.end).map((value): TraceCell => (mark ? { text: String(value), mark } : { text: String(value) })),
  }));
}

function mergeRuns(left: readonly number[], right: readonly number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i]! <= right[j]!) out.push(left[i++]!);
    else out.push(right[j++]!);
  }
  while (i < left.length) out.push(left[i++]!);
  while (j < right.length) out.push(right[j++]!);
  return out;
}

/** The array as it stands when every segment at `depth` has been sorted. */
function sortedAtDepth(values: readonly number[], depth: number): number[] {
  const out = [...values];
  for (const segment of segmentsAtDepth(values.length, depth)) {
    const part = out.slice(segment.start, segment.end).sort((a, b) => a - b);
    for (let index = 0; index < part.length; index += 1) out[segment.start + index] = part[index]!;
  }
  return out;
}

const MAX_MERGE_FRAMES = 12;

export function simulateMergeSort(input: SortInput): AlgorithmTrace | null {
  const values = input.values;
  if (values.length < 4 || values.length > 10) return null;

  const frames: TraceFrame[] = [];
  const maxDepth = depthOf(values.length);

  frames.push({
    id: "input",
    caption: `Unsorted input of ${values.length}`,
    narrationIntent: `This is the array we have to sort. Merge sort never compares the whole thing at once: it splits the range in half, sorts each half the same way, and then merges two sorted halves, which is the cheap part.`,
    state: { kind: "array", cells: cells(values), showIndices: true },
  });

  // Break down: one frame per level of the real recursion.
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const segments = segmentsAtDepth(values.length, depth);
    const sizes = segments.map((segment) => segment.end - segment.start);
    frames.push({
      id: `split${depth}`,
      caption: depth === maxDepth ? "Down to single values" : `Split into ${segments.length} ranges`,
      narrationIntent:
        depth === maxDepth
          ? `Every range is now a single value, and one value is sorted by definition. That is the base case, and from here the work is putting the pieces back together in order.`
          : `Each range splits in half again, giving ${segments.length} ranges of ${[...new Set(sizes)].sort((a, b) => a - b).join(" and ")}. Nothing has been compared yet: this is pure division.`,
      state: { kind: "array", cells: cells(values), groups: groupsFrom(values, segments) },
    });
  }

  // Build up: one frame per level, each block sorted within itself.
  for (let depth = maxDepth - 1; depth >= 1; depth -= 1) {
    const segments = segmentsAtDepth(values.length, depth);
    const merged = sortedAtDepth(values, depth);
    if (frames.length >= MAX_MERGE_FRAMES - 3) break;
    frames.push({
      id: `merge${depth}`,
      caption: `Merged into ${segments.length} sorted runs`,
      narrationIntent: `Neighbouring ranges merge pairwise, so the array is now ${segments.length} sorted runs: ${segments
        .map((segment) => merged.slice(segment.start, segment.end).join(" "))
        .join(" | ")}. Each merge only ever compares the front of one run with the front of the other.`,
      state: { kind: "array", cells: cells(merged), groups: groupsFrom(merged, segments, "done") },
    });
  }

  // The final merge, front against front, which is where the linear-time
  // merge argument actually lives.
  const topSegments = segmentsAtDepth(values.length, 1);
  if (topSegments.length === 2) {
    const readyAtDepth1 = sortedAtDepth(values, 1);
    const left = readyAtDepth1.slice(topSegments[0]!.start, topSegments[0]!.end);
    const right = readyAtDepth1.slice(topSegments[1]!.start, topSegments[1]!.end);
    const out: number[] = [];
    let i = 0;
    let j = 0;
    let comparisons = 0;
    while (i < left.length && j < right.length && frames.length < MAX_MERGE_FRAMES - 1 && comparisons < 3) {
      const takeLeft = left[i]! <= right[j]!;
      const taken = takeLeft ? left[i]! : right[j]!;
      const other = takeLeft ? right[j]! : left[i]!;
      out.push(taken);
      comparisons += 1;
      const marks = new Map<number, TraceMark>();
      marks.set(takeLeft ? i : left.length + j, "active");
      marks.set(takeLeft ? left.length + j : i, "candidate");
      frames.push({
        id: `take${comparisons}`,
        caption: `${taken} is smaller than ${other}, so it goes out first`,
        narrationIntent: `Both runs are already sorted, so the smallest value left in the whole array has to be at the front of one of them. ${taken} is smaller than ${other}, so ${taken} is written to the output and that run's marker moves on. Nothing else is ever compared.`,
        state: {
          kind: "array",
          cells: marked(cells([...left, ...right]), marks),
          groups: [
            { id: "left", cells: marked(cells(left), new Map(takeLeft ? [[i, "active" as TraceMark]] : [[i, "candidate" as TraceMark]])) },
            { id: "right", cells: marked(cells(right), new Map(takeLeft ? [[j, "candidate" as TraceMark]] : [[j, "active" as TraceMark]])) },
          ],
          asides: [aside("out", "output", "row", out, values.length)],
        },
      });
      if (takeLeft) i += 1;
      else j += 1;
    }
  }

  const sorted = [...values].sort((a, b) => a - b);
  frames.push({
    id: "sorted",
    caption: `Sorted: ${sorted.join(" ")}`.slice(0, 60),
    narrationIntent: `The last merge finishes the array. Every level of the split does the same total amount of merging work, and there are log n levels, which is exactly where n log n comes from.`,
    state: { kind: "array", cells: cells(sorted), showIndices: true },
  });

  return {
    algorithmId: "merge_sort",
    title: "Merge sort",
    input: { values },
    result: sorted,
    resultText: sorted.join(" "),
    frames,
  };
}

/**
 * Frames a bubble-sort walk-through may spend. The budget covers the first
 * pass comparison by comparison plus one summary per later pass, which is how
 * the algorithm is taught on a board.
 */
const MAX_BUBBLE_FRAMES = 14;

/** Longest input whose first pass is walked in full. */
const FULL_DETAIL_MAX_LENGTH = 6;

/** Comparisons detailed in pass one when the input is longer than that. */
const PARTIAL_DETAIL_COMPARISONS = 3;

/** Bars are a magnitude channel, so a negative value has no honest height. */
function barsFor(values: readonly number[]): number[] | null {
  return values.every((value) => Number.isFinite(value) && value >= 0) ? [...values] : null;
}

export function simulateBubbleSort(input: SortInput): AlgorithmTrace | null {
  const values = [...input.values];
  if (values.length < 4 || values.length > 8) return null;

  const bars = barsFor(values);
  const length = values.length;
  const frames: TraceFrame[] = [];
  const alreadySorted = values.every((value, index) => index === 0 || values[index - 1]! <= value);

  const push = (
    id: string,
    caption: string,
    narrationIntent: string,
    options: {
      left?: number;
      marks?: Map<number, TraceMark>;
      swap?: { from: number; to: number };
      bracket: { from: number; to: number; label: string };
    },
  ) => {
    frames.push({
      id,
      caption,
      narrationIntent,
      state: {
        kind: "array",
        cells: marked(cells(values), options.marks ?? new Map<number, TraceMark>()),
        // A pass summary has no live pair, so the markers come off: leaving
        // them parked under index 0 and 1 says the algorithm is looking there.
        ...(options.left !== undefined
          ? { pointers: [{ name: "j", index: options.left }, { name: "j+1", index: options.left + 1 }] }
          : {}),
        ...(bars ? { bars: barsFor(values)! } : {}),
        ...(options.swap ? { swap: options.swap } : {}),
        brackets: [options.bracket],
      },
    });
  };

  const pairMarks = (left: number, settled: number): Map<number, TraceMark> => {
    const marks = new Map<number, TraceMark>();
    for (let i = settled; i < length; i += 1) marks.set(i, "done");
    marks.set(left, "active");
    marks.set(left + 1, "active");
    return marks;
  };

  const unsortedBracket = { from: 0, to: length - 1, label: "unsorted" };
  const settledBracket = (settled: number) => ({ from: settled, to: length - 1, label: "sorted" });

  push(
    "input",
    alreadySorted ? "Input, already in order" : "Unsorted input",
    alreadySorted
      ? `This array is already in order, which is the case worth seeing: bubble sort still has to walk it once to find that out, and the early exit is what stops it walking again.`
      : bars
        ? `The bars show how big each value is, so you can see at a glance that the array is not in order. Bubble sort walks it with two neighbouring markers, j and j plus one, starting at index 0 and index 1.`
        : `This is the array we have to sort. Bubble sort walks it with two neighbouring markers, j and j plus one, starting at index 0 and index 1.`,
    { left: 0, bracket: unsortedBracket },
  );

  const detailedComparisons = length <= FULL_DETAIL_MAX_LENGTH
    ? length - 1
    : Math.min(PARTIAL_DETAIL_COMPARISONS, length - 1);

  let settled = length;
  let pass = 0;
  let detailPass = true;

  while (settled > 1 && frames.length < MAX_BUBBLE_FRAMES) {
    pass += 1;
    let swappedThisPass = false;
    let detailedThisPass = 0;

    for (let j = 0; j + 1 < settled; j += 1) {
      const left = values[j]!;
      const right = values[j + 1]!;
      const willSwap = left > right;
      const detailing = detailPass && j < detailedComparisons && frames.length < MAX_BUBBLE_FRAMES - length;

      if (detailing) {
        detailedThisPass += 1;
        push(
          `cmp${pass}_${j}`,
          willSwap ? `Is ${left} > ${right}? Yes` : `Is ${left} > ${right}? No`,
          willSwap
            ? `Compare the pair at index ${j} and index ${j + 1}. ${left} is bigger than ${right}, so they are out of order and bubble sort swaps them.`
            : `Compare the pair at index ${j} and index ${j + 1}. ${left} is not bigger than ${right}, so this pair is already in order and nothing moves. Both markers slide one step right.`,
          { left: j, marks: pairMarks(j, settled), bracket: settled === length ? unsortedBracket : settledBracket(settled) },
        );
      }

      if (willSwap) {
        values[j] = right;
        values[j + 1] = left;
        swappedThisPass = true;
        if (detailing) {
          push(
            `swp${pass}_${j}`,
            `Swap ${left} and ${right}`,
            `The arcs show the exchange: ${left} moves right into index ${j + 1} and ${right} moves left into index ${j}. The larger value has taken one step towards the end, which is what makes values bubble up.`,
            {
              left: j,
              marks: pairMarks(j, settled),
              swap: { from: j, to: j + 1 },
              bracket: settled === length ? unsortedBracket : settledBracket(settled),
            },
          );
        }
      }
    }

    settled -= 1;
    const finished = !swappedThisPass || settled <= 1;
    const parked = values[settled]!;
    // Say so when the pass carried on past the last frame drawn, rather than
    // letting values appear to teleport between two frames.
    const skipped = detailPass && detailedThisPass > 0 && detailedThisPass < settled;
    push(
      `pass${pass}`,
      finished ? `Sorted: ${values.join(" ")}`.slice(0, 60) : `End of pass ${pass}: ${parked} is settled`,
      finished
        ? `Pass ${pass} moved nothing, which proves every neighbouring pair is already in order, so the array is sorted and the loop stops early${bars ? ". The bars now climb steadily from left to right" : ""}.`
        : `${skipped ? `The rest of pass ${pass} carried on the same way, comparing each neighbouring pair and swapping when they were out of order. ` : ""}Pass ${pass} is done. The largest value still in play, ${parked}, has reached index ${settled} and the bracket marks it as settled. The next pass can stop one cell earlier, which is why the inner loop bound shrinks.`,
      {
        marks: (() => {
          const marks = new Map<number, TraceMark>();
          for (let i = finished ? 0 : settled; i < length; i += 1) marks.set(i, "done");
          return marks;
        })(),
        bracket: finished ? { from: 0, to: length - 1, label: "sorted" } : settledBracket(settled),
      },
    );

    detailPass = false;
    if (finished) break;
  }

  if (frames.length < 2) return null;
  const sorted = [...input.values].sort((a, b) => a - b);
  return {
    algorithmId: "bubble_sort",
    title: "Bubble sort",
    input: { values: input.values },
    result: sorted,
    resultText: sorted.join(" "),
    frames,
  };
}
