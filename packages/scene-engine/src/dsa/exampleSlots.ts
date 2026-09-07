/**
 * Pulling a concrete example out of a question.
 *
 * A LeetCode prompt carries its own example — `nums = [2,7,11,15], target =
 * 9`. Using it means the board shows the student's numbers rather than ours.
 * When the question states nothing usable we fall back to the family's
 * canonical example and say so: `exampleSource` travels with the trace so a
 * caller can tell "these are your numbers" from "here is a representative
 * case", which is the honesty distinction the archetype layer makes with
 * `SlotSource`.
 *
 * Two rules keep the parsers honest.
 *
 * **Scope before you parse.** Every parser looks inside the Input line of
 * Example 1 first. Taking the first bracket in the whole statement read the
 * *Output* list as the input on `[1,null,2,3]` (the null made the input fail),
 * so the board built a tree from the answer and taught the wrong traversal;
 * `value is 5` inside Example 2's prose became a search target. A statement
 * with no Example block (a textbook ask) falls back to the whole text.
 *
 * **Nothing guesses.** A malformed or oversized literal yields null and the
 * default is used; it never half-parses into a wrong example.
 */

export type ExampleSource = "question" | "default";

const MAX_ITEMS = 12;

/** Names a LeetCode statement uses for the main array. */
const ARRAY_KEYS = [
  "nums", "nums1", "nums2", "numbers", "arr", "array", "values", "height", "heights",
  "temperatures", "prices", "cost", "costs", "coins", "candidates", "piles", "weights",
  "head", "list1", "list2", "l1", "l2", "stones", "gas", "ratings",
];

/**
 * The Input line of Example 1, or the whole question when there is no example
 * block. Later examples and the constraints are deliberately out of scope.
 */
export function exampleInputSegment(question: string): string {
  const example = /\bExample\s*1\s*:?\s*([\s\S]*?)(?=\n\s*Example\s*\d\b|\n\s*Constraints?\s*:|$)/i.exec(question);
  if (!example) return question;
  const input = /\bInput\s*:?\s*([\s\S]*?)(?=\n\s*Output\b|\bOutput\s*:|$)/i.exec(example[1]!);
  return (input?.[1] ?? example[1]!).trim() || question;
}

/** Every example block's Input line, in order, then the whole question. */
export function exampleInputSegments(question: string): string[] {
  const segments: string[] = [];
  const pattern = /\bExample\s*\d*\s*:?\s*([\s\S]*?)(?=\n\s*Example\s*\d\b|\n\s*Constraints?\s*:|$)/gi;
  for (const match of question.matchAll(pattern)) {
    const input = /\bInput\s*:?\s*([\s\S]*?)(?=\n\s*Output\b|\bOutput\s*:|$)/i.exec(match[1]!);
    const text = (input?.[1] ?? match[1]!).trim();
    if (text) segments.push(text);
  }
  if (segments.length === 0) segments.push(question);
  return segments;
}

function numbersInBody(body: string): number[] | null {
  if (!/^[\s\d,.+-]+$/.test(body)) return null;
  const parts = body.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length < 3 || parts.length > MAX_ITEMS) return null;
  const values = parts.map((part) => Number(part));
  return values.some((value) => !Number.isFinite(value)) ? null : values;
}

/** `nums = [2,7,11,15]`, taking the first key that appears. */
export function parseNamedArray(text: string, names: readonly string[] = ARRAY_KEYS): number[] | null {
  for (const name of names) {
    const pattern = new RegExp(`\\b${name}\\s*=\\s*\\[([^\\][]{1,220})\\]`, "i");
    const match = pattern.exec(text);
    if (!match) continue;
    const values = numbersInBody(match[1]!);
    if (values) return values;
  }
  return null;
}

/**
 * First bracketed numeric list. Scoped to the Example 1 input first, so an
 * Output list can never stand in for the input.
 */
export function parseNumberArray(question: string): number[] | null {
  for (const scope of [exampleInputSegment(question), question]) {
    const named = parseNamedArray(scope);
    if (named) return named;
    for (const match of scope.matchAll(/\[([^\][]{1,220})\]/g)) {
      const values = numbersInBody(match[1]!);
      if (values) return values;
    }
    const chain = parseArrowChain(scope);
    if (chain) return chain;
    const built = parseConstructorSequence(scope);
    if (built) return built;
  }
  return null;
}

/**
 * A list built one node at a time: `ListNode(1)`, `head.next = ListNode(2)`.
 * Deliberately strict: three or more calls to the SAME single-integer
 * constructor, in source order.
 */
function parseConstructorSequence(text: string): number[] | null {
  const byName = new Map<string, number[]>();
  for (const match of text.matchAll(/\b([A-Z][A-Za-z0-9_]*)\s*\(\s*(-?\d{1,4})\s*\)/g)) {
    const name = match[1]!;
    const list = byName.get(name) ?? [];
    list.push(Number(match[2]));
    byName.set(name, list);
  }
  for (const values of byName.values()) {
    if (values.length < 3 || values.length > MAX_ITEMS) continue;
    if (values.some((value) => !Number.isFinite(value))) continue;
    return values;
  }
  return null;
}

/** `1 -> 2 -> 3 -> 4`, how a textbook ask writes a list. */
export function parseArrowChain(text: string): number[] | null {
  const match = /(-?\d{1,4}(?:\s*(?:->|→)\s*-?\d{1,4}){2,11})/.exec(text);
  if (!match) return null;
  const values = match[1]!.split(/\s*(?:->|→)\s*/).map((part) => Number(part.trim()));
  return values.every((value) => Number.isFinite(value)) ? values : null;
}

/** First bracketed list of short quoted or bare words, for string problems. */
export function parseStringArray(question: string): string[] | null {
  for (const scope of [exampleInputSegment(question), question]) {
    for (const match of scope.matchAll(/\[([^\][]{1,220})\]/g)) {
      const parts = match[1]!
        .split(",")
        .map((part) => part.trim().replace(/^["'“”]|["'“”]$/g, ""))
        .filter((part) => part.length > 0);
      if (parts.length < 3 || parts.length > MAX_ITEMS) continue;
      if (parts.some((part) => part.length > 6 || !/^[A-Za-z0-9]+$/.test(part))) continue;
      return parts;
    }
  }
  return null;
}

/**
 * `target = 9`, `k = 3`. On a statement the keyed form only: "The root node's
 * value is 5" inside an explanation used to become a search target.
 */
export function parseNamedNumber(question: string, names: readonly string[]): number | null {
  const scoped = exampleInputSegment(question);
  for (const name of names) {
    const keyed = new RegExp(`\\b${name}\\s*=\\s*(-?\\d{1,4})\\b`, "i").exec(scoped);
    if (keyed) {
      const value = Number(keyed[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  // Prose forms are for textbook asks, which carry no Input line at all.
  if (scoped !== question) return null;
  for (const name of names) {
    const pattern = new RegExp(`\\b${name}\\b\\s*(?:=|is|of|:)\\s*(-?\\d{1,4})\\b`, "i");
    const match = pattern.exec(question);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  const sumsTo = /\b(?:sums?|adds?\s+up)\s+to\s+(-?\d{1,4})\b/i.exec(question);
  if (sumsTo && names.includes("target")) {
    const value = Number(sumsTo[1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

/** "search for 23 in", "find 23 in" — how a textbook ask states a target. */
export function parseSearchTarget(question: string): number | null {
  const match = /\b(?:search(?:ing)?|look(?:ing)?)\s+for\s+(?:the\s+)?(?:value\s+|key\s+|number\s+)?(-?\d{1,4})\b|\bfind\s+(?:the\s+)?(?:value\s+|key\s+|number\s+)?(-?\d{1,4})\s+in\b/i.exec(question);
  if (!match) return null;
  const value = Number(match[1] ?? match[2]);
  return Number.isFinite(value) ? value : null;
}

/**
 * `fib(6)`, `factorial(4)`, `climbStairs(5)`. A textbook ask states its
 * example as a call rather than as an assignment, and `parseNamedNumber`
 * only looks for the keyed and prose forms. Without this, "explain dynamic
 * programming and memoization using fib(6)" fell through to the canonical
 * example and the board walked a different number from the question.
 */
export function parseCallArgument(question: string, names: readonly string[]): number | null {
  for (const name of names) {
    const match = new RegExp(`\\b${name}\\s*\\(\\s*(-?\\d{1,4})\\s*\\)`, "i").exec(question);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

/**
 * The two nodes an ancestor question asks about: `p = 2, q = 8` in a
 * LeetCode Input line, or "of 1 and 6" in a textbook ask.
 *
 * The keyed form is tried first and scoped by `parseNamedNumber`, so a stray
 * "p" in an explanation cannot become a target. The prose form is deliberately
 * narrow: two numbers joined by "and" directly after "nodes", "of" or
 * "between". Anything looser reads "a tree of 7 and 9 levels" as a pair.
 */
export function parseNodePair(question: string): { p: number; q: number } | null {
  const keyedP = parseNamedNumber(question, ["p"]);
  const keyedQ = parseNamedNumber(question, ["q"]);
  if (keyedP !== null && keyedQ !== null && keyedP !== keyedQ) {
    return { p: keyedP, q: keyedQ };
  }
  const scoped = exampleInputSegment(question);
  for (const scope of scoped === question ? [question] : [scoped, question]) {
    const match =
      /\bnodes?\s+(-?\d{1,4})\s+and\s+(-?\d{1,4})\b|\b(?:of|between)\s+(-?\d{1,4})\s+and\s+(-?\d{1,4})\b/i.exec(scope);
    if (!match) continue;
    const a = Number(match[1] ?? match[3]);
    const b = Number(match[2] ?? match[4]);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return { p: a, q: b };
  }
  return null;
}

/**
 * `nums1 = [1,2,3,0,0,0], m = 3, nums2 = [2,5,6], n = 3`: the in-place merge
 * statement, which is the only one that names two arrays AND the count of
 * real values in the first. Taking the first bracketed list would read nums1
 * and then guess at m, and a wrong m draws a board that overwrites live
 * values, so either all three slots are read or none are.
 */
export function parseMergeSlots(
  question: string,
): { first: number[]; m: number; second: number[] } | null {
  const scope = exampleInputSegment(question);
  const first = parseNamedArray(scope, ["nums1"]);
  const second = parseNamedArray(scope, ["nums2"]);
  const m = parseNamedNumber(question, ["m"]);
  if (!first || !second || m === null) return null;
  if (m < 0 || m > first.length || first.length !== m + second.length) return null;
  return { first, m, second };
}

/** `insert 8, 3, 10, 1, 6, 14` — a build-a-tree ask. */
export function parseInsertSequence(question: string): number[] | null {
  const match = /\binsert(?:ing)?\s+((?:-?\d{1,4}\s*,\s*){2,}-?\d{1,4})/i.exec(question);
  if (!match) return null;
  const values = match[1]!.split(",").map((part) => Number(part.trim()));
  return values.length >= 3 && values.length <= MAX_ITEMS && values.every(Number.isFinite) ? values : null;
}

/**
 * `root = [3,9,20,null,null,15,7]` in LeetCode's compact form, converted to
 * the heap-indexed array the tree builder expects.
 *
 * The two formats agree only when no null has descendants. LeetCode lists the
 * children of non-null nodes only, so `[1,null,2,3]` means 3 is the left child
 * of 2, while heap indexing would put 3 under a missing node and the builder
 * rejects it.
 */
export function parseLevelOrder(question: string, names: readonly string[] = ["root", "tree"]): Array<number | null> | null {
  for (const scope of [exampleInputSegment(question), question]) {
    for (const name of names) {
      const match = new RegExp(`\\b${name}\\s*=\\s*\\[([^\\][]{1,220})\\]`, "i").exec(scope);
      if (!match) continue;
      const tokens = match[1]!.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
      if (tokens.length === 0 || tokens.length > 24) continue;
      const parsed = tokens.map((token) => (/^(?:null|#)$/i.test(token) ? null : Number(token)));
      if (parsed[0] === null || parsed.some((value) => value !== null && !Number.isFinite(value))) continue;
      const heap = leetcodeLevelOrderToHeap(parsed);
      if (heap) return heap;
    }
  }
  return null;
}

function leetcodeLevelOrderToHeap(tokens: ReadonlyArray<number | null>): Array<number | null> | null {
  const present = tokens.filter((value) => value !== null).length;
  if (present < 3 || present > 9) return null;
  const heap: Array<number | null> = [tokens[0]!];
  const queue = [0];
  let cursor = 1;
  while (queue.length > 0 && cursor < tokens.length) {
    const parent = queue.shift()!;
    for (const side of [1, 2]) {
      if (cursor >= tokens.length) break;
      const value = tokens[cursor];
      cursor += 1;
      const index = 2 * parent + side;
      if (index > 4000) return null;
      while (heap.length <= index) heap.push(null);
      heap[index] = value ?? null;
      if (value !== null) queue.push(index);
    }
  }
  return heap.length > 0 ? heap : null;
}

/** `grid = [["1","1","0"],["0","1","0"]]` or a numeric matrix. */
export function parseMatrix(
  question: string,
  names: readonly string[] = ["grid", "board", "image", "matrix", "isConnected", "obstacleGrid"],
): string[][] | null {
  for (const scope of [exampleInputSegment(question), question]) {
    for (const name of names) {
      const match = new RegExp(`\\b${name}\\s*=\\s*\\[\\s*((?:\\[[^\\][]*\\]\\s*,?\\s*)+)\\]`, "i").exec(scope);
      if (!match) continue;
      const rows: string[][] = [];
      for (const row of match[1]!.matchAll(/\[([^\][]*)\]/g)) {
        const cells = row[1]!
          .split(",")
          .map((part) => part.trim().replace(/^["'“”]|["'“”]$/g, ""))
          .filter((part) => part.length > 0);
        if (cells.length === 0 || cells.some((cell) => cell.length > 3)) return null;
        rows.push(cells);
      }
      if (rows.length < 2 || rows.length > 8) continue;
      if (rows.some((row) => row.length !== rows[0]!.length || row.length > 8)) continue;
      return rows;
    }
  }
  return null;
}

/** `prerequisites = [[1,0],[2,0]]`, `edges = [[1,2]]`, `intervals = [[1,3]]`. */
export function parsePairs(
  question: string,
  names: readonly string[] = ["prerequisites", "edges", "connections", "pairs", "intervals", "points"],
): Array<[number, number]> | null {
  for (const scope of [exampleInputSegment(question), question]) {
    for (const name of names) {
      const match = new RegExp(`\\b${name}\\s*=\\s*\\[\\s*((?:\\[[^\\][]*\\]\\s*,?\\s*)+)\\]`, "i").exec(scope);
      if (!match) continue;
      const pairs: Array<[number, number]> = [];
      for (const row of match[1]!.matchAll(/\[([^\][]*)\]/g)) {
        const parts = row[1]!.split(",").map((part) => Number(part.trim()));
        if (parts.length !== 2 || parts.some((value) => !Number.isFinite(value))) return null;
        pairs.push([parts[0]!, parts[1]!]);
      }
      if (pairs.length < 1 || pairs.length > 14) continue;
      return pairs;
    }
  }
  return null;
}

/** `times = [[2,1,1],[2,3,1]]` — a weighted directed edge list. */
export function parseTriples(
  question: string,
  names: readonly string[] = ["times", "edges", "flights", "roads"],
): Array<[number, number, number]> | null {
  for (const scope of [exampleInputSegment(question), question]) {
    for (const name of names) {
      const match = new RegExp(`\\b${name}\\s*=\\s*\\[\\s*((?:\\[[^\\][]*\\]\\s*,?\\s*)+)\\]`, "i").exec(scope);
      if (!match) continue;
      const triples: Array<[number, number, number]> = [];
      for (const row of match[1]!.matchAll(/\[([^\][]*)\]/g)) {
        const parts = row[1]!.split(",").map((part) => Number(part.trim()));
        if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) return null;
        triples.push([parts[0]!, parts[1]!, parts[2]!]);
      }
      if (triples.length < 2 || triples.length > 14) continue;
      return triples;
    }
  }
  return null;
}

/**
 * `graph = [[1,2,3],[0,2],[0,1,3],[0,2]]`: a list of neighbour lists, the
 * row's position being the node id.
 *
 * `parsePairs` and `parseTriples` both demand a fixed row width, which an
 * adjacency list does not have: a node with three neighbours and a node with
 * none sit in the same literal, and an empty row is meaningful rather than
 * malformed. The two symmetry checks are what keep this from accepting a
 * literal that looks the same and means something else: Clone Graph's
 * `adjList = [[2,4],[1,3],[2,4],[1,3]]` is 1-indexed, so node 3 names node 4
 * that has no row, and it is refused rather than silently drawn one node short.
 */
export function parseAdjacencyList(
  question: string,
  names: readonly string[] = ["graph", "adjList", "adjacency"],
): number[][] | null {
  for (const scope of [exampleInputSegment(question), question]) {
    for (const name of names) {
      const match = new RegExp(`\\b${name}\\s*=\\s*\\[\\s*((?:\\[[^\\][]*\\]\\s*,?\\s*)+)\\]`, "i").exec(scope);
      if (!match) continue;
      const rows: number[][] = [];
      for (const row of match[1]!.matchAll(/\[([^\][]*)\]/g)) {
        const body = row[1]!.trim();
        if (body.length === 0) {
          rows.push([]);
          continue;
        }
        const parts = body.split(",").map((part) => Number(part.trim()));
        if (parts.some((value) => !Number.isInteger(value) || value < 0 || value > 99)) return null;
        rows.push(parts);
      }
      if (rows.length < 2 || rows.length > 8) continue;
      // A node may not name itself or a node with no row of its own, and the
      // list has to agree with itself both ways round.
      if (rows.some((row, node) => row.some((other) => other === node || other >= rows.length))) return null;
      if (rows.some((row, node) => row.some((other) => !rows[other]!.includes(node)))) return null;
      return rows;
    }
  }
  return null;
}

/** `s = "abcabcbb"`, `text1 = "abcde"`. */
export function parseNamedString(question: string, names: readonly string[]): string | null {
  for (const scope of [exampleInputSegment(question), question]) {
    for (const name of names) {
      const match = new RegExp(`\\b${name}\\s*=\\s*["'“”]([^"'“”]{1,40})["'“”]`, "i").exec(scope);
      if (match) return match[1]!;
    }
  }
  return null;
}

/**
 * Two short words for the two-string DP families, keyed when the statement
 * names them. Taking the first two quoted words anywhere read the prose
 * sentence before Example 1 and swapped the axes.
 */
export function parseStringPair(question: string): { a: string; b: string } | null {
  for (const [first, second] of [["text1", "text2"], ["word1", "word2"], ["s", "t"], ["s1", "s2"]] as const) {
    const a = parseNamedString(question, [first]);
    const b = parseNamedString(question, [second]);
    if (a && b && a.length >= 2 && b.length >= 2) return { a, b };
  }
  const scoped = exampleInputSegment(question);
  const quoted = [...scoped.matchAll(/["'“”]([A-Za-z]{2,6})["'“”]/g)].map((match) => match[1]!);
  if (quoted.length >= 2) return { a: quoted[0]!, b: quoted[1]! };
  return null;
}

/** The letters of a short quoted string, for character-level array work. */
export function parseCharacters(question: string): string[] | null {
  const named = parseNamedString(question, ["s", "str", "word", "text"]);
  if (named && /^[A-Za-z]{4,12}$/.test(named)) return [...named];
  const scoped = exampleInputSegment(question);
  const quoted = /["'“”]([A-Za-z]{4,12})["'“”]/.exec(scoped) ?? /["'“”]([A-Za-z]{4,12})["'“”]/.exec(question);
  return quoted ? [...quoted[1]!] : null;
}

/**
 * `digits = "23"`, or the prose form "the digits 34".
 *
 * A phone keypad question states its input as a short quoted string rather
 * than an array, so none of the array parsers can see it. The pattern is
 * deliberately narrow: only 2 through 9, at most four of them, because 1 and
 * 0 carry no letters and five digits is a tree no board can letter. Anything
 * else yields null and the family draws its canonical example instead, which
 * is the same honesty rule the rest of this file follows.
 */
export function parsePhoneDigits(question: string): string | null {
  const named = parseNamedString(question, ["digits"]);
  if (named && /^[2-9]{1,4}$/.test(named)) return named;
  for (const scope of [exampleInputSegment(question), question]) {
    // "digits from 2-9 inclusive" in the prose must not read as the input, so
    // nothing may sit between the word and the run of digits.
    const bare = /\bdigits?\s*(?:=|:|is|are)?\s*["'“”]?([2-9]{1,4})["'“”]?(?![\w.])/i.exec(scope);
    if (bare) return bare[1]!;
  }
  return null;
}

/**
 * `insert("apple")`, `search("app")` — the design-class statements state their
 * example as method calls rather than as a list, and every list parser misses
 * it: the first bracket on LC 208 is the method-name array, and "startsWith"
 * is 10 characters so `parseStringArray` rejects the row outright.
 *
 * Inserts and searches are kept apart because they are different slots. The
 * search falls back to the last inserted word so a statement that only inserts
 * still yields a complete example rather than half of one.
 */
export function parseTrieWords(question: string): { words: string[]; search: string } | null {
  const inserted: string[] = [];
  const searched: string[] = [];
  for (const match of question.matchAll(
    /\b(insert|search|startsWith)\s*\(\s*["'“”]([A-Za-z]{1,12})["'“”]\s*\)/g,
  )) {
    const word = match[2]!.toLowerCase();
    const bucket = match[1] === "insert" ? inserted : searched;
    if (!bucket.includes(word)) bucket.push(word);
  }
  if (inserted.length < 2 || inserted.length > 4) return null;
  const search = searched.find((word) => word.length >= 2) ?? inserted[inserted.length - 1]!;
  return { words: inserted, search };
}

/** A short bracketed list, allowing the one and two element cases. */
function shortNumberList(body: string): number[] | null {
  if (!/^[\s\d,.+-]*$/.test(body)) return null;
  const parts = body.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length < 1 || parts.length > 8) return null;
  const values = parts.map((part) => Number(part));
  return values.some((value) => !Number.isFinite(value)) ? null : values;
}

/**
 * `list1 = [1,2,4], list2 = [1,3,4]` — the two-list statements.
 *
 * `parseNumberArray` returns whichever list it meets first, so a family that
 * needs both used to get one list twice or one list and the default. The keyed
 * form is tried inside the Example 1 input first, then the whole question, and
 * a textbook ask that writes two arrow chains is read as its two lists.
 * `numbersInBody` is not reused because it demands three or more values and
 * `list2 = [0]` is a legal input to a merge.
 */
export function parseListPair(question: string): { first: number[]; second: number[] } | null {
  const pairs = [["list1", "list2"], ["l1", "l2"], ["a", "b"], ["headA", "headB"]] as const;
  for (const scope of [exampleInputSegment(question), question]) {
    for (const [left, right] of pairs) {
      const first = new RegExp(`\\b${left}\\s*=\\s*\\[([^\\][]{0,120})\\]`, "i").exec(scope);
      const second = new RegExp(`\\b${right}\\s*=\\s*\\[([^\\][]{0,120})\\]`, "i").exec(scope);
      if (!first || !second) continue;
      const a = shortNumberList(first[1]!);
      const b = shortNumberList(second[1]!);
      if (a && b && a.length > 0 && b.length > 0) return { first: a, second: b };
    }
    // "merge 1 -> 2 -> 4 and 1 -> 3 -> 4", how a textbook ask writes it.
    const chains = [...scope.matchAll(/(-?\d{1,4}(?:\s*(?:->|→)\s*-?\d{1,4}){1,7})/g)].map((match) =>
      match[1]!.split(/\s*(?:->|→)\s*/).map((part) => Number(part.trim())),
    );
    if (chains.length >= 2 && chains.every((chain) => chain.every((value) => Number.isFinite(value)))) {
      return { first: chains[0]!, second: chains[1]! };
    }
  }
  return null;
}

/**
 * "remove the 2nd node from the end" — a textbook ask states n as an ordinal
 * in prose and writes no `n = 2` anywhere, so `parseNamedNumber` finds nothing
 * and the board would walk the canned example while the student watches their
 * own list.
 */
export function parseNthFromEnd(question: string): number | null {
  const match = /\b(?:remove|delete|drop)\s+the\s+(\d{1,2})(?:st|nd|rd|th)\s+(?:node|element)\s+from\s+the\s+end\b/i.exec(question);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 1 ? value : null;
}

/**
 * `lists = [[1,4,5],[1,3,4],[2,6]]` — rows of numbers that need not be the
 * same length.
 *
 * `parseMatrix` rejects a ragged literal, and `parsePairs` and `parseTriples`
 * each fix the row width, so a k-way merge statement parsed as nothing and
 * the board drew the canned lists while the student read their own.
 */
export function parseNumberLists(
  question: string,
  names: readonly string[] = ["lists", "arrays", "nums"],
): number[][] | null {
  for (const scope of [exampleInputSegment(question), question]) {
    for (const name of names) {
      const match = new RegExp(`\\b${name}\\s*=\\s*\\[\\s*((?:\\[[^\\][]*\\]\\s*,?\\s*)+)\\]`, "i").exec(scope);
      if (!match) continue;
      const rows: number[][] = [];
      for (const row of match[1]!.matchAll(/\[([^\][]*)\]/g)) {
        const parts = row[1]!.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
        if (parts.length === 0 || parts.length > MAX_ITEMS) return null;
        const values = parts.map((part) => Number(part));
        if (values.some((value) => !Number.isFinite(value))) return null;
        rows.push(values);
      }
      if (rows.length < 2 || rows.length > 6) continue;
      return rows;
    }
  }
  return null;
}

/**
 * `insert 15`, `push 7`, `add the value 15` — one value going into a
 * structure. The lookahead is what separates it from `parseInsertSequence`:
 * "insert 5, 3, 8, 1" is a build order, not a single insert, and reading its
 * first number as the inserted value would have drawn a heap the question
 * never described.
 */
export function parseInsertValue(question: string): number | null {
  const match = /\b(?:insert|push|add)\s+(?:the\s+)?(?:value\s+|key\s+|number\s+)?(-?\d{1,4})\b(?!\s*,\s*-?\d)/i.exec(question);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export interface WeightedEdge {
  from: string;
  to: string;
  weight: number;
}

/**
 * Letter edges like `A-B 4`, `A->C`, `(A,B,4)`. The weight is optional: an
 * unweighted traversal question writes "A-B, A-C, B-D" and used to parse as
 * nothing, so the board drew the default weighted graph and labelled every
 * edge with a number the question never mentioned.
 */
export function parseLetterEdges(question: string): Array<{ from: string; to: string; weight?: number }> | null {
  const found: Array<{ from: string; to: string; weight?: number }> = [];
  const pattern = /\(?\s*([A-Z])\s*(?:->|→|[,\-–—])\s*([A-Z])\s*(?:[,:\s]\s*(\d{1,3})\b)?\s*\)?/g;
  for (const match of question.matchAll(pattern)) {
    const from = match[1]!;
    const to = match[2]!;
    if (from === to) continue;
    const weight = match[3] === undefined ? undefined : Number(match[3]);
    if (weight !== undefined && (!Number.isFinite(weight) || weight < 0)) continue;
    found.push(weight === undefined ? { from, to } : { from, to, weight });
    if (found.length > 14) return null;
  }
  return found.length >= 2 ? found : null;
}

/** Letter edges that all carry a weight, for the weighted families. */
export function parseWeightedEdges(question: string): WeightedEdge[] | null {
  const edges = parseLetterEdges(question);
  if (!edges) return null;
  const weighted = edges.filter((edge): edge is WeightedEdge => typeof edge.weight === "number");
  return weighted.length >= 3 && weighted.length === edges.length ? weighted : null;
}

/** `starting from A`, `start at 2`, `k = 2`. */
export function parseStartNode(question: string): string | null {
  const match = /\bstart(?:ing|s)?\s+(?:from|at)\s+(?:node\s+|vertex\s+)?([A-Z]|\d{1,2})\b/i.exec(question);
  return match ? match[1]!.toUpperCase() : null;
}

/**
 * `s = "()[]{}"` — a bracket string, scoped to the Example 1 input first.
 *
 * Deliberately requires two or more bracket characters inside one pair of
 * quotes. LC 20's own prose lists the alphabet as `'(', ')', '{', '}'` in
 * single-character quotes, and taking the first quoted thing anywhere would
 * walk a one-character string that the simulator then declines.
 */
export function parseBracketString(question: string): string[] | null {
  for (const scope of [exampleInputSegment(question), question]) {
    const named = /\bs\s*=\s*["'“”]([()[\]{}]{2,10})["'“”]/.exec(scope);
    if (named) return [...named[1]!];
    const quoted = /["'“”]([()[\]{}]{2,10})["'“”]/.exec(scope);
    if (quoted) return [...quoted[1]!];
  }
  return null;
}

/** One call from a LeetCode design problem's operation list. */
export interface DesignCall {
  name: string;
  args: number[];
}

/**
 * A LeetCode design problem states its example as two parallel lists:
 *
 *   ["MinStack","push","push","push","getMin","pop","top","getMin"]
 *   [[],[-2],[0],[-3],[],[],[],[]]
 *
 * The first entry of each is the constructor, which takes no arguments and
 * returns nothing, so it is dropped and the rest are zipped. The two lists
 * must line up exactly: a half-parsed call list would put the wrong value on
 * the board against the right operation name, which is the failure this whole
 * layer exists to prevent.
 *
 * Scoped by the class name rather than by position, so a statement that
 * mentions several bracketed lists cannot hand back the output list.
 */
export function parseDesignCalls(question: string, className: string): DesignCall[] | null {
  const names = new RegExp(`\\[\\s*["'“”]${className}["'“”]\\s*,\\s*([^\\][]{1,300})\\]`, "i").exec(question);
  if (!names) return null;
  const calls = names[1]!
    .split(",")
    .map((part) => part.trim().replace(/^["'“”]|["'“”]$/g, ""))
    .filter((part) => part.length > 0);
  if (calls.length < 2 || calls.length > 14) return null;
  if (calls.some((call) => !/^[A-Za-z]{2,10}$/.test(call))) return null;

  // The argument list is the next list-of-lists after the call list.
  const rest = question.slice(names.index + names[0]!.length);
  const argsMatch = /\[\s*((?:\[[^\][]*\]\s*,?\s*)+)\]/.exec(rest);
  if (!argsMatch) return null;
  const groups: number[][] = [];
  for (const row of argsMatch[1]!.matchAll(/\[([^\][]*)\]/g)) {
    const body = row[1]!.trim();
    if (body.length === 0) {
      groups.push([]);
      continue;
    }
    const parts = body.split(",").map((part) => Number(part.trim()));
    if (parts.some((value) => !Number.isFinite(value))) return null;
    groups.push(parts);
  }
  // groups[0] is the constructor's own empty argument list.
  if (groups.length !== calls.length + 1) return null;
  return calls.map((name, index) => ({ name, args: groups[index + 1]! }));
}

/** `factorial(4)`, `factorial of 5`, `4!`, `n = 4`. */
export function parseFactorialArgument(question: string): number | null {
  const call = /\bfactorial\s*\(\s*(\d{1,2})\s*\)/i.exec(question);
  if (call) return Number(call[1]);
  const prose = /\bfactorial\s+of\s+(\d{1,2})\b/i.exec(question);
  if (prose) return Number(prose[1]);
  const bang = /\b(\d{1,2})\s*!/.exec(question);
  if (bang) return Number(bang[1]);
  return parseNamedNumber(question, ["n"]);
}

/**
 * `with the values 1, 2, 3` — how a textbook ask writes a short list when it
 * writes no brackets at all. `parseNumberArray` needs a literal or an arrow
 * chain and finds nothing here, so the board fell back to the canned example
 * while the student was looking at their own numbers in the question.
 */
export function parseLooseNumberList(
  question: string,
  names: readonly string[] = ["values", "elements", "items", "numbers", "keys"],
): number[] | null {
  for (const name of names) {
    const match = new RegExp(`\\b${name}\\s+((?:-?\\d{1,3}\\s*,\\s*){1,5}-?\\d{1,3})\\b`, "i").exec(question);
    if (!match) continue;
    const values = match[1]!.split(",").map((part) => Number(part.trim()));
    if (values.length >= 2 && values.length <= 6 && values.every((value) => Number.isFinite(value))) return values;
  }
  return null;
}

/**
 * `keys 12, 7, 22, 3` — a bare comma list written after the noun that names
 * it. A textbook ask states its example in prose ("inserting the keys 12, 7,
 * 22, 3 into a table with 5 buckets"), so there is no bracket for
 * `parseNumberArray` to find and the family would silently fall back to its
 * canonical example while claiming the student's own.
 *
 * Anchored on the noun rather than taking any comma list, so a sentence about
 * something else in the same question cannot supply the keys.
 */
export function parseKeyList(
  question: string,
  names: readonly string[] = ["keys", "values", "numbers", "items"],
): number[] | null {
  for (const name of names) {
    const pattern = new RegExp(`\\b${name}\\b\\s*:?\\s*((?:-?\\d{1,4}\\s*,\\s*){2,}-?\\d{1,4})`, "i");
    const match = pattern.exec(question);
    if (!match) continue;
    const values = match[1]!.split(",").map((part) => Number(part.trim()));
    if (values.length < 3 || values.length > MAX_ITEMS) continue;
    if (values.some((value) => !Number.isFinite(value))) continue;
    return values;
  }
  return null;
}

/**
 * A count written either side of the noun it counts: `5 buckets`, `a table
 * with 5 buckets`, `buckets = 8`, `slots: 4`. `parseNamedNumber` only reads
 * the keyed form, which English prose almost never uses for a table size.
 */
export function parseCountedNoun(question: string, nouns: readonly string[]): number | null {
  for (const noun of nouns) {
    const before = new RegExp(`\\b(\\d{1,3})\\s+${noun}\\b`, "i").exec(question);
    if (before) {
      const value = Number(before[1]);
      if (Number.isFinite(value)) return value;
    }
    const keyed = new RegExp(`\\b${noun}\\s*(?:=|:|is)\\s*(\\d{1,3})\\b`, "i").exec(question);
    if (keyed) {
      const value = Number(keyed[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

export function nodesFromEdges(
  edges: ReadonlyArray<{ from: string; to: string }>,
): Array<{ id: string; label: string }> {
  const ids: string[] = [];
  for (const edge of edges) {
    if (!ids.includes(edge.from)) ids.push(edge.from);
    if (!ids.includes(edge.to)) ids.push(edge.to);
  }
  ids.sort((a, b) => (a.length === b.length ? a.localeCompare(b) : a.length - b.length));
  return ids.map((id) => ({ id, label: id }));
}

/** Adjacent words in a sorted alien dictionary give one letter ordering each. */
export function letterEdgesFromWords(words: readonly string[]): Array<{ from: string; to: string }> | null {
  const edges: Array<{ from: string; to: string }> = [];
  for (let index = 0; index + 1 < words.length; index += 1) {
    const a = words[index]!;
    const b = words[index + 1]!;
    const limit = Math.min(a.length, b.length);
    let found = false;
    for (let position = 0; position < limit; position += 1) {
      if (a[position] === b[position]) continue;
      const from = a[position]!.toUpperCase();
      const to = b[position]!.toUpperCase();
      if (!edges.some((edge) => edge.from === from && edge.to === to)) edges.push({ from, to });
      found = true;
      break;
    }
    // A prefix that follows its own extension is an invalid dictionary.
    if (!found && a.length > b.length) return null;
  }
  return edges.length >= 2 ? edges : null;
}
