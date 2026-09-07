/**
 * Two pointers converging from both ends of a sorted array.
 *
 * Covers the two-sum-on-sorted-input shape and its relatives (reverse in
 * place, container with most water) by recording the pair actually examined
 * at each step, so the sum written under the figure is the sum the algorithm
 * computed rather than one the narration invented.
 */
import {
  cells,
  marked,
  type AlgorithmTrace,
  type TraceFrame,
  type TraceMark,
} from "../types";

export interface TwoPointersInput {
  values: number[];
  target: number;
}

const MAX_FRAMES = 6;

export function simulateTwoPointers(input: TwoPointersInput): AlgorithmTrace | null {
  const values = input.values;
  if (values.length < 4 || values.length > 12) return null;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i]! < values[i - 1]!) return null;
  }

  const base = cells(values);
  const frames: TraceFrame[] = [];
  let left = 0;
  let right = values.length - 1;
  let answer: [number, number] | null = null;

  const push = (caption: string, say: string, extra?: Map<number, TraceMark>) => {
    const marks = extra ?? new Map<number, TraceMark>();
    marks.set(left, "active");
    marks.set(right, "active");
    for (let i = left + 1; i < right; i += 1) {
      if (!marks.has(i)) marks.set(i, "window");
    }
    for (let i = 0; i < left; i += 1) marks.set(i, "excluded");
    for (let i = right + 1; i < values.length; i += 1) marks.set(i, "excluded");
    frames.push({
      id: `step${frames.length}`,
      caption,
      narrationIntent: say,
      state: {
        kind: "array",
        cells: marked(base, marks),
        pointers: [
          { name: "left", index: left },
          { name: "right", index: right },
        ],
        note: `target = ${input.target}   left + right = ${values[left]! + values[right]!}`,
      },
    });
  };

  push(
    `Find two values summing to ${input.target}`,
    `left starts at the smallest value and right at the largest. Because the array is sorted, one comparison rules out a whole side.`,
  );

  while (left < right && frames.length < MAX_FRAMES) {
    const sum = values[left]! + values[right]!;
    if (sum === input.target) {
      push(
        `${values[left]} + ${values[right]} = ${input.target}: indices ${left} and ${right}`,
        `${values[left]} plus ${values[right]} hits ${input.target} exactly, so the answer is the pair at indices ${left} and ${right}. Neither marker ever went backwards, so the whole scan is one pass.`,
      );
      answer = [left, right];
      break;
    }
    if (sum < input.target) {
      push(
        `${values[left]} + ${values[right]} = ${sum} < ${input.target}`,
        `${values[left]} plus ${values[right]} is ${sum}, which is ${input.target - sum} short. ` +
          `${values[right]} is already the largest value left, so no pair with ${values[left]} can reach ${input.target}: ` +
          `left moves up to ${values[left + 1]}.`,
      );
      left += 1;
    } else {
      push(
        `${values[left]} + ${values[right]} = ${sum} > ${input.target}`,
        `${values[left]} plus ${values[right]} is ${sum}, which overshoots by ${sum - input.target}. ` +
          `${values[left]} is already the smallest value left, so nothing can pair with ${values[right]}: ` +
          `right comes down to ${values[right - 1]}.`,
      );
      right -= 1;
    }
  }

  if (frames.length < 2) return null;
  return {
    algorithmId: "two_pointers",
    title: "Two pointers",
    input: { values, target: input.target },
    result: answer,
    resultText: answer ? `indices ${answer[0]} and ${answer[1]}` : "no pair sums to the target",
    earlyExit: answer !== null && answer[1] < values.length - 1,
    frames,
  };
}
