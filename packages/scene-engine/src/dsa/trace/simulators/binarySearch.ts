/**
 * Binary search on a sorted array.
 *
 * One frame per probe. The window mark carries [lo, hi] so the halving is
 * visible as the shaded band shrinking, which is the thing a student has to
 * see; the returned index is real, so narration can state the answer.
 */
import {
  cells,
  marked,
  type AlgorithmTrace,
  type TraceFrame,
  type TraceMark,
  type TracePointer,
} from "../types";

export interface BinarySearchInput {
  values: number[];
  target: number;
}

const MAX_FRAMES = 6;

export function simulateBinarySearch(input: BinarySearchInput): AlgorithmTrace | null {
  const values = input.values;
  if (values.length < 4 || values.length > 12) return null;
  // A search that is not monotonic is not this algorithm; drawing it would
  // teach the student something false about the precondition.
  for (let i = 1; i < values.length; i += 1) {
    if (values[i]! <= values[i - 1]!) return null;
  }

  const base = cells(values);
  const frames: TraceFrame[] = [];

  const frameFor = (lo: number, hi: number, mid: number | null, caption: string, say: string) => {
    const marks = new Map<number, TraceMark>();
    for (let i = 0; i < values.length; i += 1) {
      if (i < lo || i > hi) marks.set(i, "excluded");
      else marks.set(i, "window");
    }
    if (mid !== null) marks.set(mid, "active");
    const pointers: TracePointer[] = [
      { name: "lo", index: lo },
      ...(mid !== null ? [{ name: "mid", index: mid }] : []),
      { name: "hi", index: hi },
    ];
    frames.push({
      id: `probe${frames.length}`,
      caption,
      narrationIntent: say,
      state: {
        kind: "array",
        cells: marked(base, marks),
        pointers,
        // The live range is a bracket rather than a dim: the half that was
        // thrown away has to look thrown away.
        brackets: [{ from: lo, to: hi, label: "still possible" }],
        note: `target = ${input.target}`,
      },
    });
  };

  let lo = 0;
  let hi = values.length - 1;
  let found = -1;

  frameFor(
    lo,
    hi,
    null,
    `Search ${input.target} in ${values.length} sorted values`,
    `The whole array is still in play, so lo sits at 0 and hi at ${hi}. Every value is a candidate.`,
  );

  while (lo <= hi && frames.length < MAX_FRAMES) {
    const mid = Math.floor((lo + hi) / 2);
    const value = values[mid]!;
    if (value === input.target) {
      frameFor(lo, hi, mid, `a[${mid}] = ${value}, found`, `mid lands on ${value}, which is the target. Done in ${frames.length} probes.`);
      found = mid;
      break;
    }
    if (value < input.target) {
      frameFor(lo, hi, mid, `a[${mid}] = ${value} < ${input.target}, go right`, `mid is ${value}, below the target, so everything from lo through mid can be dropped.`);
      lo = mid + 1;
    } else {
      frameFor(lo, hi, mid, `a[${mid}] = ${value} > ${input.target}, go left`, `mid is ${value}, above the target, so mid and everything right of it can be dropped.`);
      hi = mid - 1;
    }
  }

  if (found < 0 && frames.length < MAX_FRAMES && lo > hi) {
    frames.push({
      id: "absent",
      caption: `${input.target} is not present`,
      narrationIntent: "lo has passed hi, so there is no range left to search and the target was never in the array. Each probe halved what was possible, which is why even a long array runs out in a handful of steps.",
      state: {
        kind: "array",
        cells: base.map((cell) => ({ ...cell, mark: "excluded" as TraceMark })),
        note: `target = ${input.target}`,
      },
    });
  }

  if (frames.length < 2) return null;
  return {
    algorithmId: "binary_search",
    title: "Binary search",
    input: { values, target: input.target },
    result: found,
    resultText: found >= 0 ? `index ${found}` : "not present",
    earlyExit: found >= 0,
    frames,
  };
}
