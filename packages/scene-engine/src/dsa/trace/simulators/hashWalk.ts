/**
 * Hash sets, hash maps, counting, and the bucket table underneath them.
 *
 * These five share one teaching problem. The interesting state is not the
 * input at all: it is the set or the map beside it, and a lesson that only
 * draws the array leaves the tutor describing a structure the student never
 * sees. So every walk here puts the auxiliary structure on the board as ink,
 * pre-sized so its cells keep their addresses across frames, and spends the
 * frame `note` on the one thing a hash structure actually does: a lookup and
 * its verdict.
 *
 * Each simulator runs its algorithm twice: a silent dry run first, purely to
 * learn how many distinct keys the structure ends up holding, then the real
 * walk. That is not redundancy. `TraceAside` is pre-sized by contract, and a
 * row that grew a cell each time a key arrived would shift every id and make
 * the trace-versus-render check compare the wrong boxes.
 */
import {
  aside,
  cells,
  marked,
  type AlgorithmTrace,
  type ArrayFrameState,
  type GridFrameState,
  type TraceAside,
  type TraceCell,
  type TraceFrame,
  type TraceMark,
} from "../types";

/** Widest a pre-sized aside row may get before the board stops being readable. */
const MAX_KEYS = 8;

/* ------------------------------------------------------------------ */
/* Contains Duplicate (LC 217): a hash set, membership only.           */
/* ------------------------------------------------------------------ */

export interface ValueScanInput {
  values: number[];
}

export function simulateHashSetMembership(input: ValueScanInput): AlgorithmTrace | null {
  const values = input.values;
  if (values.length < 4 || values.length > 10) return null;
  if (values.some((value) => !Number.isFinite(value))) return null;

  // Dry run: how many keys does the set actually end up holding? The walk
  // stops at the first repeat, so sizing the row by the array's distinct
  // count would reserve slots the algorithm never fills.
  const stored: number[] = [];
  let hit = -1;
  let twin = -1;
  for (let i = 0; i < values.length; i += 1) {
    if (stored.includes(values[i]!)) {
      hit = i;
      twin = values.indexOf(values[i]!);
      break;
    }
    stored.push(values[i]!);
  }
  const capacity = Math.max(stored.length, 1);
  if (capacity > MAX_KEYS) return null;

  const base = cells(values);
  const frames: TraceFrame[] = [];

  // A set has keys and no values, so its cells carry the key alone. Writing
  // "1:true" beside them would invent a payload the structure does not hold
  // and blur the one distinction between a set and a map.
  const setRow = (count: number, lit: number | null): TraceAside =>
    aside(
      "seen",
      "seen",
      "row",
      stored.slice(0, count).map((value) => String(value)),
      capacity,
      lit === null || lit < 0 ? new Map() : new Map<number, TraceMark>([[lit, "active"]]),
    );

  frames.push({
    id: "input",
    caption: "Does any value appear twice?",
    narrationIntent:
      "Comparing every value against every other value is quadratic. A hash set answers \"have I met this before\" in one step, so a single left to right walk is enough: ask the set, then add.",
    state: {
      kind: "array",
      cells: base.map((cell) => ({ text: cell.text })),
      showIndices: true,
      note: "the set is empty",
      asides: [setRow(0, null)],
    },
  });

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]!;
    const duplicate = i === hit;
    const marks = new Map<number, TraceMark>();
    // Everything already in the set is ticked, so the drawn set and the
    // drawn array agree about what has been stored at every instant.
    for (let j = 0; j < i; j += 1) marks.set(j, "done");
    if (duplicate) marks.set(twin, "active");
    marks.set(i, "active");
    const count = duplicate ? stored.length : i + 1;
    frames.push({
      id: duplicate ? `hit${i}` : `add${i}`,
      caption: duplicate ? `${value} is already in the set` : `${value} is new, so it goes in the set`,
      narrationIntent: duplicate
        ? `Step ${i + 1}: ask the set whether it holds ${value}, and this time it does, because index ${twin} put it there. One lookup settles the whole question, so the walk stops without reading the rest of the array.`
        : `Step ${i + 1}: ask the set whether it holds ${value}. It does not, so nothing before index ${i} repeats it, and ${value} joins the set on its own, because membership is the only question a set answers.`,
      state: {
        kind: "array",
        cells: marked(base, marks),
        pointers: [{ name: "i", index: i }],
        showIndices: true,
        note: duplicate ? `look up ${value}  already in` : `look up ${value}  not there`,
        asides: [setRow(count, stored.indexOf(value))],
      },
    });
    if (duplicate) break;
  }

  const found = hit >= 0;
  // Every cell the walk actually read keeps its tick here. Marking only the
  // repeated pair would rub the ticks off the rest of the row between the
  // last step and the answer, and ink that disappears reads as a mistake.
  // Cells past an early exit stay bare because they were never looked at.
  const closing = new Map<number, TraceMark>();
  const scanned = found ? hit : values.length - 1;
  for (let j = 0; j <= scanned; j += 1) closing.set(j, "done");
  if (found) {
    closing.set(twin, "active");
    closing.set(hit, "active");
  }
  frames.push({
    id: "answer",
    caption: found
      ? `${values[hit]} repeats, so the answer is true`
      : `All ${values.length} are distinct, so the answer is false`,
    narrationIntent: found
      ? `The two washed cells hold the same value, at index ${twin} and index ${hit}, so the array is not distinct and the answer is true. Every value was looked at once and every lookup was constant, which makes the whole check linear.`
      : `The walk reached the end with every value new, so the set holds all ${values.length} of them and no value was ever met twice. The answer is false, and the price was one pass and one set the size of the array.`,
    state: {
      kind: "array",
      cells: marked(base, closing),
      showIndices: true,
      note: found ? `${values[hit]} at ${twin} and ${hit}` : `${capacity} keys, all new`,
      asides: [setRow(stored.length, null)],
    },
  });

  return {
    algorithmId: "hash_set_membership",
    title: "Contains duplicate with a hash set",
    input: { values },
    result: found,
    resultText: found ? `true, ${values[hit]} repeats` : `false, all ${values.length} distinct`,
    earlyExit: found && hit < values.length - 1,
    frames,
  };
}

/* ------------------------------------------------------------------ */
/* Valid Anagram (LC 242): one count map, added to and taken from.     */
/* ------------------------------------------------------------------ */

export interface TwoWordInput {
  a: string;
  b: string;
}

export function simulateHashMapCounting(input: TwoWordInput): AlgorithmTrace | null {
  const a = input.a.toLowerCase();
  const b = input.b.toLowerCase();
  if (!/^[a-z]+$/.test(a) || !/^[a-z]+$/.test(b)) return null;
  if (a.length < 3 || a.length > 8) return null;
  // Two strings of different lengths cannot be anagrams and the map never
  // gets touched, so there is no counting to watch. Declining sends the
  // lesson to the canonical example, which does teach the technique.
  if (a.length !== b.length) return null;

  const n = a.length;

  // One map, not two. The whole point of this solution is that a letter of s
  // and the same letter of t cancel, so a second map would draw two tables
  // the student then has to compare by eye.
  const order: string[] = [];
  for (let i = 0; i < n; i += 1) {
    for (const ch of [a[i]!, b[i]!]) if (!order.includes(ch)) order.push(ch);
  }
  if (order.length > MAX_KEYS) return null;

  const count = new Map<string, number>();
  const sBase = cells([...a]);
  const frames: TraceFrame[] = [];
  // How many slots of the pre-sized row are live. It only ever grows: a
  // per-step `indexOf` would shrink the row again the moment the walk
  // revisited an early key, and the map would appear to forget entries.
  let touched = 0;

  /** The count row, showing only the keys the walk has actually created. */
  const countRow = (touched: number, lit: readonly string[]): TraceAside => {
    const marks = new Map<number, TraceMark>();
    for (const key of lit) {
      const at = order.indexOf(key);
      if (at >= 0 && at < touched) marks.set(at, "active");
    }
    return aside(
      "count",
      "count",
      "row",
      order.slice(0, touched).map((key) => `${key}:${count.get(key) ?? 0}`),
      order.length,
      marks,
    );
  };

  /** The second string, drawn as its own row under the first. */
  const tRow = (activeIndex: number, doneBefore: number): TraceAside => {
    const marks = new Map<number, TraceMark>();
    for (let j = 0; j < doneBefore; j += 1) marks.set(j, "done");
    if (activeIndex >= 0) marks.set(activeIndex, "active");
    return aside("tstr", "t", "row", [...b], n, marks);
  };

  frames.push({
    id: "input",
    caption: "s on top, t below: are they the same letters?",
    narrationIntent:
      "An anagram uses exactly the same letters in a different order, so order is the one thing we must not look at. A map from letter to a running count throws the order away and keeps only what matters.",
    state: {
      kind: "array",
      cells: sBase.map((cell) => ({ text: cell.text })),
      showIndices: false,
      note: `${n} letters each`,
      asides: [tRow(-1, 0), countRow(0, [])],
    },
  });

  for (let i = 0; i < n; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    count.set(x, (count.get(x) ?? 0) + 1);
    count.set(y, (count.get(y) ?? 0) - 1);
    touched = Math.max(touched, order.indexOf(x) + 1, order.indexOf(y) + 1);
    const marks = new Map<number, TraceMark>();
    for (let j = 0; j < i; j += 1) marks.set(j, "done");
    marks.set(i, "active");
    const same = x === y;
    frames.push({
      id: `step${i}`,
      caption: same
        ? `${x} is added and taken straight back, net 0`
        : `s adds ${x}, t takes ${y} away`,
      // The index has to be in the narration: two steps of a word like
      // "abab" read the same pair of letters, and two frames that speak the
      // same sentence make the tutor repeat itself word for word.
      narrationIntent: same
        ? `Step ${i + 1}: both strings show ${x} here, so the count for ${x} goes up by one and straight back down. It ends at ${count.get(x)}, which is exactly what an anagram should do to every letter.`
        : `Step ${i + 1}: s contributes ${x} so its count rises to ${count.get(x)}, and t consumes ${y} so its count falls to ${count.get(y)}. A letter that is over supplied is positive and one that is over used is negative.`,
      state: {
        kind: "array",
        cells: marked(sBase, marks),
        pointers: [{ name: "i", index: i }],
        showIndices: false,
        note: `${x} adds 1  ${y} takes 1`,
        asides: [tRow(i, i), countRow(touched, same ? [x] : [x, y])],
      },
    });
  }

  const balanced = order.every((key) => (count.get(key) ?? 0) === 0);
  const offenders = order.filter((key) => (count.get(key) ?? 0) !== 0);
  const closing = new Map<number, TraceMark>();
  for (let j = 0; j < n; j += 1) closing.set(j, "done");
  frames.push({
    id: "answer",
    caption: balanced
      ? "All counts are 0, so the answer is true"
      : "Not every count is 0, so the answer is false",
    narrationIntent: balanced
      ? `Every key in the map reads zero, so each letter was supplied by s exactly as often as t used it. That is the definition of an anagram, and it took one pass and a map the size of the alphabet rather than sorting either string.`
      : `The map still holds ${offenders.map((key) => `${key} at ${count.get(key)}`).join(" and ")}, so the two strings disagree about how many of those letters they carry. One nonzero count is enough to refuse.`,
    state: {
      kind: "array",
      cells: marked(sBase, closing),
      showIndices: false,
      note: balanced ? "every count is 0" : "counts left over",
      asides: [tRow(-1, n), countRow(order.length, offenders)],
    },
  });

  return {
    algorithmId: "hash_map_counting",
    title: "Valid anagram with one count map",
    input: { s: a, t: b },
    result: balanced,
    resultText: balanced ? "true, all counts are 0" : "false, not every count is 0",
    frames,
  };
}

/* ------------------------------------------------------------------ */
/* Group Anagrams (LC 49): a map from a signature to a bucket of words.*/
/* ------------------------------------------------------------------ */

export interface WordListInput {
  words: string[];
}

function signatureOf(word: string): string {
  return [...word].sort().join("");
}

export function simulateHashMapGrouping(input: WordListInput): AlgorithmTrace | null {
  const words = input.words.map((word) => word.toLowerCase());
  if (words.length < 3 || words.length > 8) return null;
  if (words.some((word) => !/^[a-z]{1,6}$/.test(word))) return null;

  const signatures = words.map(signatureOf);
  const keys: string[] = [];
  for (const signature of signatures) if (!keys.includes(signature)) keys.push(signature);
  // Four keys is where the closing frame stops fitting its groups across the
  // board; beyond that the picture would be right and unreadable.
  if (keys.length > 4) return null;

  const membersOf = (key: string, upTo: number): number[] =>
    signatures.flatMap((signature, index) => (signature === key && index < upTo ? [index] : []));

  const base = cells(words);
  const frames: TraceFrame[] = [];

  /**
   * The key row carries the signature and how many words are behind it. The
   * words themselves cannot go here: "aet:eat,tea,ate" is far past the
   * sixteen characters a board label may hold, and a truncated cell would be
   * a wrong claim about the map rather than a small one.
   */
  const keyRow = (upTo: number, lit: string | null): TraceAside => {
    const live = keys.filter((key) => membersOf(key, upTo).length > 0);
    const marks = new Map<number, TraceMark>();
    if (lit !== null) {
      const at = live.indexOf(lit);
      if (at >= 0) marks.set(at, "active");
    }
    return aside(
      "sig",
      "keys",
      "row",
      live.map((key) => `${key}:${membersOf(key, upTo).length}`),
      keys.length,
      marks,
    );
  };

  frames.push({
    id: "input",
    caption: "Group the words that use the same letters",
    narrationIntent:
      "Two words are anagrams exactly when their letters sorted come out the same, so the sorted letters make a key that every member of a group shares. Then one pass drops each word into the bucket its key names.",
    state: {
      kind: "array",
      cells: base.map((cell) => ({ text: cell.text })),
      showIndices: false,
      note: "sort each word",
      asides: [keyRow(0, null)],
    },
  });

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    const key = signatures[i]!;
    const siblings = membersOf(key, i);
    const marks = new Map<number, TraceMark>();
    // Three meanings, three marks, and nothing ever loses its ink: a tick
    // means stored, a dashed outline means "same bucket as the word being
    // read", and the wash is the word being read. Ticking only the current
    // bucket made earlier ticks blink out whenever a new key appeared.
    for (let j = 0; j < i; j += 1) marks.set(j, "done");
    for (const index of siblings) marks.set(index, "candidate");
    marks.set(i, "active");
    frames.push({
      id: `word${i}`,
      caption: siblings.length > 0
        ? `${word} sorts to ${key}, already a key`
        : `${word} sorts to ${key}, a new key`,
      narrationIntent: siblings.length > 0
        ? `Step ${i + 1}: sorting ${word} gives ${key}, which the map already holds, so ${word} joins ${siblings.map((index) => words[index]!).join(" and ")} in that bucket. No word is ever compared with another word.`
        : `Step ${i + 1}: sorting ${word} gives ${key}, and the map has no such key yet, so a fresh bucket opens under ${key} with ${word} alone inside it.`,
      state: {
        kind: "array",
        cells: marked(base, marks),
        pointers: [{ name: "i", index: i }],
        showIndices: false,
        note: siblings.length > 0 ? `key ${key}  seen` : `key ${key}  new`,
        asides: [keyRow(i + 1, key)],
      },
    });
  }

  // The closing frame physically regroups the words into blocks, which is
  // the answer a student can read at a glance; a row of ticks beside a key
  // row would still leave them matching cells up by eye.
  const grouped = keys.map((key) => membersOf(key, words.length).map((index) => words[index]!));
  const flat = grouped.flat();
  frames.push({
    id: "groups",
    caption: `${keys.length} keys give ${keys.length} groups: ${keys.join(", ")}`,
    narrationIntent: `The map ended with ${keys.length} keys, so there are ${keys.length} groups: ${grouped
      .map((group, index) => `${keys[index]} holding ${group.join(" and ")}`)
      .join(", ")}. Each word was sorted once and stored once, so nothing quadratic ever happened.`,
    state: {
      kind: "array",
      cells: flat.map((word): TraceCell => ({ text: word, mark: "done" })),
      groups: grouped.map((group, index) => ({
        id: `g${index}`,
        label: keys[index]!,
        cells: group.map((word): TraceCell => ({ text: word, mark: "done" })),
      })),
      showIndices: false,
      note: `${words.length} words  ${keys.length} keys`,
      asides: [keyRow(words.length, null)],
    },
  });

  return {
    algorithmId: "hash_map_grouping",
    title: "Group anagrams with a hash map",
    input: { words },
    result: grouped,
    resultText: `${keys.length} groups: ${keys.join(", ")}`,
    frames,
  };
}

/* ------------------------------------------------------------------ */
/* Longest Palindrome (LC 409): counting letters, then pairing them.   */
/* ------------------------------------------------------------------ */

export interface CharCountInput {
  characters: string[];
}

export function simulateCharCountPairing(input: CharCountInput): AlgorithmTrace | null {
  const chars = input.characters;
  if (chars.length < 4 || chars.length > 12) return null;
  if (chars.some((ch) => !/^[A-Za-z]$/.test(ch))) return null;

  const order: string[] = [];
  for (const ch of chars) if (!order.includes(ch)) order.push(ch);
  if (order.length > MAX_KEYS) return null;

  const count = new Map<string, number>();
  const waiting = new Map<string, number>();
  const paired: number[] = [];
  const base = cells(chars);
  const frames: TraceFrame[] = [];
  /** Live slots in the count row; grows only, for the reason above. */
  let touched = 0;

  const countRow = (touched: number, lit: string | null): TraceAside => {
    const marks = new Map<number, TraceMark>();
    if (lit !== null) {
      const at = order.indexOf(lit);
      if (at >= 0 && at < touched) marks.set(at, "active");
    }
    return aside(
      "count",
      "count",
      "row",
      order.slice(0, touched).map((key) => `${key}:${count.get(key) ?? 0}`),
      order.length,
      marks,
    );
  };

  frames.push({
    id: "input",
    caption: "How long a palindrome can these letters build?",
    narrationIntent:
      "A palindrome reads the same both ways, so every letter in it needs a twin on the other side except for at most one in the very middle. That makes this a counting question and never a rearranging question.",
    state: {
      kind: "array",
      cells: base.map((cell) => ({ text: cell.text })),
      showIndices: false,
      note: "letter counts",
      asides: [countRow(0, null)],
    },
  });

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]!;
    const now = (count.get(ch) ?? 0) + 1;
    count.set(ch, now);
    const waitingAt = waiting.get(ch);
    const even = now % 2 === 0 && waitingAt !== undefined;
    const partner = even ? waitingAt! : -1;
    touched = Math.max(touched, order.indexOf(ch) + 1);
    const marks = new Map<number, TraceMark>();
    for (const index of paired) marks.set(index, "done");
    if (even) {
      // Both halves of the pair light up together, so the pairing is a
      // visible event rather than a number quietly changing in the map.
      marks.set(partner, "active");
      paired.push(i, partner);
      waiting.delete(ch);
    } else {
      waiting.set(ch, i);
    }
    marks.set(i, "active");
    const pairsSoFar = paired.length / 2;
    frames.push({
      id: `read${i}`,
      caption: even ? `${ch} completes pair ${pairsSoFar}` : `${ch} has an odd count now`,
      narrationIntent: even
        ? `Step ${i + 1}: this ${ch} brings its count to ${now}, an even number, so it pairs with the ${ch} at index ${partner}. That pair can sit either side of the middle, which is ${pairsSoFar * 2} letters banked.`
        : `Step ${i + 1}: this ${ch} takes its count to ${now}, an odd number, so it has no twin yet and stands alone until another ${ch} turns up or the string runs out.`,
      state: {
        kind: "array",
        cells: marked(base, marks),
        pointers: [{ name: "i", index: i }],
        showIndices: false,
        note: even ? `${ch} count ${now}  pair ${pairsSoFar}` : `${ch} count ${now}  odd`,
        asides: [countRow(touched, ch)],
      },
    });
  }

  const pairs = paired.length / 2;
  const leftovers = [...waiting.values()].sort((x, y) => x - y);
  const best = pairs * 2 + (leftovers.length > 0 ? 1 : 0);

  const pairMarks = new Map<number, TraceMark>();
  for (const index of paired) pairMarks.set(index, "done");
  for (const index of leftovers) pairMarks.set(index, "candidate");
  frames.push({
    id: "pairs",
    caption: `${pairs} pairs give ${pairs * 2} letters`,
    narrationIntent: `Reading the counts off the map, ${order
      .map((key) => `${key} appears ${count.get(key)} times`)
      .join(", ")}. Halving each count and doubling gives ${pairs} pairs, so ${pairs * 2} letters are certain. The dashed cells are the odd ones left over.`,
    state: {
      kind: "array",
      cells: marked(base, pairMarks),
      showIndices: false,
      note: `${pairs} pairs  ${pairs * 2} letters`,
      asides: [countRow(order.length, null)],
    },
  });

  const finalMarks = new Map<number, TraceMark>();
  for (const index of paired) finalMarks.set(index, "done");
  for (const [rank, index] of leftovers.entries()) finalMarks.set(index, rank === 0 ? "active" : "excluded");
  frames.push({
    id: "answer",
    caption: `The longest palindrome is ${best} letters long`,
    narrationIntent: leftovers.length > 0
      ? `Exactly one odd letter may go in the middle, and ${chars[leftovers[0]!]} takes that place, so ${pairs * 2} paired letters plus one centre gives ${best}. The other odd letters are struck out because a palindrome has only one middle.`
      : `Every letter paired off with nothing left over, so all ${best} of them can be used and no centre letter is needed. Note that we never built the palindrome itself, only counted what one could contain.`,
    state: {
      kind: "array",
      cells: marked(base, finalMarks),
      showIndices: false,
      note: leftovers.length > 0 ? `${pairs * 2} plus 1 centre` : `${best} letters used`,
      asides: [countRow(order.length, leftovers.length > 0 ? chars[leftovers[0]!]! : null)],
    },
  });

  return {
    algorithmId: "char_count_pairing",
    title: "Longest palindrome from letter counts",
    input: { characters: chars },
    result: best,
    resultText: `the longest palindrome is ${best}`,
    frames,
  };
}

/* ------------------------------------------------------------------ */
/* How a hash map works: keys, buckets, and a collision chained.       */
/* ------------------------------------------------------------------ */

export interface HashBucketInput {
  keys: number[];
  buckets: number;
}

const CHAIN_LABELS = ["1st", "2nd", "3rd", "4th"] as const;

export function simulateHashMapBuckets(input: HashBucketInput): AlgorithmTrace | null {
  const { keys, buckets } = input;
  if (buckets < 3 || buckets > 7) return null;
  if (keys.length < 3 || keys.length > 6) return null;
  if (keys.some((key) => !Number.isInteger(key) || key < 0 || key > 999)) return null;
  if (new Set(keys).size !== keys.length) return null;

  const table: number[][] = Array.from({ length: buckets }, () => []);
  for (const key of keys) table[key % buckets]!.push(key);
  const depth = Math.max(...table.map((chain) => chain.length));
  // A table where nothing collides draws a picture that says a hash map is a
  // labelled shelf, which is the misconception this lesson exists to fix.
  // Declining sends the ask to the canonical example, which does collide.
  const collisions = keys.length - table.filter((chain) => chain.length > 0).length;
  if (collisions < 1) return null;
  if (depth > CHAIN_LABELS.length) return null;

  const colLabels = CHAIN_LABELS.slice(0, depth);
  const rowLabels = table.map((_, index) => String(index));

  /** The table as it stands after `placed` keys have gone in. */
  const gridAt = (
    placed: number,
    marks: ReadonlyMap<string, TraceMark>,
  ): GridFrameState => {
    const partial: number[][] = Array.from({ length: buckets }, () => []);
    for (const key of keys.slice(0, placed)) partial[key % buckets]!.push(key);
    return {
      kind: "grid",
      rowLabels,
      colLabels: [...colLabels],
      cells: partial.map((chain, row) =>
        colLabels.map((_, column): TraceCell => {
          const value = chain[column];
          const mark = marks.get(`${row},${column}`);
          if (value === undefined) return { text: "" };
          return mark ? { text: String(value), mark } : { text: String(value) };
        }),
      ),
    };
  };

  const keyRow = (marks: ReadonlyMap<number, TraceMark>): ArrayFrameState => ({
    kind: "array",
    cells: marked(cells(keys), marks),
    showIndices: false,
  });

  const frames: TraceFrame[] = [];
  const stack = (
    placed: number,
    keyMarks: ReadonlyMap<number, TraceMark>,
    cellMarks: ReadonlyMap<string, TraceMark>,
    note: string,
  ) => ({
    kind: "stacked" as const,
    parts: [
      { state: keyRow(keyMarks), label: "keys" },
      { state: gridAt(placed, cellMarks), label: "buckets" },
    ],
    note,
  });

  frames.push({
    id: "setup",
    caption: `${keys.length} keys into ${buckets} buckets`,
    narrationIntent:
      "A hash map is an array of buckets plus a rule for turning a key into a bucket number. Here the rule is the remainder after dividing by the number of buckets, which is the simplest honest hash there is.",
    state: stack(0, new Map(), new Map(), `hash: key mod ${buckets}`),
  });

  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]!;
    const bucket = key % buckets;
    const slot = keys.slice(0, i).filter((earlier) => earlier % buckets === bucket).length;
    const occupant = table[bucket]!.slice(0, slot);
    const keyMarks = new Map<number, TraceMark>();
    for (let j = 0; j < i; j += 1) keyMarks.set(j, "done");
    keyMarks.set(i, "active");
    const cellMarks = new Map<string, TraceMark>([[`${bucket},${slot}`, "active"]]);
    frames.push({
      id: `put${i}`,
      caption: slot === 0
        ? `${key} mod ${buckets} = ${bucket}, and that bucket is free`
        : `${key} mod ${buckets} = ${bucket} too, so it chains on`,
      narrationIntent: slot === 0
        ? `Step ${i + 1}: ${key} divided by ${buckets} leaves ${bucket}, so ${key} belongs in bucket ${bucket}, and nothing is there yet, so it goes straight in. Finding it later will take one step.`
        : `Step ${i + 1}: ${key} also leaves ${bucket}, which already holds ${occupant.join(" and ")}. That is a collision, and chaining answers it by hanging ${key} off the back of the bucket instead of overwriting what is there.`,
      state: stack(
        i + 1,
        keyMarks,
        cellMarks,
        slot === 0 ? `${key} mod ${buckets} = ${bucket}  free` : `${key} mod ${buckets} = ${bucket}  taken`,
      ),
    });
  }

  // The lookup is the reason chaining is a correct answer and not merely a
  // way to avoid losing data: the bucket narrows the search, the chain
  // finishes it, and both halves have to be on the board for that to land.
  const deepest = table.findIndex((chain) => chain.length === depth);
  const chain = table[deepest]!;
  const target = chain[chain.length - 1]!;
  const lookupMarks = new Map<string, TraceMark>();
  for (let column = 0; column < chain.length; column += 1) {
    lookupMarks.set(`${deepest},${column}`, column === chain.length - 1 ? "active" : "excluded");
  }
  const lookupKeyMarks = new Map<number, TraceMark>();
  for (let j = 0; j < keys.length; j += 1) lookupKeyMarks.set(j, keys[j] === target ? "active" : "done");
  frames.push({
    id: "find",
    caption: `Find ${target}: hash to ${deepest}, then walk the chain`,
    narrationIntent: `Looking ${target} up runs the same hash, lands in bucket ${deepest}, and then compares along the chain: ${chain
      .slice(0, -1)
      .join(" and ")} do not match, and ${target} does. The bucket does the heavy work and the chain is short.`,
    state: stack(keys.length, lookupKeyMarks, lookupMarks, `${chain.length - 1} misses  then hit`),
  });

  const settled = new Map<number, TraceMark>();
  for (let j = 0; j < keys.length; j += 1) settled.set(j, "done");
  frames.push({
    id: "layout",
    caption: `${collisions} collisions: bucket ${deepest} chains ${chain.join(", ")}`,
    narrationIntent: `The finished table holds all ${keys.length} keys across ${buckets} buckets, with ${collisions} of them landing on a bucket that was already busy. Lookups stay near constant while the chains stay short, which is what a good hash and enough buckets buy you.`,
    state: stack(keys.length, settled, new Map(), `${keys.length} keys  ${collisions} clashes`),
  });

  return {
    algorithmId: "hash_map_buckets",
    title: "How a hash map stores keys",
    input: { keys, buckets },
    result: { buckets: table },
    resultText: `bucket ${deepest} chains ${chain.join(", ")}`,
    frames,
  };
}
