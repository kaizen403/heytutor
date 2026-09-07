/**
 * Fixed- and variable-width sliding windows.
 *
 * `fixed` records the running sum of every k-wide window; `longestUnique`
 * records the longest run with no repeated character. Both report the real
 * best-so-far at each frame, so the figure and the spoken maximum agree.
 */
import {
  cells,
  marked,
  type AlgorithmTrace,
  type TraceFrame,
  type TraceMark,
} from "../types";

export interface FixedWindowInput {
  values: number[];
  width: number;
}

export interface UniqueWindowInput {
  characters: string[];
}

const MAX_FRAMES = 8;

export function simulateFixedWindow(input: FixedWindowInput): AlgorithmTrace | null {
  const { values, width } = input;
  if (values.length < 4 || values.length > 12) return null;
  if (width < 2 || width >= values.length) return null;

  const base = cells(values);
  const frames: TraceFrame[] = [];
  let sum = 0;
  let best = Number.NEGATIVE_INFINITY;
  let bestStart = 0;

  for (let end = 0; end < values.length; end += 1) {
    sum += values[end]!;
    if (end < width - 1) continue;
    const start = end - width + 1;
    const previousBest = best;
    if (sum > best) {
      best = sum;
      bestStart = start;
    }
    if (frames.length < MAX_FRAMES) {
      const marks = new Map<number, TraceMark>();
      for (let i = 0; i < values.length; i += 1) {
        marks.set(i, i >= start && i <= end ? "window" : "excluded");
      }
      marks.set(end, "active");
      frames.push({
        id: `w${start}`,
        caption: `window [${start}..${end}] sums to ${sum}`,
        narrationIntent:
          start === 0
            ? `The first window of ${width} sums to ${sum}. That is the number to beat, and the note above the row carries it as the walk goes on.`
            : `Slide one step: drop ${values[start - 1]}, add ${values[end]}, and the sum becomes ${sum}${sum > previousBest ? `, which is a new best` : `, still behind the best of ${best}`}. Nothing is recomputed from scratch, which is what makes the whole pass linear.`,
        state: {
          kind: "array",
          cells: marked(base, marks),
          pointers: [{ name: "start", index: start }, { name: "end", index: end }],
          note: `sum = ${sum}   best = ${best}`,
        },
      });
    }
    sum -= values[start]!;
  }

  if (frames.length < 2) return null;
  // The walk used to end on whichever window happened to be last, so the
  // answer was never stated on the board at all.
  const bestMarks = new Map<number, TraceMark>();
  for (let i = 0; i < values.length; i += 1) {
    bestMarks.set(i, i >= bestStart && i < bestStart + width ? "active" : "excluded");
  }
  frames.push({
    id: "best",
    caption: `Best window [${bestStart}..${bestStart + width - 1}] sums to ${best}`,
    narrationIntent: `Of every window of ${width}, the one starting at index ${bestStart} is the largest, at ${best}. Each value entered the sum once and left it once, so the whole scan is linear no matter how wide the window is.`,
    state: {
      kind: "array",
      cells: marked(base, bestMarks),
      note: `answer = ${best}`,
    },
  });
  return {
    algorithmId: "sliding_window_fixed",
    title: "Fixed sliding window",
    input: { values, width },
    result: { maxSum: best, startIndex: bestStart },
    resultText: `max sum ${best} at [${bestStart}..${bestStart + width - 1}]`,
    frames,
  };
}

export function simulateLongestUniqueWindow(input: UniqueWindowInput): AlgorithmTrace | null {
  const chars = input.characters;
  if (chars.length < 4 || chars.length > 12) return null;

  const base = cells(chars);
  const frames: TraceFrame[] = [];
  const lastSeen = new Map<string, number>();
  let start = 0;
  let best = 0;
  let bestStart = 0;

  for (let end = 0; end < chars.length; end += 1) {
    const ch = chars[end]!;
    const previous = lastSeen.get(ch);
    const repeated = previous !== undefined && previous >= start;
    if (repeated) start = previous + 1;
    lastSeen.set(ch, end);
    const length = end - start + 1;
    if (length > best) {
      best = length;
      bestStart = start;
    }
    if (frames.length < MAX_FRAMES) {
      {
        const marks = new Map<number, TraceMark>();
        for (let i = 0; i < chars.length; i += 1) {
          marks.set(i, i >= start && i <= end ? "window" : i < start ? "excluded" : "candidate");
        }
        marks.set(end, "active");
        frames.push({
          id: `u${end}`,
          caption: repeated ? `"${ch}" repeats, start jumps to ${start}` : `window [${start}..${end}], length ${length}`,
          narrationIntent: repeated
            ? `"${ch}" is already in the window at index ${previous}, so start jumps straight to ${start} rather than stepping one at a time. ` +
              `The window is now "${chars.slice(start, end + 1).join("")}", length ${length}, against a best of ${best}.`
            : `The window is ${length} long with no repeats. Best so far is ${best}.`,
          state: {
            kind: "array",
            cells: marked(base, marks),
            pointers: [{ name: "start", index: start }, { name: "end", index: end }],
            note: `window "${chars.slice(start, end + 1).join("")}"   best = ${best}`,
          },
        });
      }
    }
  }

  if (frames.length < 2) return null;
  const answerMarks = new Map<number, TraceMark>();
  for (let i = 0; i < chars.length; i += 1) {
    answerMarks.set(i, i >= bestStart && i < bestStart + best ? "active" : "excluded");
  }
  frames.push({
    id: "best",
    caption: `Longest is "${chars.slice(bestStart, bestStart + best).join("")}", length ${best}`,
    narrationIntent: `The longest stretch with no repeat is "${chars.slice(bestStart, bestStart + best).join("")}", which is ${best} characters. Both markers only ever moved right, so every character was looked at a constant number of times.`,
    state: { kind: "array", cells: marked(base, answerMarks), note: `answer = ${best}` },
  });
  return {
    algorithmId: "sliding_window_unique",
    title: "Longest substring without repeating characters",
    input: { characters: chars },
    result: { length: best, startIndex: bestStart },
    resultText: String(best),
    frames,
  };
}
