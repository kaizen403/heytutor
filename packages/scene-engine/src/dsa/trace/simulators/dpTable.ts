/**
 * Dynamic-programming tables filled row by row.
 *
 * The table is the algorithm's own `dp` array. Each frame is the state after
 * one more row, and one cell in that row is drawn with arrows coming in from
 * the cells it was computed from: the diagonal on a match, the neighbour
 * above and the neighbour to the left otherwise. Lighting the whole row and
 * saying the rule in words is what made a filled table look like magic.
 *
 * Row 0 and column 0 are the empty-prefix base cases and are always drawn:
 * hiding them is the other half of the same problem.
 */
import type { AlgorithmTrace, TraceCell, TraceFrame } from "../types";

const MAX_FRAMES = 8;
const EMPTY_PREFIX = "ε";

interface GridFrameOptions {
  dp: number[][];
  filledRows: number;
  active: ReadonlySet<string>;
}

function gridCells(options: GridFrameOptions): TraceCell[][] {
  return options.dp.map((row, r) =>
    row.map((value, c): TraceCell => {
      if (r > options.filledRows) return { text: "" };
      const text = String(value);
      if (options.active.has(`${r},${c}`)) return { text, mark: "active" };
      if (r === 0 || c === 0) return { text, mark: "done" };
      return { text };
    }),
  );
}

export interface TwoStringInput {
  a: string;
  b: string;
}

function checkStrings(input: TwoStringInput): boolean {
  return (
    input.a.length >= 2 &&
    input.a.length <= 6 &&
    input.b.length >= 2 &&
    input.b.length <= 6
  );
}

export function simulateLongestCommonSubsequence(input: TwoStringInput): AlgorithmTrace | null {
  if (!checkStrings(input)) return null;
  const a = [...input.a];
  const b = [...input.b];
  const rowLabels = [EMPTY_PREFIX, ...a];
  const colLabels = [EMPTY_PREFIX, ...b];
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0));

  const frames: TraceFrame[] = [];
  frames.push({
    id: "base",
    caption: "Empty prefix scores zero",
    narrationIntent: `Row ${EMPTY_PREFIX} and column ${EMPTY_PREFIX} mean one of the two strings is empty, so the longest common subsequence there is zero. Every other cell is built from cells that are already filled: the one diagonally up-left, the one above, and the one to the left.`,
    state: { kind: "grid", rowLabels, colLabels, cells: gridCells({ dp, filledRows: 0, active: new Set() }) },
  });

  for (let r = 1; r <= a.length; r += 1) {
    const active = new Set<string>();
    // The cell worth pointing at: the first match in this row if there is
    // one, because that is where the diagonal rule bites.
    let focusColumn = 1;
    let focusIsMatch = false;
    for (let c = 1; c <= b.length; c += 1) {
      const match = a[r - 1] === b[c - 1];
      dp[r]![c] = match ? dp[r - 1]![c - 1]! + 1 : Math.max(dp[r - 1]![c]!, dp[r]![c - 1]!);
      active.add(`${r},${c}`);
      if (match && !focusIsMatch) {
        focusColumn = c;
        focusIsMatch = true;
      }
    }
    if (frames.length < MAX_FRAMES) {
      const letter = a[r - 1]!;
      const other = b[focusColumn - 1]!;
      frames.push({
        id: `row${r}`,
        caption: focusIsMatch
          ? `"${letter}" matches "${other}": ${dp[r - 1]![focusColumn - 1]} + 1 = ${dp[r]![focusColumn]}`
          : `"${letter}" does not match "${other}": carry ${dp[r]![focusColumn]}`,
        narrationIntent: focusIsMatch
          ? `Row ${r} compares "${letter}" against every letter of "${input.b}". The arrows point at the cell where "${letter}" meets "${other}": because they are the same letter, that pair can be added to the best subsequence of the two shorter prefixes, so the value is the diagonal cell ${dp[r - 1]![focusColumn - 1]} plus one, which is ${dp[r]![focusColumn]}. The row ends at ${dp[r]![b.length]}.`
          : `Row ${r} compares "${letter}" against every letter of "${input.b}", and "${letter}" appears nowhere in it. With no match, a cell can only carry over the better of the cell above and the cell to the left, which the arrows point at. The row ends at ${dp[r]![b.length]}.`,
        state: {
          kind: "grid",
          rowLabels,
          colLabels,
          cells: gridCells({ dp, filledRows: r, active }),
          write: [r, focusColumn],
          reads: focusIsMatch ? [[r - 1, focusColumn - 1]] : [[r - 1, focusColumn], [r, focusColumn - 1]],
        },
      });
    }
  }

  const answer = dp[a.length]![b.length]!;
  if (frames.length >= 2) frames[frames.length - 1]!.caption = `Longest common subsequence is ${answer}`;
  return {
    algorithmId: "lcs",
    title: "Longest common subsequence",
    input: { a: input.a, b: input.b },
    result: answer,
    resultText: String(answer),
    frames,
  };
}

export function simulateEditDistance(input: TwoStringInput): AlgorithmTrace | null {
  if (!checkStrings(input)) return null;
  const a = [...input.a];
  const b = [...input.b];
  const rowLabels = [EMPTY_PREFIX, ...a];
  const colLabels = [EMPTY_PREFIX, ...b];
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, r) =>
    Array.from({ length: b.length + 1 }, (_, c) => (r === 0 ? c : c === 0 ? r : 0)),
  );

  const frames: TraceFrame[] = [];
  frames.push({
    id: "base",
    caption: "Base case: turn a prefix into nothing",
    narrationIntent: `Turning a prefix of length k into the empty string costs k deletions, and building it up from nothing costs k insertions, so the first row and the first column just count up. That is the whole base case, and every other cell is built from its three neighbours.`,
    state: { kind: "grid", rowLabels, colLabels, cells: gridCells({ dp, filledRows: 0, active: new Set() }) },
  });

  for (let r = 1; r <= a.length; r += 1) {
    const active = new Set<string>();
    let focusColumn = 1;
    let focusIsMatch = false;
    for (let c = 1; c <= b.length; c += 1) {
      const match = a[r - 1] === b[c - 1];
      dp[r]![c] = match ? dp[r - 1]![c - 1]! : 1 + Math.min(dp[r - 1]![c - 1]!, dp[r - 1]![c]!, dp[r]![c - 1]!);
      active.add(`${r},${c}`);
      if (match && !focusIsMatch) {
        focusColumn = c;
        focusIsMatch = true;
      }
    }
    if (frames.length < MAX_FRAMES) {
      const letter = a[r - 1]!;
      const other = b[focusColumn - 1]!;
      frames.push({
        id: `row${r}`,
        caption: focusIsMatch
          ? `"${letter}" matches "${other}": cost stays ${dp[r]![focusColumn]}`
          : `"${letter}" against "${other}": pay one, total ${dp[r]![focusColumn]}`,
        narrationIntent: focusIsMatch
          ? `Row ${r} turns the prefix ending in "${letter}" into each prefix of "${input.b}". Where "${letter}" meets "${other}" the letters already agree, so nothing has to be paid and the cost comes straight down the diagonal, which is what the arrow shows: ${dp[r]![focusColumn]}. The row ends at ${dp[r]![b.length]}.`
          : `Row ${r} turns the prefix ending in "${letter}" into each prefix of "${input.b}". "${letter}" is not in that string, so every cell has to pay one and then take the cheapest of its three neighbours: the diagonal is a replace, the one above is a delete, the one to the left is an insert. That gives ${dp[r]![focusColumn]} here, and the row ends at ${dp[r]![b.length]}.`,
        state: {
          kind: "grid",
          rowLabels,
          colLabels,
          cells: gridCells({ dp, filledRows: r, active }),
          write: [r, focusColumn],
          reads: focusIsMatch
            ? [[r - 1, focusColumn - 1]]
            : [[r - 1, focusColumn - 1], [r - 1, focusColumn], [r, focusColumn - 1]],
        },
      });
    }
  }

  const answer = dp[a.length]![b.length]!;
  if (frames.length >= 2) {
    frames[frames.length - 1]!.caption = `"${input.a}" to "${input.b}" costs ${answer}`.slice(0, 60);
  }
  return {
    algorithmId: "edit_distance",
    title: "Edit distance",
    input: { a: input.a, b: input.b },
    result: answer,
    resultText: String(answer),
    frames,
  };
}

export interface KnapsackInput {
  weights: number[];
  values: number[];
  capacity: number;
}

export function simulateKnapsack(input: KnapsackInput): AlgorithmTrace | null {
  const { weights, values, capacity } = input;
  if (weights.length < 2 || weights.length > 5) return null;
  if (weights.length !== values.length) return null;
  if (capacity < 2 || capacity > 11) return null;
  if (weights.some((weight) => weight <= 0) || values.some((value) => value < 0)) return null;

  // Row labels stay one glyph: a capacity+1 wide grid leaves each cell around
  // 55px, and "w3 v4" does not fit. Each frame's caption names the item's
  // weight and value instead, where there is room to read it.
  const rowLabels = [EMPTY_PREFIX, ...weights.map((_, index) => String(index + 1))];
  const colLabels = Array.from({ length: capacity + 1 }, (_, c) => String(c));
  const dp: number[][] = Array.from({ length: weights.length + 1 }, () =>
    Array.from({ length: capacity + 1 }, () => 0),
  );

  const frames: TraceFrame[] = [];
  frames.push({
    id: "base",
    caption: "No items available",
    narrationIntent: `Columns are the capacity the bag has left and rows are how many items we are allowed to choose from. With no items at all every capacity is worth zero, so the first row is the base case and each later row adds exactly one more item to the set we may pick from.`,
    state: { kind: "grid", rowLabels, colLabels, cells: gridCells({ dp, filledRows: 0, active: new Set() }) },
  });

  for (let r = 1; r <= weights.length; r += 1) {
    const active = new Set<string>();
    const weight = weights[r - 1]!;
    const value = values[r - 1]!;
    // Point at the first capacity where taking this item actually wins, which
    // is the only place the "value plus the cell w columns left" rule shows.
    let focusColumn = capacity;
    let focusTakes = false;
    for (let c = 0; c <= capacity; c += 1) {
      const without = dp[r - 1]![c]!;
      const withIt = weight > c ? -1 : dp[r - 1]![c - weight]! + value;
      dp[r]![c] = weight > c ? without : Math.max(without, withIt);
      if (c > 0) active.add(`${r},${c}`);
      if (!focusTakes && withIt > without) {
        focusColumn = c;
        focusTakes = true;
      }
    }
    if (frames.length < MAX_FRAMES) {
      const without = dp[r - 1]![focusColumn]!;
      const withIt = focusTakes ? dp[r - 1]![focusColumn - weight]! + value : null;
      frames.push({
        id: `item${r}`,
        caption: `Item ${r}: weight ${weight}, value ${value}`,
        narrationIntent: focusTakes
          ? `Item ${r} weighs ${weight} and is worth ${value}. Look at capacity ${focusColumn}: leaving it gives ${without}, the cell directly above. Taking it uses ${weight} of the ${focusColumn}, so what is left is worth ${dp[r - 1]![focusColumn - weight]}, the cell ${weight} columns to the left on the row above, and adding this item's ${value} makes ${withIt}. The larger wins, so the cell holds ${dp[r]![focusColumn]}.`
          : `Item ${r} weighs ${weight} and is worth ${value}, and it does not fit in any capacity where it would help, so every cell in this row simply copies the one above it. The row ends at ${dp[r]![capacity]}.`,
        state: {
          kind: "grid",
          rowLabels,
          colLabels,
          cells: gridCells({ dp, filledRows: r, active }),
          write: [r, focusColumn],
          reads: focusTakes ? [[r - 1, focusColumn], [r - 1, focusColumn - weight]] : [[r - 1, focusColumn]],
        },
      });
    }
  }

  const answer = dp[weights.length]![capacity]!;
  if (frames.length >= 2) frames[frames.length - 1]!.caption = `Best value at capacity ${capacity} is ${answer}`.slice(0, 60);
  return {
    algorithmId: "knapsack",
    title: "0/1 knapsack",
    input: { weights, values, capacity },
    result: answer,
    resultText: String(answer),
    frames,
  };
}
