/**
 * One-dimensional dynamic programming, and the single-pass scans that are the
 * same idea with the table thrown away.
 *
 * The lesson these families owe a student is not "here is a filled array". It
 * is that one cell of the table is computed from cells that are already
 * finished, by a rule you can say out loud. So every frame draws two rows
 * stacked: the problem's own input on top and the dp table underneath, with
 * the cell being written marked `active` and the one or two cells it reads
 * marked so you can see the arrow of dependency without an arrow. The frame
 * note carries the arithmetic for exactly that cell, with both the symbolic
 * form and the numbers, because "dp[4] = dp[3] + dp[2] = 3 + 2 = 5" is the
 * sentence the student has to be able to reproduce and a filled row is not.
 *
 * Two choices are worth defending.
 *
 * **The reads are marked, not the whole row.** The two-string DP families
 * light a whole row at a time and that is what made a filled table look like
 * magic; a one-dimensional table is small enough to point at the actual
 * dependency, so it does.
 *
 * **`window` means "taken", `candidate` means "considered".** A cell the rule
 * merely compared is drawn dashed; the cell whose value actually flowed into
 * dp[i] gets the bracket. Marking every read the same way would teach that a
 * max over two options is an addition of two options, which is the single
 * most common misreading of House Robber.
 *
 * Kadane and Jump Game have no table to draw: their whole state is one
 * running number, so they are one input row with that number accumulating in
 * an aside beneath it. Drawing them as a dp table would be a lie about the
 * space they use, which is the only interesting thing about them.
 */
import {
  aside,
  type AlgorithmTrace,
  type ArrayFrameState,
  type StackedFrameState,
  type TraceCell,
  type TraceFrame,
  type TraceMark,
} from "../types";

/** Longest input any family here will walk. Frames are capped at 16. */
const MAX_CELLS = 12;

/**
 * A note is drawn as a row of at most four chips of at most sixteen
 * characters, split on runs of two or more spaces. Joining the pieces here
 * rather than writing one long sentence is what keeps the compiler from
 * word-wrapping the arithmetic at a place that splits an expression.
 */
function chips(...pieces: ReadonlyArray<string>): string {
  return pieces.filter((piece) => piece.trim().length > 0).join("  ");
}

/** Cells from already-stringified text, with marks applied by index. */
function row(texts: ReadonlyArray<string>, marks: ReadonlyMap<number, TraceMark>): TraceCell[] {
  return texts.map((text, index) => {
    const mark = marks.get(index);
    return mark ? { text, mark } : { text };
  });
}

/**
 * The input row above the dp table.
 *
 * The input row's indices are suppressed: the dp row carries them, the two
 * rows are drawn from the same left edge, and writing 0 1 2 3 twice on one
 * board reads as two different axes rather than one.
 */
function dpFrameState(options: {
  inputLabel: string;
  inputCells: TraceCell[];
  dpCells: TraceCell[];
  note: string;
}): StackedFrameState {
  return {
    kind: "stacked",
    parts: [
      {
        label: options.inputLabel,
        state: { kind: "array", cells: options.inputCells, showIndices: false } satisfies ArrayFrameState,
      },
      {
        label: "dp",
        state: { kind: "array", cells: options.dpCells, showIndices: true } satisfies ArrayFrameState,
      },
    ],
    note: options.note,
  };
}

/** `4+(-1)`, never `4+-1` and never a spaced hyphen, which the gate bans. */
function sum(left: number, right: number): string {
  return right < 0 ? `${left}+(${right})` : `${left}+${right}`;
}

function wholeNumbers(values: ReadonlyArray<number>, min: number, max: number): boolean {
  return values.every((value) => Number.isInteger(value) && value >= min && value <= max);
}

// --------------------------------------------------------------------------
// Climbing Stairs (LeetCode 70), which is Fibonacci wearing a staircase.
// --------------------------------------------------------------------------

export interface StairCountInput {
  /** Number of steps to the top. */
  n: number;
}

/**
 * The top row is the move set, `1` and `2`, not the staircase.
 *
 * Drawing the stairs as the input row would put 0..n above a dp row that
 * already writes 0..n under itself, so the board would state the index twice
 * and the actual input, "you may climb one or two", nowhere. With the moves on
 * top, both cells light while the table adds its two: arrive by a single step
 * from i-1, or by a double step from i-2.
 *
 * The moves are marked `active` rather than `window` because a window run on
 * an input row grows a bracket under it, which makes that panel taller in the
 * frames that have one, and a stacked frame places the table under whatever
 * the panel above it happens to be tall. That moved the whole dp row 93 pixels
 * between the base frame and the next one.
 */
export function simulateClimbingStairs(input: StairCountInput): AlgorithmTrace | null {
  const n = input.n;
  if (!Number.isInteger(n) || n < 3 || n > 10) return null;

  const dp: number[] = [1, 1];
  for (let i = 2; i <= n; i += 1) dp[i] = dp[i - 1]! + dp[i - 2]!;

  const width = n + 1;
  const texts = (upTo: number): string[] =>
    Array.from({ length: width }, (_, index) => (index <= upTo ? String(dp[index]!) : ""));

  const frames: TraceFrame[] = [
    {
      id: "base",
      caption: "dp[0] = 1 and dp[1] = 1 are the base cases",
      narrationIntent:
        "The table holds one number per stair: how many distinct ways there are to arrive at it. There is exactly one way to be standing at the bottom, which is to have taken nothing, and exactly one way to be on stair one, which is a single step. Those two are not computed, they are agreed, and every other cell is built from cells already filled.",
      state: dpFrameState({
        inputLabel: "moves",
        inputCells: row(["1", "2"], new Map()),
        dpCells: row(texts(1), new Map([[0, "done"], [1, "done"]])),
        note: chips("dp[0] = 1", "dp[1] = 1", "base cases"),
      }),
    },
  ];

  for (let i = 2; i <= n; i += 1) {
    const marks = new Map<number, TraceMark>([[i, "active"], [i - 1, "window"], [i - 2, "window"]]);
    const last = i === n;
    frames.push({
      id: `stair${i}`,
      caption: last
        ? `dp[${i}] = ${dp[i - 1]} + ${dp[i - 2]} = ${dp[i]}, so ${dp[i]} ways`
        : `dp[${i}] = dp[${i - 1}] + dp[${i - 2}] = ${dp[i - 1]} + ${dp[i - 2]} = ${dp[i]}`,
      narrationIntent:
        `The last move onto stair ${i} was either a single step from stair ${i - 1} or a double step from stair ${i - 2}, and there is no third way to land here. Those two groups of routes cannot overlap, because they end with different moves, so the count is simply their total: ${dp[i - 1]} plus ${dp[i - 2]}, which is ${dp[i]}. Notice that nothing was recounted and no route was walked twice.`,
      state: dpFrameState({
        inputLabel: "moves",
        inputCells: row(["1", "2"], new Map([[0, "active"], [1, "active"]])),
        dpCells: row(texts(i), marks),
        note: chips(`dp[${i}] =`, `dp[${i - 1}]+dp[${i - 2}]`, `= ${dp[i - 1]}+${dp[i - 2]}`, `= ${dp[i]}`),
      }),
    });
  }

  return {
    algorithmId: "dp_fibonacci",
    title: "Climbing stairs",
    input: { n },
    result: dp[n]!,
    resultText: `${dp[n]} ways`,
    frames,
  };
}

// --------------------------------------------------------------------------
// Min Cost Climbing Stairs (LeetCode 746).
// --------------------------------------------------------------------------

export interface StairCostInput {
  cost: number[];
}

/**
 * `dp` is one cell longer than `cost`, and that extra cell is the point.
 *
 * The top of the floor is one past the last step and costs nothing to stand
 * on, so the answer lives at dp[n] where the input row has run out. A table
 * the same width as the input would have to answer "the minimum cost to reach
 * the last step", which is a different and wrong number: on [10,15,20] it is
 * 15 versus the 15 that happens to coincide, and on [1,100,1,1,1,100] it is
 * 103 rather than 3.
 */
export function simulateMinCostStairs(input: StairCostInput): AlgorithmTrace | null {
  const cost = input.cost;
  if (cost.length < 3 || cost.length > 7) return null;
  if (!wholeNumbers(cost, 0, 999)) return null;

  const n = cost.length;
  const dp: number[] = [0, 0];
  for (let i = 2; i <= n; i += 1) {
    dp[i] = Math.min(dp[i - 1]! + cost[i - 1]!, dp[i - 2]! + cost[i - 2]!);
  }

  const width = n + 1;
  const texts = (upTo: number): string[] =>
    Array.from({ length: width }, (_, index) => (index <= upTo ? String(dp[index]!) : ""));
  const costTexts = cost.map((value) => String(value));

  const frames: TraceFrame[] = [
    {
      id: "base",
      caption: "Starting on step 0 or step 1 is free",
      narrationIntent:
        "Each cell of the table is the cheapest way to be standing on that step, before paying anything to leave it. The rules let you begin on either of the first two steps, so arriving at step zero and arriving at step one both cost nothing, and those two zeroes are the base of everything else. The cost written above a step is what you pay to leave it, not to reach it, which is the detail this problem hides.",
      state: dpFrameState({
        inputLabel: "cost",
        inputCells: row(costTexts, new Map()),
        dpCells: row(texts(1), new Map([[0, "done"], [1, "done"]])),
        note: chips("dp[0] = 0", "dp[1] = 0", "free to start"),
      }),
    },
  ];

  for (let i = 2; i <= n; i += 1) {
    const fromOne = dp[i - 1]! + cost[i - 1]!;
    const fromTwo = dp[i - 2]! + cost[i - 2]!;
    const singleWins = fromOne <= fromTwo;
    const winner = singleWins ? i - 1 : i - 2;
    const loser = singleWins ? i - 2 : i - 1;
    const dpMarks = new Map<number, TraceMark>([[i, "active"], [winner, "window"], [loser, "candidate"]]);
    const costMarks = new Map<number, TraceMark>([[winner, "active"], [loser, "candidate"]]);
    const last = i === n;
    frames.push({
      id: `reach${i}`,
      caption: last
        ? `dp[${i}] = ${dp[i]}, the minimum cost to the top is ${dp[i]}`
        : `dp[${i}] = min(${fromOne}, ${fromTwo}) = ${dp[i]}`,
      narrationIntent:
        `There are two ways to be standing on ${last ? "the top of the floor" : `step ${i}`}. Coming from step ${i - 1} costs the ${dp[i - 1]} it took to get there plus the ${cost[i - 1]} charged to leave it, which is ${fromOne}. Coming from step ${i - 2} costs ${dp[i - 2]} plus ${cost[i - 2]}, which is ${fromTwo}. The cheaper of those is ${dp[i]}, so that is what the cell holds, and the more expensive route is never thought about again.`,
      state: dpFrameState({
        inputLabel: "cost",
        inputCells: row(costTexts, costMarks),
        dpCells: row(texts(i), dpMarks),
        note: chips(
          `dp[${i}] = min of`,
          `dp[${i - 1}]+c[${i - 1}]=${fromOne}`,
          `dp[${i - 2}]+c[${i - 2}]=${fromTwo}`,
          `dp[${i}]=${dp[i]}`,
        ),
      }),
    });
  }

  return {
    algorithmId: "dp_min_cost_stairs",
    title: "Min cost climbing stairs",
    input: { cost },
    result: dp[n]!,
    resultText: `min cost ${dp[n]}`,
    frames,
  };
}

// --------------------------------------------------------------------------
// House Robber (LeetCode 198).
// --------------------------------------------------------------------------

export interface ValuesInput {
  values: number[];
}

/**
 * The two reads are alternatives, not addends, and the marks say so.
 *
 * dp[i] is a max, and the single commonest wrong answer to House Robber is to
 * add the two cells the rule looks at. The winner is bracketed and the loser
 * is left dashed, so the board never shows two cells lit the same way under an
 * arithmetic that only used one of them.
 */
export function simulateHouseRobber(input: ValuesInput): AlgorithmTrace | null {
  const values = input.values;
  if (values.length < 3 || values.length > 8) return null;
  if (!wholeNumbers(values, 0, 999)) return null;

  const n = values.length;
  const dp: number[] = [values[0]!, Math.max(values[0]!, values[1]!)];
  for (let i = 2; i < n; i += 1) dp[i] = Math.max(dp[i - 1]!, dp[i - 2]! + values[i]!);

  const texts = (upTo: number): string[] =>
    Array.from({ length: n }, (_, index) => (index <= upTo ? String(dp[index]!) : ""));
  const valueTexts = values.map((value) => String(value));

  const frames: TraceFrame[] = [
    {
      id: "base",
      caption: `dp[0] = ${values[0]}, the only house in reach`,
      narrationIntent:
        `Each cell answers one question: what is the most you can take from the street up to and including this house, obeying the rule that no two robbed houses are next door. With only house zero on the street the answer is whatever is in it, ${values[0]}, because there is nothing to choose between.`,
      state: dpFrameState({
        inputLabel: "nums",
        inputCells: row(valueTexts, new Map([[0, "active"]])),
        dpCells: row(texts(0), new Map([[0, "done"]])),
        note: chips("one house only", `dp[0] = ${values[0]}`),
      }),
    },
    {
      id: "pick1",
      caption: `dp[1] = max(${values[0]}, ${values[1]}) = ${dp[1]}`,
      narrationIntent:
        `Houses zero and one are neighbours, so they cannot both be robbed and the best you can do over the first two is simply the richer of them: ${values[0]} against ${values[1]}, which is ${dp[1]}. That is the second base case, and from here every cell is a decision rather than a lookup.`,
      state: dpFrameState({
        inputLabel: "nums",
        inputCells: row(valueTexts, new Map([[values[0]! >= values[1]! ? 0 : 1, "active"], [values[0]! >= values[1]! ? 1 : 0, "candidate"]])),
        dpCells: row(texts(1), new Map([[1, "active"], [0, "window"]])),
        note: chips(`house 0 = ${values[0]}`, `house 1 = ${values[1]}`, `dp[1] = ${dp[1]}`),
      }),
    },
  ];

  for (let i = 2; i < n; i += 1) {
    const skip = dp[i - 1]!;
    const rob = dp[i - 2]! + values[i]!;
    const robWins = rob > skip;
    const dpMarks = new Map<number, TraceMark>([
      [i, "active"],
      [robWins ? i - 2 : i - 1, "window"],
      [robWins ? i - 1 : i - 2, "candidate"],
    ]);
    const last = i === n - 1;
    frames.push({
      id: `house${i}`,
      caption: last
        ? `dp[${i}] = ${dp[i]}, so the most you can rob is ${dp[i]}`
        : `dp[${i}] = max(dp[${i - 1}], ${values[i]} + dp[${i - 2}]) = ${dp[i]}`,
      narrationIntent:
        `Standing at house ${i} there are exactly two plans. Skip it and you keep whatever the best plan through house ${i - 1} was, which is ${skip}. Rob it and you take its ${values[i]}, but house ${i - 1} is now off limits, so you can only add the best plan through house ${i - 2}, giving ${dp[i - 2]} plus ${values[i]}, which is ${rob}. ${robWins ? "Robbing wins" : "Skipping wins"}, so the cell holds ${dp[i]}.`,
      state: dpFrameState({
        inputLabel: "nums",
        inputCells: row(valueTexts, new Map([[i, "active"]])),
        dpCells: row(texts(i), dpMarks),
        note: chips(
          `dp[${i}] = max of`,
          `dp[${i - 1}]=${skip}`,
          `${values[i]}+dp[${i - 2}]=${rob}`,
          `dp[${i}]=${dp[i]}`,
        ),
      }),
    });
  }

  return {
    algorithmId: "dp_house_robber",
    title: "House robber",
    input: { values },
    result: dp[n - 1]!,
    resultText: `rob ${dp[n - 1]}`,
    frames,
  };
}

// --------------------------------------------------------------------------
// Coin Change (LeetCode 322).
// --------------------------------------------------------------------------

export interface CoinChangeInput {
  coins: number[];
  amount: number;
}

const INFINITY_TEXT = "∞";

/**
 * Unreachable amounts are drawn as infinity, not left blank and not written
 * as a large number.
 *
 * A blank cell is indistinguishable from a cell the walk has not reached yet,
 * and the whole reason Coin Change returns -1 is that some amounts have no
 * answer at all. Writing the symbol keeps "not yet computed" and "provably
 * impossible" as two different marks on the board, which is what makes the
 * final -1 follow from the table rather than from an announcement.
 */
export function simulateCoinChange(input: CoinChangeInput): AlgorithmTrace | null {
  const { coins, amount } = input;
  if (coins.length < 2 || coins.length > 4) return null;
  if (!wholeNumbers(coins, 1, 50)) return null;
  if (new Set(coins).size !== coins.length) return null;
  if (!Number.isInteger(amount) || amount < 2 || amount > MAX_CELLS - 1) return null;

  const dp: number[] = [0];
  /** Which coin produced dp[a], as an index into `coins`; -1 when unreachable. */
  const via: number[] = [-1];
  for (let a = 1; a <= amount; a += 1) {
    let best = Number.POSITIVE_INFINITY;
    let bestCoin = -1;
    for (const [index, coin] of coins.entries()) {
      if (coin > a) continue;
      const previous = dp[a - coin]!;
      if (!Number.isFinite(previous)) continue;
      if (previous + 1 < best) {
        best = previous + 1;
        bestCoin = index;
      }
    }
    dp[a] = best;
    via[a] = bestCoin;
  }

  const cellText = (value: number): string => (Number.isFinite(value) ? String(value) : INFINITY_TEXT);
  const texts = (upTo: number): string[] =>
    Array.from({ length: amount + 1 }, (_, index) => (index <= upTo ? cellText(dp[index]!) : ""));
  const coinTexts = coins.map((coin) => String(coin));

  const frames: TraceFrame[] = [
    {
      id: "base",
      caption: "dp[0] = 0, an empty amount needs no coins",
      narrationIntent:
        "Each cell of the table is the fewest coins that make exactly that amount. Zero is made by taking nothing at all, so dp of zero is zero, and every other cell will be answered by asking what is left after spending one coin, which is always a smaller amount and therefore a cell already filled.",
      state: dpFrameState({
        inputLabel: "coins",
        inputCells: row(coinTexts, new Map()),
        dpCells: row(texts(0), new Map([[0, "done"]])),
        note: chips("dp[0] = 0", "no coins needed"),
      }),
    },
  ];

  for (let a = 1; a <= amount; a += 1) {
    const chosen = via[a]!;
    const reachable = chosen >= 0;
    const dpMarks = new Map<number, TraceMark>([[a, "active"]]);
    const coinMarks = new Map<number, TraceMark>();
    for (const [index, coin] of coins.entries()) {
      if (coin > a) continue;
      if (!Number.isFinite(dp[a - coin]!)) continue;
      if (index === chosen) continue;
      dpMarks.set(a - coin, "candidate");
      coinMarks.set(index, "candidate");
    }
    if (reachable) {
      dpMarks.set(a - coins[chosen]!, "window");
      coinMarks.set(chosen, "active");
    }
    const last = a === amount;
    const rest = reachable ? a - coins[chosen]! : 0;
    const answerCaption = reachable
      ? `dp[${a}] = ${dp[a]}, so ${a} needs ${dp[a]} coins`
      : `Amount ${a} cannot be made, so the answer is -1`;
    frames.push({
      id: `amt${a}`,
      caption: last
        ? answerCaption
        : reachable
          ? `dp[${a}] = dp[${rest}] + 1 = ${dp[a]}, paying coin ${coins[chosen]}`
          : `No coin reaches ${a}, so dp[${a}] stays infinite`,
      narrationIntent: reachable
        ? `To make ${a}, spend one coin and ask what is left. Paying the ${coins[chosen]} leaves ${rest}, and the table already says ${rest} takes ${dp[rest]} ${dp[rest] === 1 ? "coin" : "coins"}, so this route costs ${dp[a]}. Every other coin was tried the same way and none of them did better, which is why the answer here is ${dp[a]} rather than whatever a greedy grab of the largest coin would have given.`
        : `Every coin small enough to spend on ${a} leaves behind an amount that the table has already marked impossible, so there is no way to make ${a} at all and the cell holds infinity. That infinity is not a failure of the method, it is the answer, and it is what a later cell reads when it tries to build on this one.`,
      state: dpFrameState({
        inputLabel: "coins",
        inputCells: row(coinTexts, coinMarks),
        dpCells: row(texts(a), dpMarks),
        note: reachable
          ? chips(`coin ${coins[chosen]} wins`, `dp[${rest}]=${dp[rest]}`, `1+dp[${rest}]=${dp[a]}`, `dp[${a}]=${dp[a]}`)
          : chips("no coin works", `dp[${a}] = ${INFINITY_TEXT}`),
      }),
    });
  }

  const answer = Number.isFinite(dp[amount]!) ? dp[amount]! : -1;
  return {
    algorithmId: "dp_coin_change",
    title: "Coin change",
    input: { coins, amount },
    result: answer,
    resultText: answer < 0 ? "-1, cannot be made" : `${answer} coins`,
    frames,
  };
}

// --------------------------------------------------------------------------
// Longest Increasing Subsequence (LeetCode 300), the O(n^2) table.
// --------------------------------------------------------------------------

/**
 * The answer is the largest cell, not the last cell, and the walk ends by
 * saying so on the board.
 *
 * Every other family here reads its answer off the end of the table, and a
 * student who has just watched four of them will read the end of this one
 * too. On the default input dp ends 4 and the maximum is also 4, so a walk
 * that stopped at the last write would look right and teach the wrong rule.
 * The closing frame marks the cell that actually holds the maximum and traces
 * the subsequence back through the predecessors that produced it.
 */
export function simulateLongestIncreasingSubsequence(input: ValuesInput): AlgorithmTrace | null {
  const values = input.values;
  if (values.length < 4 || values.length > 8) return null;
  if (!wholeNumbers(values, -999, 999)) return null;

  const n = values.length;
  const dp: number[] = [];
  /** The j whose run this cell extended, or -1 when the run starts here. */
  const from: number[] = [];
  for (let i = 0; i < n; i += 1) {
    let best = 1;
    let bestFrom = -1;
    for (let j = 0; j < i; j += 1) {
      if (values[j]! >= values[i]!) continue;
      if (dp[j]! + 1 > best) {
        best = dp[j]! + 1;
        bestFrom = j;
      }
    }
    dp[i] = best;
    from[i] = bestFrom;
  }

  let answerIndex = 0;
  for (let i = 1; i < n; i += 1) if (dp[i]! > dp[answerIndex]!) answerIndex = i;
  const answer = dp[answerIndex]!;

  const chain: number[] = [];
  for (let at = answerIndex; at >= 0; at = from[at]!) chain.unshift(at);

  const texts = (upTo: number): string[] =>
    Array.from({ length: n }, (_, index) => (index <= upTo ? String(dp[index]!) : ""));
  const valueTexts = values.map((value) => String(value));

  const frames: TraceFrame[] = [];
  for (let i = 0; i < n; i += 1) {
    const predecessor = from[i]!;
    const extended = predecessor >= 0;
    const dpMarks = new Map<number, TraceMark>([[i, "active"]]);
    for (let j = 0; j < i; j += 1) {
      if (values[j]! < values[i]! && j !== predecessor) dpMarks.set(j, "candidate");
    }
    if (extended) dpMarks.set(predecessor, "window");
    // `candidate` and not `window` on the input row: a window run grows a
    // bracket beneath the row, which makes this panel taller only in the
    // frames that have a predecessor, and the dp table below it would drop by
    // that much and jump back up on the next frame.
    const inputMarks = new Map<number, TraceMark>([[i, "active"]]);
    if (extended) inputMarks.set(predecessor, "candidate");

    frames.push({
      id: `pos${i}`,
      caption: i === 0
        ? `dp[0] = 1, one value is already a run of 1`
        : extended
          ? `${values[i]} extends ${values[predecessor]}, so dp[${i}] = dp[${predecessor}] + 1 = ${dp[i]}`
          : `Nothing smaller sits before ${values[i]}, so dp[${i}] = 1`,
      narrationIntent: i === 0
        ? `Each cell holds the length of the longest strictly increasing run that ends exactly at that position. The first value has nothing before it, so the longest run ending there is the value on its own, which is length one.`
        : extended
          ? `To fill position ${i} we look back at every earlier value smaller than ${values[i]}, because any of them could be the one just before it in an increasing run. The best of those is ${values[predecessor]} at index ${predecessor}, whose own run is ${dp[predecessor]} long, so hanging ${values[i]} on the end of it gives ${dp[i]}. Nothing earlier could do better, and we never had to look at the runs themselves, only their lengths.`
          : `Position ${i} holds ${values[i]}, and every value before it is at least as large, so there is no earlier value it could follow in a strictly increasing run. With nothing to extend, the longest run ending here is ${values[i]} by itself, which is length one.`,
      state: dpFrameState({
        inputLabel: "nums",
        inputCells: row(valueTexts, inputMarks),
        dpCells: row(texts(i), dpMarks),
        note: i === 0
          ? chips("first value", "dp[0] = 1")
          : extended
            ? chips(`${values[i]} > ${values[predecessor]} at j=${predecessor}`, `dp[${predecessor}]=${dp[predecessor]}`, `dp[${i}]=1+${dp[predecessor]}`, `= ${dp[i]}`)
            : chips("nothing smaller", `before ${values[i]}`, `dp[${i}] = 1`),
      }),
    });
  }

  const chainMarks = new Map<number, TraceMark>(chain.map((index) => [index, "done" as TraceMark]));
  frames.push({
    id: "answer",
    caption: `The run ${chain.map((index) => values[index]).join(" ")} has length ${answer}`.slice(0, 60),
    narrationIntent:
      `The answer is not the last cell, it is the largest one: ${answer}, sitting at index ${answerIndex}. Following each cell back to the value it extended rebuilds the subsequence itself, ${chain.map((index) => values[index]).join(" then ")}, and the ticks mark those positions in the input. The table only ever stored lengths, and the run came back out of it for free.`,
    state: dpFrameState({
      inputLabel: "nums",
      inputCells: row(valueTexts, chainMarks),
      dpCells: row(texts(n - 1), new Map([[answerIndex, "active"]])),
      note: chips(`best dp is ${answer}`, `at index ${answerIndex}`, `length ${answer}`),
    }),
  });

  return {
    algorithmId: "dp_lis",
    title: "Longest increasing subsequence",
    input: { values },
    result: answer,
    resultText: `length ${answer}`,
    frames,
  };
}

// --------------------------------------------------------------------------
// Kadane, Maximum Subarray (LeetCode 53).
// --------------------------------------------------------------------------

/** Bracket labels are capped at 20 characters by the renderer. */
const CURRENT_RUN = "current run";

/**
 * One row and one aside, because that is all the algorithm holds.
 *
 * Kadane is the dp families with the table thrown away: `cur` is dp[i] and
 * nothing else is ever read again. Drawing it as a two row table would show a
 * structure the code does not build and would hide the one claim worth
 * making, which is that constant space is enough. The aside records what each
 * cur was so the student can still see the sequence the table would have
 * held, without pretending it was kept.
 */
export function simulateKadane(input: ValuesInput): AlgorithmTrace | null {
  const values = input.values;
  if (values.length < 4 || values.length > 9) return null;
  if (!wholeNumbers(values, -99, 99)) return null;

  const n = values.length;
  const running: number[] = [];
  const frames: TraceFrame[] = [];

  let cur = values[0]!;
  let start = 0;
  let best = values[0]!;
  let bestStart = 0;
  let bestEnd = 0;
  running.push(cur);

  const valueTexts = values.map((value) => String(value));
  const frameState = (options: {
    marks: Map<number, TraceMark>;
    bracket: { from: number; to: number; label: string };
    filled: number;
    note: string;
  }): ArrayFrameState => ({
    kind: "array",
    cells: row(valueTexts, options.marks),
    showIndices: true,
    brackets: [options.bracket],
    asides: [aside("cur", "cur sum", "row", running.slice(0, options.filled).map((value) => String(value)), n)],
    note: options.note,
  });

  frames.push({
    id: "pos0",
    caption: `cur = ${cur} and best = ${best} to start`,
    narrationIntent:
      `Kadane keeps one running number: the largest sum of any subarray that ends at the position we are looking at. At the very first cell there is only one such subarray, the single value ${values[0]}, so both the running sum and the best seen so far start there, even when the value is negative.`,
    state: frameState({
      marks: new Map([[0, "active"]]),
      bracket: { from: 0, to: 0, label: CURRENT_RUN },
      filled: 1,
      note: chips(`start at ${values[0]}`, `cur ${cur}`, `best ${best}`),
    }),
  });

  for (let i = 1; i < n; i += 1) {
    const extended = cur + values[i]!;
    const restart = extended < values[i]!;
    if (restart) {
      cur = values[i]!;
      start = i;
    } else {
      cur = extended;
    }
    running.push(cur);
    const improved = cur > best;
    if (improved) {
      best = cur;
      bestStart = start;
      bestEnd = i;
    }
    frames.push({
      id: `pos${i}`,
      caption: `cur = max(${values[i]}, ${sum(running[i - 1]!, values[i]!)}) = ${cur}, best ${best}`.slice(0, 60),
      narrationIntent:
        `At index ${i} there are only two subarrays ending here worth considering: carry the previous run forward, which gives ${running[i - 1]} plus ${values[i]} equal to ${extended}, or throw it away and start again at ${values[i]} alone. ${restart ? `Starting again wins, because the run we were carrying had gone negative and any sum is better without it, so cur becomes ${cur} and the run now begins at index ${i}.` : `Carrying on wins, so cur becomes ${cur} and the run still begins at index ${start}.`} ${improved ? `That is a new best, so the best sum is now ${best}.` : `The best sum stays at ${best}.`}`,
      state: frameState({
        marks: new Map([[i, "active"]]),
        bracket: { from: start, to: i, label: CURRENT_RUN },
        filled: i + 1,
        note: chips(`extend to ${extended}`, `or start at ${values[i]}`, `cur ${cur}`, `best ${best}`),
      }),
    });
  }

  frames.push({
    id: "answer",
    caption: `The best subarray sums to ${best}`,
    narrationIntent:
      `The bracket marks the winning stretch, from index ${bestStart} to index ${bestEnd}, and its total is ${best}. The whole array was walked once and nothing but two numbers was ever stored, which is why this runs in linear time and constant space where trying every subarray would take quadratic time at best.`,
    state: frameState({
      marks: new Map(
        Array.from({ length: bestEnd - bestStart + 1 }, (_, offset): [number, TraceMark] => [bestStart + offset, "done"]),
      ),
      bracket: { from: bestStart, to: bestEnd, label: `best sum ${best}` },
      filled: n,
      note: chips(`best ${best}`, `from ${bestStart} to ${bestEnd}`),
    }),
  });

  return {
    algorithmId: "kadane",
    title: "Maximum subarray",
    input: { values },
    result: best,
    resultText: `best sum ${best}`,
    frames,
  };
}

// --------------------------------------------------------------------------
// Jump Game (LeetCode 55), a furthest-reach scan.
// --------------------------------------------------------------------------

const REACHABLE = "reachable";

/**
 * The scan runs to the end of the array even after the last index is already
 * covered, because that is what the loop does.
 *
 * Stopping the moment reach passes the last index is a legal optimisation and
 * it makes a three frame walk out of a five element array, which hides the
 * shape of the algorithm: reach is a high water mark that never falls, and
 * seeing it fail to grow for two frames is what teaches that. The one early
 * exit drawn is the real one, where the scan meets an index it cannot reach
 * and stops with an answer.
 */
export function simulateJumpGame(input: ValuesInput): AlgorithmTrace | null {
  const values = input.values;
  if (values.length < 3 || values.length > 9) return null;
  if (!wholeNumbers(values, 0, 99)) return null;

  const n = values.length;
  const last = n - 1;
  const reaches: number[] = [];
  const frames: TraceFrame[] = [];
  const valueTexts = values.map((value) => String(value));

  const frameState = (options: {
    marks: Map<number, TraceMark>;
    reach: number;
    filled: number;
    note: string;
  }): ArrayFrameState => ({
    kind: "array",
    cells: row(valueTexts, options.marks),
    showIndices: true,
    brackets: [{ from: 0, to: Math.min(options.reach, last), label: REACHABLE }],
    asides: [aside("reach", "reach", "row", reaches.slice(0, options.filled).map((value) => String(value)), n)],
    note: options.note,
  });

  let reach = 0;
  let blockedAt = -1;
  for (let i = 0; i < n; i += 1) {
    if (i > reach) {
      blockedAt = i;
      break;
    }
    const candidate = i + values[i]!;
    const grew = candidate > reach;
    const previous = reach;
    reach = Math.max(reach, candidate);
    reaches.push(reach);
    frames.push({
      id: `pos${i}`,
      caption: grew
        ? `From index ${i} you reach ${i} + ${values[i]} = ${reach}`
        : `Index ${i} reaches only ${candidate}, so reach stays ${reach}`,
      narrationIntent:
        `Index ${i} is inside the reachable stretch, so we are allowed to stand on it, and from here a jump of up to ${values[i]} carries us as far as index ${candidate}. ${grew ? `That is further than the ${previous} we could reach before, so the bracket grows to index ${reach}.` : `That is no further than the ${previous} we could already reach, so the bracket does not move. Reach is a high water mark: it never falls, and a short jump simply adds nothing.`}`,
      state: frameState({
        marks: new Map([[i, "active"]]),
        reach,
        filled: reaches.length,
        note: grew
          ? chips(`i=${i}, ${i}+${values[i]}=${candidate}`, `reach ${previous} to ${reach}`, `need ${last}`)
          : chips(`i=${i}, ${i}+${values[i]}=${candidate}`, `reach stays ${reach}`, `need ${last}`),
      }),
    });
  }

  const success = blockedAt < 0;
  const verdictMarks = new Map<number, TraceMark>();
  if (success) verdictMarks.set(last, "done");
  else for (let i = blockedAt; i < n; i += 1) verdictMarks.set(i, "excluded");

  frames.push({
    id: "verdict",
    caption: success
      ? `Index ${last} is reachable, so the answer is true`
      : `Index ${last} is unreachable, so the answer is false`,
    narrationIntent: success
      ? `Every index from zero to ${last} was inside the reachable stretch when the scan arrived at it, so the walk never stopped and the last index is covered. The answer is true, and notice that no route was ever written down: one number that only ever grows was enough to decide it.`
      : `The scan reached index ${blockedAt} and found it outside the bracket, which means no earlier jump can land on or past it. Reach never falls, so nothing later can rescue it either, and the cells from there on are struck out. The answer is false and the scan stopped there rather than walking the rest of the array.`,
    state: frameState({
      marks: verdictMarks,
      reach,
      filled: reaches.length,
      note: success
        ? chips(`reach ${reach}`, `last index ${last}`, "true")
        : chips(`reach stops at ${reach}`, `index ${blockedAt} is out`, "false"),
    }),
  });

  return {
    algorithmId: "greedy_jump",
    title: "Jump game",
    input: { values },
    result: success,
    resultText: success ? `true, index ${last} is reachable` : `false, index ${last} is unreachable`,
    ...(success ? {} : { earlyExit: true }),
    frames,
  };
}
