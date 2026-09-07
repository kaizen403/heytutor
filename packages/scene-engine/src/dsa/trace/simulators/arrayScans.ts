/**
 * Array scans and binary-search variants.
 *
 * Six walks that all live on one row of cells but teach six different things,
 * and each one has a rendering that would quietly teach the wrong thing:
 *
 * - **Rotated search** is not "binary search on a rotated array". The probe
 *   itself is the easy half; the lesson is the extra question asked before
 *   every discard, which half is still in sorted order, so that question is a
 *   labelled bracket on the board in every frame rather than a sentence in
 *   the narration.
 * - **Binary search on the answer** searches a space the input never
 *   contains. Drawing the piles and putting `lo`, `mid` and `hi` on them is
 *   the single most common way this is mistaught, so the row here is the
 *   candidate speeds and the piles are demoted to an aside.
 * - **Merge from the back** has two read cursors, and only one of them
 *   indexes the row that is drawn. Putting `j` on the main row would point at
 *   a cell it has nothing to do with, so `j` lives in the aside.
 * - **3Sum** is two pointers with a fixed value, and the sort is not
 *   bookkeeping: the first frame shows the unsorted input so the student sees
 *   what the sort buys.
 * - **Trapping rain water** is about the water, not the bars, so the water is
 *   drawn as its own rectangle over the column that holds it.
 * - **Best time to buy** is one subtraction repeated, and the subtraction is
 *   a height on the board: the profit rectangle stands between the cheapest
 *   day so far and today.
 *
 * Every value in every frame is computed here, never described, so a gate can
 * compare a rendered label against the trace at the same address.
 */
import {
  aside,
  cells,
  marked,
  type AlgorithmTrace,
  type TraceBracket,
  type TraceFrame,
  type TraceMark,
  type TraceOverlay,
  type TracePointer,
} from "../types";

/**
 * Whether `traceToScene` will actually draw a magnitude column for these
 * values. It declines a non-positive value (no honest height) and a spread
 * wider than 20 (the smallest bar becomes an invisible stub), and when it
 * declines the bars it also drops every overlay, because an overlay is
 * measured in bar units.
 *
 * A simulator that emitted bars and looked away would hand the board a figure
 * whose whole content had silently vanished. Mirroring the rule here lets a
 * frame decide what it can rely on: indices go back under the row when the
 * bars are gone, so the cells are still addressable.
 */
function barsWillRender(values: readonly number[]): boolean {
  if (values.length === 0) return false;
  // Zero is a height, not a missing value: an elevation map with an empty
  // column is exactly the figure this file's water problem is about, and the
  // engine draws it as a column with no bar. The spread guard measures the
  // smallest bar a student can actually see, so zeros stay out of it.
  if (!values.every((value) => Number.isFinite(value) && value >= 0)) return false;
  const positives = values.filter((value) => value > 0);
  if (positives.length === 0) return false;
  return Math.max(...values) / Math.min(...positives) <= 20;
}

// --- 1. Search in a rotated sorted array (LeetCode 33). ---

export interface RotatedSearchInput {
  values: number[];
  target: number;
}

const ROTATED_MAX_FRAMES = 12;

/**
 * A rotation of a strictly increasing array has at most one descent, and when
 * it has one the last value must be below the first. Anything else is not the
 * precondition this algorithm relies on, and searching it would teach the
 * student that the sorted-half test works on arbitrary input.
 */
function isRotatedSorted(values: readonly number[]): boolean {
  if (new Set(values).size !== values.length) return false;
  let descents = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i]! < values[i - 1]!) descents += 1;
  }
  if (descents > 1) return false;
  return descents === 0 || values[values.length - 1]! < values[0]!;
}

export function simulateRotatedBinarySearch(input: RotatedSearchInput): AlgorithmTrace | null {
  const values = input.values;
  if (values.length < 4 || values.length > 12) return null;
  if (!values.every((value) => Number.isFinite(value))) return null;
  if (!isRotatedSorted(values)) return null;

  const base = cells(values);
  const frames: TraceFrame[] = [];
  const target = input.target;

  const push = (
    lo: number,
    hi: number,
    mid: number | null,
    caption: string,
    say: string,
    brackets: TraceBracket[],
    note: string,
  ) => {
    const marks = new Map<number, TraceMark>();
    for (let i = 0; i < values.length; i += 1) {
      marks.set(i, i < lo || i > hi ? "excluded" : "window");
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
        showIndices: true,
        brackets,
        note,
      },
    });
  };

  let lo = 0;
  let hi = values.length - 1;
  let found = -1;

  push(
    lo,
    hi,
    null,
    `Find ${target} in a sorted array that was rotated`.slice(0, 60),
    `The array climbs, falls once, then climbs again, so a plain midpoint comparison cannot say which side to keep. ` +
      `Every probe here answers a second question first: which of the two halves is still in sorted order.`,
    [{ from: 0, to: values.length - 1, label: "still possible" }],
    `target = ${target}`,
  );

  while (lo <= hi && frames.length < ROTATED_MAX_FRAMES - 1) {
    const mid = Math.floor((lo + hi) / 2);
    const value = values[mid]!;

    // The one decision this algorithm adds. `a[lo] <= a[mid]` means the low
    // side never crossed the rotation point, so [lo..mid] is a plain sorted
    // run and its endpoints alone decide whether the target can be inside it.
    //
    // This is computed before the hit test rather than after it, so the frame
    // that finds the target carries the same two brackets as every other
    // probe. A found frame that dropped them would take the lesson off the
    // board on the one frame a student is most likely to pause on.
    const leftSorted = values[lo]! <= value;
    const sortedFrom = leftSorted ? lo : mid;
    const sortedTo = leftSorted ? mid : hi;
    const inSorted = target >= values[sortedFrom]! && target <= values[sortedTo]!;
    const brackets: TraceBracket[] = [
      { from: sortedFrom, to: sortedTo, label: "sorted" },
    ];
    const restFrom = leftSorted ? mid + 1 : lo;
    const restTo = leftSorted ? hi : mid - 1;
    if (restFrom <= restTo) brackets.push({ from: restFrom, to: restTo, label: "rotated" });

    const side = leftSorted ? "left" : "right";

    if (value === target) {
      push(
        lo,
        hi,
        mid,
        `a[${mid}] = ${value}, found at index ${mid}`,
        `The probe lands on ${value}, which is the target, so the answer is index ${mid}. ` +
          `The ${side} half was still the sorted one here, and every step before this threw away a half whose sorted range could not contain ${target}.`,
        brackets,
        `target = ${target}   a[${mid}] = ${value}`,
      );
      found = mid;
      break;
    }

    const range = `${values[sortedFrom]}..${values[sortedTo]}`;
    push(
      lo,
      hi,
      mid,
      inSorted
        ? `${side} half ${range} is sorted and holds ${target}`.slice(0, 60)
        : `${side} half ${range} is sorted, ${target} is outside`.slice(0, 60),
      `a[${lo}] is ${values[lo]} and a[${mid}] is ${value}, so the ${side} half runs ${range} without a break. ` +
        (inSorted
          ? `${target} sits inside that range, so the search keeps the ${side} half and drops the other one, which is the half that could still be rotated.`
          : `${target} is outside that range, and a sorted run cannot hide a value between its two ends, so the whole ${side} half goes and the search continues in the half that holds the rotation.`),
      brackets,
      `target = ${target}   a[${lo}] = ${values[lo]}, a[${mid}] = ${value}`,
    );

    const keepSorted = inSorted;
    if (leftSorted === keepSorted) hi = mid - 1;
    else lo = mid + 1;
  }

  if (found < 0 && lo > hi && frames.length < ROTATED_MAX_FRAMES) {
    frames.push({
      id: "absent",
      caption: `${target} is absent, so the answer is index -1`.slice(0, 60),
      narrationIntent:
        `lo has passed hi, so nothing is left to look at and ${target} was never in the array. ` +
        `The rotation never cost an extra probe: each step still halved the range, it just needed the sorted-half test to know which half to keep.`,
      state: {
        kind: "array",
        cells: base.map((cell) => ({ ...cell, mark: "excluded" as TraceMark })),
        showIndices: true,
        brackets: [{ from: 0, to: values.length - 1, label: "nothing left" }],
        note: `target = ${target}`,
      },
    });
  }

  if (frames.length < 2) return null;
  return {
    algorithmId: "rotated_binary_search",
    title: "Search in a rotated sorted array",
    input: { values, target },
    result: found,
    resultText: `index ${found}`,
    earlyExit: found >= 0,
    frames,
  };
}

// --- 2. Binary search on the answer (Koko eating bananas, LeetCode 875). ---

export interface AnswerSearchInput {
  piles: number[];
  /** Hours before the guards return. */
  hours: number;
}

const ANSWER_MAX_FRAMES = 12;

/** Hours to clear every pile at `speed`, one pile per hour at most. */
function hoursAt(piles: readonly number[], speed: number): number {
  return piles.reduce((total, pile) => total + Math.ceil(pile / speed), 0);
}

export function simulateBinarySearchOnAnswer(input: AnswerSearchInput): AlgorithmTrace | null {
  const piles = input.piles;
  const limit = input.hours;
  if (piles.length < 2 || piles.length > 8) return null;
  if (!piles.every((pile) => Number.isInteger(pile) && pile >= 1 && pile <= 99)) return null;
  if (!Number.isInteger(limit) || limit < piles.length || limit > 999) return null;
  const fastest = Math.max(...piles);
  // The drawn row is one cell per candidate speed, so the search space itself
  // has to fit on a board. A wider one is a true statement of the algorithm
  // and a false picture of it.
  if (fastest < 3 || fastest > 12) return null;

  const speeds = Array.from({ length: fastest }, (_, index) => index + 1);
  const base = cells(speeds);
  const frames: TraceFrame[] = [];
  // A speed's cell index is one less than the speed. Writing 0..10 under a
  // row of speeds 1..11 is the trap this problem sets: a student reads the
  // answer off the index and says 3 rather than 4. The cell text is the
  // speed, and nothing else numbers the row.
  const pilesAside = aside("piles", "piles", "row", piles, piles.length);

  const push = (
    lo: number,
    hi: number,
    mid: number | null,
    caption: string,
    say: string,
    brackets: TraceBracket[],
    note: string,
  ) => {
    const marks = new Map<number, TraceMark>();
    for (const speed of speeds) {
      marks.set(speed - 1, speed < lo || speed > hi ? "excluded" : "window");
    }
    if (mid !== null) marks.set(mid - 1, "active");
    const pointers: TracePointer[] = [
      { name: "lo", index: lo - 1 },
      ...(mid !== null ? [{ name: "mid", index: mid - 1 }] : []),
      { name: "hi", index: hi - 1 },
    ];
    frames.push({
      id: `k${frames.length}`,
      caption,
      narrationIntent: say,
      state: {
        kind: "array",
        cells: marked(base, marks),
        pointers,
        showIndices: false,
        brackets,
        note,
        asides: [pilesAside],
      },
    });
  };

  let lo = 1;
  let hi = fastest;

  push(
    lo,
    hi,
    null,
    `Which speeds clear ${piles.length} piles within ${limit} hours?`.slice(0, 60),
    `The row is not the piles. It is every eating speed worth trying, from 1 banana an hour up to ${fastest}, which is the biggest pile and always finishes in ${piles.length} hours. ` +
      `Speed is what the question asks for, so speed is what gets halved.`,
    [{ from: 0, to: fastest - 1, label: "untested" }],
    `limit = ${limit} h`,
  );

  while (lo < hi && frames.length < ANSWER_MAX_FRAMES - 1) {
    const mid = Math.floor((lo + hi) / 2);
    const needed = hoursAt(piles, mid);
    const fits = needed <= limit;
    const brackets: TraceBracket[] = [{ from: lo - 1, to: hi - 1, label: "still possible" }];
    push(
      lo,
      hi,
      mid,
      fits
        ? `speed ${mid} needs ${needed} h, within ${limit}, so try slower`.slice(0, 60)
        : `speed ${mid} needs ${needed} h, over ${limit}, so go faster`.slice(0, 60),
      `At ${mid} bananas an hour the piles take ${piles.map((pile) => Math.ceil(pile / mid)).join(" plus ")}, which is ${needed} hours. ` +
        (fits
          ? `That is inside the ${limit} hour limit, so ${mid} is allowed and every speed above it is too. The answer is ${mid} or slower, and hi comes down to ${mid}.`
          : `That is past the ${limit} hour limit, so ${mid} is too slow and so is everything below it. lo moves up to ${mid + 1}.`),
      brackets,
      `limit = ${limit} h   speed ${mid} takes ${needed} h`,
    );
    if (fits) hi = mid;
    else lo = mid + 1;
  }

  const answer = lo;
  const answerHours = hoursAt(piles, answer);
  const finalMarks = new Map<number, TraceMark>();
  for (const speed of speeds) {
    finalMarks.set(speed - 1, speed < answer ? "excluded" : "done");
  }
  finalMarks.set(answer - 1, "active");
  const finalBrackets: TraceBracket[] = [];
  if (answer > 1) finalBrackets.push({ from: 0, to: answer - 2, label: "too slow" });
  finalBrackets.push({ from: answer - 1, to: fastest - 1, label: "fast enough" });
  frames.push({
    id: "answer",
    caption: `Slowest safe speed is ${answer} bananas per hour`.slice(0, 60),
    narrationIntent:
      `lo and hi have met on ${answer}, which takes ${answerHours} hours against a limit of ${limit}. ` +
      `The row splits cleanly into a slow side that never finishes and a fast side that always does, and that single flip is what made the answer searchable at all.`,
    state: {
      kind: "array",
      cells: marked(base, finalMarks),
      pointers: [{ name: "k", index: answer - 1 }],
      showIndices: false,
      brackets: finalBrackets,
      note: `answer = ${answer}   ${answerHours} h of ${limit} h`,
      asides: [pilesAside],
    },
  });

  if (frames.length < 2) return null;
  return {
    algorithmId: "binary_search_on_answer",
    title: "Binary search on the answer",
    input: { piles, hours: limit },
    result: answer,
    resultText: `speed ${answer}`,
    frames,
  };
}

// --- 3. Merge two sorted arrays in place, filling from the back (LC 88). ---

export interface MergeBackInput {
  /** Length m + n: m real values then n zeroed slots. */
  first: number[];
  m: number;
  second: number[];
}

const MERGE_MAX_FRAMES = 14;

export function simulateMergeFromBack(input: MergeBackInput): AlgorithmTrace | null {
  const { first, m, second } = input;
  const n = second.length;
  if (first.length !== m + n) return null;
  if (m < 1 || n < 1) return null;
  if (first.length < 4 || first.length > 12) return null;
  // The closing caption writes the whole merged row, and a caption is capped
  // at 60 characters, so a value wider than two digits could push the answer
  // off its own board.
  const small = (value: number) => Number.isInteger(value) && Math.abs(value) <= 99;
  if (!first.every(small) || !second.every(small)) return null;
  for (let i = 1; i < m; i += 1) if (first[i]! < first[i - 1]!) return null;
  for (let i = 1; i < n; i += 1) if (second[i]! < second[i - 1]!) return null;
  // The tail is the free space the whole trick depends on. If it holds real
  // values the board would show them being overwritten, which is a different
  // problem from the one the student is reading.
  for (let i = m; i < first.length; i += 1) if (first[i] !== 0) return null;

  const row = [...first];
  const frames: TraceFrame[] = [];
  let i = m - 1;
  let j = n - 1;
  let k = first.length - 1;

  /**
   * `j` indexes `second`, not the drawn row. A pointer named j under cell j of
   * the row would mark a cell it has nothing to do with, which is the reason
   * the second array is an aside with its own live cell instead.
   */
  const secondAside = (live: number) =>
    aside(
      "nums2",
      "nums2",
      "row",
      second,
      n,
      new Map(
        second.map((_, index): [number, TraceMark] =>
          index === live ? [index, "active"] : index > live ? [index, "done"] : [index, "window"],
        ),
      ),
    );

  const push = (id: string, caption: string, say: string, write: number | null) => {
    const marks = new Map<number, TraceMark>();
    for (let at = 0; at < row.length; at += 1) {
      if (write !== null && at > write) marks.set(at, "done");
      else if (at <= i) marks.set(at, "window");
      else marks.set(at, "candidate");
    }
    if (write !== null) marks.set(write, "active");
    const pointers: TracePointer[] = [];
    if (i >= 0) pointers.push({ name: "i", index: i });
    if (k >= 0) pointers.push({ name: "k", index: k });
    const brackets: TraceBracket[] = [];
    if (i >= 0) brackets.push({ from: 0, to: i, label: "not merged yet" });
    const settledFrom = write !== null ? write : m;
    if (settledFrom <= row.length - 1) {
      brackets.push({ from: settledFrom, to: row.length - 1, label: write !== null ? "merged" : "free space" });
    }
    frames.push({
      id,
      caption,
      narrationIntent: say,
      state: {
        kind: "array",
        cells: marked(cells(row), marks),
        pointers,
        showIndices: true,
        brackets,
        note: `m = ${m}, n = ${n}   j = ${j}`,
        asides: [secondAside(j)],
      },
    });
  };

  push(
    "start",
    `Merge ${n} values into the ${n} free slots at the back`.slice(0, 60),
    `Filling from the front would push every value right on each insert, which is quadratic. ` +
      `The free space is at the back, so the merge runs backwards: k starts on the last slot and the biggest remaining value goes there.`,
    null,
  );

  while (k >= 0 && frames.length < MERGE_MAX_FRAMES - 1) {
    if (j < 0) break;
    const write = k;
    if (i >= 0 && first[i]! > second[j]!) {
      const value = row[i]!;
      const other = second[j]!;
      const from = i;
      row[write] = value;
      i -= 1;
      k -= 1;
      push(
        `w${write}`,
        `${value} > ${other}, so index ${write} takes ${value}`.slice(0, 60),
        `The two candidates are ${value} from nums1 and ${other} from nums2, and ${value} is the larger, so it takes slot ${write}. ` +
          `It came from slot ${from}, which is left of ${write}, so nothing that still matters was overwritten.`,
        write,
      );
    } else {
      const value = second[j]!;
      // Equal values take the nums2 branch, which is what keeps the merge
      // stable: a tie hands the slot to the array whose values are copied in.
      const other = i >= 0 ? first[i]! : null;
      row[write] = value;
      j -= 1;
      k -= 1;
      push(
        `w${write}`,
        other !== null
          ? `${value} >= ${other}, so index ${write} takes ${value}`.slice(0, 60)
          : `nums1 is spent, so index ${write} takes ${value}`.slice(0, 60),
        other !== null
          ? `nums2 offers ${value} against ${other} from nums1, and ${value} is at least as large, so slot ${write} takes ${value} and j steps left to ${j}.`
          : `nums1 has nothing left to compare against, so the rest of nums2 drops straight in and slot ${write} takes ${value}.`,
        write,
      );
    }
  }

  const merged = row.map((value) => String(value));
  frames.push({
    id: "merged",
    caption: `Merged: ${merged.join(" ")}`.slice(0, 60),
    narrationIntent:
      `Every slot from ${row.length - 1} down to 0 has been written or was already correct, and the row is sorted. ` +
      `Each value moved exactly once and no value was ever shifted to make room, which is what the backwards fill bought.`,
    state: {
      kind: "array",
      cells: cells(row).map((cell) => ({ ...cell, mark: "done" as TraceMark })),
      showIndices: true,
      brackets: [{ from: 0, to: row.length - 1, label: "sorted" }],
      note: `m = ${m}, n = ${n}   in place`,
      asides: [secondAside(-1)],
    },
  });

  if (frames.length < 2) return null;
  return {
    algorithmId: "merge_two_sorted_arrays",
    title: "Merge two sorted arrays in place",
    input: { first, m, second },
    result: row,
    resultText: merged.join(" ").slice(0, 60),
    frames,
  };
}

// --- 4. 3Sum: fix one value, two pointers on the rest (LeetCode 15). ---

export interface ThreeSumInput {
  values: number[];
}

const THREE_SUM_MAX_FRAMES = 16;

export function simulateThreeSum(input: ThreeSumInput): AlgorithmTrace | null {
  const values = input.values;
  if (values.length < 4 || values.length > 8) return null;
  if (!values.every((value) => Number.isFinite(value) && Math.abs(value) <= 99)) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const sortedBase = cells(sorted);
  const n = sorted.length;
  const frames: TraceFrame[] = [];
  const triplets: number[][] = [];

  const push = (
    id: string,
    caption: string,
    say: string,
    fixed: number,
    left: number | null,
    right: number | null,
    hit: boolean,
  ) => {
    const marks = new Map<number, TraceMark>();
    for (let at = 0; at < n; at += 1) marks.set(at, at < fixed ? "excluded" : "candidate");
    if (left !== null && right !== null) {
      for (let at = left; at <= right; at += 1) marks.set(at, "window");
      marks.set(left, hit ? "done" : "active");
      marks.set(right, hit ? "done" : "active");
    }
    marks.set(fixed, hit ? "done" : "active");
    const pointers: TracePointer[] = [{ name: "i", index: fixed }];
    if (left !== null) pointers.push({ name: "left", index: left });
    if (right !== null) pointers.push({ name: "right", index: right });
    frames.push({
      id,
      caption,
      narrationIntent: say,
      state: {
        kind: "array",
        cells: marked(sortedBase, marks),
        pointers,
        showIndices: true,
        brackets: [{ from: fixed + 1, to: n - 1, label: "two pointers" }],
        note:
          left !== null && right !== null
            ? `target = 0   sum = ${sorted[fixed]! + sorted[left]! + sorted[right]!}`
            : `target = 0   a[i] = ${sorted[fixed]}`,
      },
    });
  };

  frames.push({
    id: "unsorted",
    caption: `Sort first: ${values.join(" ")}`.slice(0, 60),
    narrationIntent:
      `Two pointers only work on order, so the very first move is to sort. ` +
      `Sorting also puts equal values next to each other, which is how duplicate triplets get skipped later without a set.`,
    state: {
      kind: "array",
      cells: cells(values),
      showIndices: true,
      note: `target = 0   ${n} values`,
    },
  });

  for (let fixed = 0; fixed + 2 < n; fixed += 1) {
    // Equal fixed values would produce the same triplets a second time. The
    // sort put them adjacent, so one comparison replaces a deduplicating set.
    if (fixed > 0 && sorted[fixed] === sorted[fixed - 1]) {
      if (frames.length < THREE_SUM_MAX_FRAMES - 1) {
        push(
          `skip${fixed}`,
          `a[${fixed}] repeats a[${fixed - 1}], so skip it`.slice(0, 60),
          `a[${fixed}] is ${sorted[fixed]} and a[${fixed - 1}] was ${sorted[fixed - 1]} as well. ` +
            `Fixing the same value twice would rediscover the same triplets, so this index is stepped over without opening a pair scan.`,
          fixed,
          null,
          null,
          false,
        );
      }
      continue;
    }
    let left = fixed + 1;
    let right = n - 1;
    while (left < right) {
      const sum = sorted[fixed]! + sorted[left]! + sorted[right]!;
      const record = frames.length < THREE_SUM_MAX_FRAMES - 1;
      if (sum === 0) {
        triplets.push([sorted[fixed]!, sorted[left]!, sorted[right]!]);
        if (record) {
          push(
            `hit${fixed}_${left}`,
            `${sorted[fixed]} + ${sorted[left]} + ${sorted[right]} = 0 at ${fixed}, ${left}, ${right}`.slice(0, 60),
            `With ${sorted[fixed]} fixed, ${sorted[left]} and ${sorted[right]} close the gap exactly, so indices ${fixed}, ${left} and ${right} are a triplet. ` +
              `Both markers now move inward: keeping either one would need the other to repeat a value it has already passed.`,
            fixed,
            left,
            right,
            true,
          );
        }
        left += 1;
        right -= 1;
        while (left < right && sorted[left] === sorted[left - 1]) left += 1;
        while (left < right && sorted[right] === sorted[right + 1]) right -= 1;
        continue;
      }
      if (sum < 0) {
        if (record) {
          push(
            `lo${fixed}_${left}`,
            `${sorted[fixed]} + ${sorted[left]} + ${sorted[right]} = ${sum}, raise left`.slice(0, 60),
            `Indices ${fixed}, ${left} and ${right} give ${sum}, which is ${-sum} short of zero. ` +
              `a[${right}] is already the largest value left in the range, so no partner for a[${left}] can reach zero and left moves up to ${left + 1}.`,
            fixed,
            left,
            right,
            false,
          );
        }
        left += 1;
      } else {
        if (record) {
          push(
            `hi${fixed}_${right}`,
            `${sorted[fixed]} + ${sorted[left]} + ${sorted[right]} = ${sum}, lower right`.slice(0, 60),
            `Indices ${fixed}, ${left} and ${right} give ${sum}, which overshoots zero by ${sum}. ` +
              `a[${left}] is already the smallest value left in the range, so nothing can pair with a[${right}] and right comes down to ${right - 1}.`,
            fixed,
            left,
            right,
            false,
          );
        }
        right -= 1;
      }
    }
  }

  const written = triplets.map((triplet) => `[${triplet.join(",")}]`);
  const listed = written.join(" and ");
  // The closing caption has to state the answer, and the gate checks that it
  // does by matching words. A list too long for a 60-character caption would
  // be truncated into a caption that no longer contains the answer, so past
  // that width the answer is stated as a count plus the first triplet.
  const listable = written.length > 0 && `Triplets: ${listed}`.length <= 60;
  const answerText =
    written.length === 0 ? "no triplet sums to 0" : listable ? listed : `${written.length} triplets`;
  const answerCaption =
    written.length === 0
      ? "No triplet sums to 0"
      : listable
        ? `Triplets: ${listed}`
        : `${written.length} triplets found, first is ${written[0]}`.slice(0, 60);
  const answerMarks = new Map<number, TraceMark>();
  const inAnswer = new Set<number>();
  for (const triplet of triplets) {
    for (const value of triplet) {
      for (let at = 0; at < n; at += 1) {
        if (sorted[at] === value && !inAnswer.has(at)) {
          inAnswer.add(at);
          break;
        }
      }
    }
  }
  for (let at = 0; at < n; at += 1) answerMarks.set(at, inAnswer.has(at) ? "done" : "excluded");
  frames.push({
    id: "triplets",
    caption: answerCaption,
    narrationIntent:
      written.length === 0
        ? `Every fixed value was tried and no pair beside it ever closed to zero, so the answer is the empty list. The scan still cost one pass per fixed value rather than a full triple loop.`
        : `The distinct triplets are ${listed}. Fixing one value turned a three-way search into a pair search, and the pair search is one linear pass, so the whole thing is quadratic rather than cubic.`,
    state: {
      kind: "array",
      cells: marked(sortedBase, answerMarks),
      showIndices: true,
      brackets: [{ from: 0, to: n - 1, label: "sorted input" }],
      note: `target = 0   ${written.length} triplets`,
    },
  });

  if (frames.length < 2) return null;
  return {
    algorithmId: "three_sum_two_pointers",
    title: "3Sum with two pointers",
    input: { values },
    result: triplets,
    resultText: answerText.slice(0, 60),
    frames,
  };
}

// --- 5. Trapping rain water with two pointers (LeetCode 42). ---

export interface RainWaterInput {
  heights: number[];
}

const RAIN_MAX_FRAMES = 16;

export function simulateTrappingRainWater(input: RainWaterInput): AlgorithmTrace | null {
  const heights = input.heights;
  if (heights.length < 4 || heights.length > 12) return null;
  if (!heights.every((value) => Number.isInteger(value) && value >= 0 && value <= 20)) return null;

  const base = cells(heights);
  const drawBars = barsWillRender(heights);
  const frames: TraceFrame[] = [];
  // Water credited so far, per column. The overlays are rebuilt from this on
  // every frame, so the picture is cumulative: a student can see the pools
  // that are already settled while the markers keep closing in.
  const water = heights.map(() => 0);

  /**
   * The water, drawn under the columns that hold it, for the frames that have
   * no bars to float it over. A column that has been credited is always
   * outside the open span by the time it is credited, so these never overlap
   * the "still open" bracket.
   */
  const depthBrackets = (): TraceBracket[] =>
    water.flatMap((held, at) => (held > 0 ? [{ from: at, to: at, label: `+${held}` }] : []));

  const push = (
    id: string,
    caption: string,
    say: string,
    left: number,
    right: number,
    leftMax: number,
    rightMax: number,
    total: number,
    newest: number | null,
  ) => {
    const marks = new Map<number, TraceMark>();
    for (let at = 0; at < heights.length; at += 1) {
      marks.set(at, at < left || at > right ? "excluded" : "window");
    }
    marks.set(left, "active");
    marks.set(right, "active");
    const overlays: TraceOverlay[] = [];
    for (let at = 0; at < heights.length; at += 1) {
      if (water[at]! <= 0) continue;
      overlays.push({
        from: at,
        to: at,
        bottom: heights[at]!,
        top: heights[at]! + water[at]!,
        ...(at === newest ? { label: `+${water[at]}` } : {}),
      });
    }
    frames.push({
      id,
      caption,
      narrationIntent: say,
      state: {
        kind: "array",
        cells: marked(base, marks),
        pointers:
          left === right
            ? [{ name: "left", index: left }]
            : [{ name: "left", index: left }, { name: "right", index: right }],
        // Bars and cell indices share the band under the row with the pointer
        // arrows, so they cannot both be on. When the elevation map has a
        // zero column the renderer refuses the bars entirely, and the row
        // needs its indices back or nothing addresses the columns at all.
        ...(drawBars ? { bars: [...heights], overlays, showIndices: false } : { showIndices: true }),
        brackets: [
          { from: left, to: right, label: "open" },
          // Without bars there is no overlay either, and the water is the
          // whole lesson, so it comes back as a depth under each pool rather
          // than living only in the caption.
          ...(drawBars ? [] : depthBrackets()),
        ],
        note: `left max = ${leftMax}   right max = ${rightMax}   water = ${total}`,
      },
    });
  };

  let left = 0;
  let right = heights.length - 1;
  let leftMax = 0;
  let rightMax = 0;
  let total = 0;

  push(
    "start",
    `How much water sits on top of ${heights.length} columns?`.slice(0, 60),
    `Water above a column is decided by the tallest wall on each side: it fills to the lower of the two, minus the column itself. ` +
      `Two markers walk inward, and the shorter side is always the one that moves, because that side's answer is already pinned.`,
    left,
    right,
    leftMax,
    rightMax,
    total,
    null,
  );

  while (left < right && frames.length < RAIN_MAX_FRAMES - 1) {
    if (heights[left]! < heights[right]!) {
      const at = left;
      const height = heights[at]!;
      if (height >= leftMax) {
        leftMax = height;
        left += 1;
        push(
          `l${at}`,
          `Column ${at} is ${height}, a new left wall`.slice(0, 60),
          `The left column is ${height} and the right one is ${heights[right]}, so the left side is the shorter wall and the left marker moves. ` +
            `Nothing taller has been seen on the left, so column ${at} becomes the new left wall and holds no water itself.`,
          left,
          right,
          leftMax,
          rightMax,
          total,
          null,
        );
      } else {
        const held = leftMax - height;
        water[at] = held;
        total += held;
        left += 1;
        push(
          `l${at}`,
          `Column ${at} is ${height} under a wall of ${leftMax}: ${held} deep`.slice(0, 60),
          `Column ${at} stands at ${height} with a left wall of ${leftMax} behind it, and the right side is at least ${heights[right]}, which is taller. ` +
            `So the fill is decided by the left wall alone: ${leftMax} minus ${height} is ${held}, and the running total reaches ${total}.`,
          left,
          right,
          leftMax,
          rightMax,
          total,
          at,
        );
      }
    } else {
      const at = right;
      const height = heights[at]!;
      if (height >= rightMax) {
        rightMax = height;
        right -= 1;
        push(
          `r${at}`,
          `Column ${at} is ${height}, a new right wall`.slice(0, 60),
          `The right column is ${height} and the left one is ${heights[left]}, so the right side is the shorter or equal wall and the right marker moves. ` +
            `Column ${at} is the tallest seen from the right so far, so it becomes the new right wall and keeps nothing.`,
          left,
          right,
          leftMax,
          rightMax,
          total,
          null,
        );
      } else {
        const held = rightMax - height;
        water[at] = held;
        total += held;
        right -= 1;
        push(
          `r${at}`,
          `Column ${at} is ${height} under a wall of ${rightMax}: ${held} deep`.slice(0, 60),
          `Column ${at} stands at ${height} with a right wall of ${rightMax} beside it, and the left side is at least ${heights[left]}, which is taller. ` +
            `The right wall alone fixes the fill: ${rightMax} minus ${height} is ${held}, taking the running total to ${total}.`,
          left,
          right,
          leftMax,
          rightMax,
          total,
          at,
        );
      }
    }
  }

  const holders = water.flatMap((held, at) => (held > 0 ? [`${at} holds ${held}`] : []));
  const finalOverlays: TraceOverlay[] = water.flatMap((held, at) =>
    held > 0 ? [{ from: at, to: at, bottom: heights[at]!, top: heights[at]! + held, label: String(held) }] : [],
  );
  const finalMarks = new Map<number, TraceMark>();
  for (let at = 0; at < heights.length; at += 1) {
    finalMarks.set(at, water[at]! > 0 ? "active" : "done");
  }
  frames.push({
    id: "total",
    caption: `Total is ${total} units of water above the columns`.slice(0, 60),
    narrationIntent:
      `The markers have met, every column has been priced, and the pools add up to ${total}: ${holders.join(", ")}. ` +
      `Each column was visited once and no second pass over maxima was needed, so this is linear time in constant space.`,
    state: {
      kind: "array",
      cells: marked(base, finalMarks),
      ...(drawBars ? { bars: [...heights], overlays: finalOverlays, showIndices: false } : { showIndices: true }),
      brackets: drawBars || total === 0
        ? [{ from: 0, to: heights.length - 1, label: "all priced" }]
        : depthBrackets(),
      note: `water = ${total}`,
    },
  });

  if (frames.length < 2) return null;
  return {
    algorithmId: "trapping_rain_water_two_pointers",
    title: "Trapping rain water with two pointers",
    input: { heights },
    result: total,
    resultText: `${total} units of water`,
    frames,
  };
}

// --- 6. Best time to buy and sell stock, one pass (LeetCode 121). ---

export interface StockPricesInput {
  prices: number[];
}

const STOCK_MAX_FRAMES = 14;

export function simulateBestTimeToBuy(input: StockPricesInput): AlgorithmTrace | null {
  const prices = input.prices;
  if (prices.length < 4 || prices.length > 12) return null;
  if (!prices.every((price) => Number.isInteger(price) && price >= 1 && price <= 99)) return null;
  // The profit is drawn as the height between the cheapest day and today, so
  // a frame with no honest bar column has no figure left. Declining beats
  // drawing a row of digits and calling it a price chart.
  if (!barsWillRender(prices)) return null;

  const base = cells(prices);
  const frames: TraceFrame[] = [];
  let minIndex = 0;
  let best = 0;
  let bestBuy = 0;
  let bestSell = 0;

  for (let day = 0; day < prices.length && frames.length < STOCK_MAX_FRAMES - 1; day += 1) {
    const price = prices[day]!;
    // Day zero is a buy, never a sale: there is no earlier day to sell
    // against, and a frame reading "7 minus 7 is 0" would invite the student
    // to believe a same-day trade is one of the options being weighed.
    const cheaper = day === 0 || price < prices[minIndex]!;
    if (cheaper) minIndex = day;
    const profit = price - prices[minIndex]!;
    const improved = profit > best;
    if (improved) {
      best = profit;
      bestBuy = minIndex;
      bestSell = day;
    }

    const marks = new Map<number, TraceMark>();
    for (let at = 0; at < prices.length; at += 1) {
      marks.set(at, at > day ? "excluded" : "window");
    }
    marks.set(minIndex, "candidate");
    marks.set(day, "active");
    const overlays: TraceOverlay[] =
      profit > 0
        ? [{ from: minIndex, to: day, bottom: prices[minIndex]!, top: price, label: `+${profit}` }]
        : [];

    frames.push({
      id: `d${day}`,
      caption: cheaper
        ? day === 0
          ? `Day 0 costs ${price}, the only price seen so far`.slice(0, 60)
          : `Day ${day} costs ${price}, the cheapest yet`.slice(0, 60)
        : `Day ${day} sells at ${price}: ${price} minus ${prices[minIndex]} is ${profit}`.slice(0, 60),
      narrationIntent: cheaper
        ? day === 0
          ? `The walk opens on day 0 at ${price}. There is nothing before it to have bought at, so it is simply the cheapest day so far and the best profit is still 0.`
          : `Day ${day} costs ${price}, below every price before it, so it becomes the day to have bought on. ` +
            `Selling on it makes nothing, and the best so far stays ${best}. A cheaper buy can only ever help the days that come after it.`
        : `Selling on day ${day} at ${price} against the cheapest day so far, day ${minIndex} at ${prices[minIndex]}, is a profit of ${profit}. ` +
          (improved
            ? `That beats the previous best, so ${profit} is the number to carry forward.`
            : `The best stays ${best}, set earlier, so nothing is recorded here.`),
      state: {
        kind: "array",
        cells: marked(base, marks),
        pointers:
          minIndex === day
            ? [{ name: "day", index: day }]
            : [{ name: "buy", index: minIndex }, { name: "day", index: day }],
        bars: [...prices],
        overlays,
        // Bars turn the pointer arrows to the underside of the row, exactly
        // where the index labels sit, so the two would be drawn through each
        // other. The day number is in the caption and the note instead.
        showIndices: false,
        brackets:
          minIndex < day
            ? [{ from: minIndex, to: day, label: "hold" }]
            : [{ from: 0, to: day, label: "seen so far" }],
        note: `cheapest = ${prices[minIndex]}   best = ${best}`,
      },
    });
  }

  const finalMarks = new Map<number, TraceMark>();
  for (let at = 0; at < prices.length; at += 1) finalMarks.set(at, "excluded");
  if (best > 0) {
    finalMarks.set(bestBuy, "active");
    finalMarks.set(bestSell, "done");
  }
  frames.push({
    id: "best",
    caption:
      best > 0
        ? `Buy at ${prices[bestBuy]} on day ${bestBuy}, sell at ${prices[bestSell]}: profit ${best}`.slice(0, 60)
        : `Prices never rise, so the best profit is 0`,
    narrationIntent:
      best > 0
        ? `The best pair is day ${bestBuy} at ${prices[bestBuy]} and day ${bestSell} at ${prices[bestSell]}, a profit of ${best}. ` +
          `No pair of days was ever compared directly: each day only asked what the cheapest earlier day was, which is why one pass is enough.`
        : `Every price is at or below the one before it, so no sell day ever beats its buy day and the honest answer is zero. ` +
          `The scan still had to run to the end to know that, since a late rise would have changed it.`,
    state: {
      kind: "array",
      cells: marked(base, finalMarks),
      pointers:
        best > 0
          ? [{ name: "buy", index: bestBuy }, { name: "sell", index: bestSell }]
          : [{ name: "buy", index: 0 }],
      bars: [...prices],
      overlays:
        best > 0
          ? [{ from: bestBuy, to: bestSell, bottom: prices[bestBuy]!, top: prices[bestSell]!, label: `+${best}` }]
          : [],
      showIndices: false,
      brackets: best > 0 ? [{ from: bestBuy, to: bestSell, label: "hold" }] : [{ from: 0, to: prices.length - 1, label: "no rise" }],
      note: `answer = ${best}`,
    },
  });

  if (frames.length < 2) return null;
  return {
    algorithmId: "single_pass_min_tracking",
    title: "Best time to buy and sell stock",
    input: { prices },
    result: best,
    resultText: `profit ${best}`,
    frames,
  };
}
