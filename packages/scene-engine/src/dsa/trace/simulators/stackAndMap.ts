/**
 * Monotonic stack, hash map, and union-find.
 *
 * All three are auxiliary-structure algorithms: the interesting state is not
 * the input array but the helper beside it, and until frames could carry an
 * aside that helper was invisible. The stack is a column that grows and
 * shrinks, the map is a key-to-index table that gains a row per store, and
 * union-find is the parent array with the one cell that changed lit up.
 */
import {
  aside,
  cells,
  marked,
  type AlgorithmTrace,
  type TraceCell,
  type TraceFrame,
  type TraceMark,
} from "../types";

const MAX_FRAMES = 9;
const BLANK = "·";

export interface ValueArrayInput {
  values: number[];
  /**
   * What the answer row holds: the next greater value itself, or how many
   * steps away it is. Daily Temperatures asks for the wait in days, and
   * writing the temperature there contradicts the statement's own output.
   */
  answer?: "value" | "distance";
}

export function simulateNextGreaterElement(input: ValueArrayInput): AlgorithmTrace | null {
  const values = input.values;
  if (values.length < 4 || values.length > 8) return null;
  const mode = input.answer ?? "value";

  const answer: string[] = values.map(() => (mode === "distance" ? "0" : BLANK));
  const stack: number[] = [];
  const frames: TraceFrame[] = [];

  const state = (activeColumn: number, resolved: readonly number[]) => ({
    kind: "grid" as const,
    rowLabels: ["a[i]", mode === "distance" ? "wait" : "next"],
    colLabels: values.map((_, index) => String(index)),
    cells: [
      values.map((value, index): TraceCell => ({
        text: String(value),
        ...(index === activeColumn
          ? { mark: "active" as const }
          : resolved.includes(index)
            ? { mark: "done" as const }
            : stack.includes(index)
              ? { mark: "candidate" as const }
              : {}),
      })),
      answer.map((text, index): TraceCell => ({
        text,
        ...(resolved.includes(index) ? { mark: "active" as const } : {}),
      })),
    ],
    asides: [
      // Top of the stack at the top of the column, which is how it is drawn
      // on a board and the order the algorithm pops in.
      aside(
        "stack",
        "stack",
        "column",
        [...stack].reverse().map((index) => `${values[index]}`),
        Math.max(4, values.length),
        new Map(stack.length > 0 ? [[stack.length - 1, "candidate" as const]] : []),
      ),
    ],
  });

  frames.push({
    id: "input",
    caption: mode === "distance" ? "How many days until it gets warmer?" : "Find the next greater value for each position",
    narrationIntent: `The slow way is to look right from every position, which is quadratic. Instead we keep a stack of the positions that are still waiting for an answer, and every value is pushed once and popped once.`,
    state: state(-1, []),
  });

  for (let i = 0; i < values.length; i += 1) {
    const resolved: number[] = [];
    while (stack.length > 0 && values[stack[stack.length - 1]!]! < values[i]!) {
      const index = stack.pop()!;
      answer[index] = mode === "distance" ? String(i - index) : String(values[i]!);
      resolved.push(index);
    }
    stack.push(i);
    if (frames.length < MAX_FRAMES) {
      frames.push({
        id: `at${i}`,
        caption: resolved.length
          ? `${values[i]} answers ${resolved.map((index) => `index ${index}`).join(" and ")}`
          : `${values[i]} waits on the stack`,
        narrationIntent: resolved.length
          ? `${values[i]} is bigger than the values on top of the stack, so each of those comes off and takes its answer: ${resolved
              .map((index) => `position ${index} holding ${values[index]} gets ${answer[index]}`)
              .join(", ")}. Then ${values[i]} goes on and waits for something bigger.`
          : `Nothing on the stack is smaller than ${values[i]}, so no answer is settled here. ${values[i]} joins the stack and waits.`,
        state: state(i, resolved),
      });
    }
  }

  const finalRow = answer.map((text) => (text === BLANK ? "0" : text));
  if (frames.length >= 2) {
    frames[frames.length - 1]!.caption = `Answer: ${finalRow.join(" ")}`.slice(0, 60);
  }
  return {
    algorithmId: "monotonic_stack",
    title: mode === "distance" ? "Daily temperatures with a stack" : "Next greater element",
    input: { values },
    result: answer.map((text) => (text === BLANK ? (mode === "distance" ? 0 : null) : Number(text))),
    resultText: finalRow.join(" "),
    frames,
  };
}

export interface TwoSumInput {
  values: number[];
  target: number;
}

export function simulateHashMapTwoSum(input: TwoSumInput): AlgorithmTrace | null {
  const values = input.values;
  if (values.length < 4 || values.length > 8) return null;

  const seen = new Map<number, number>();
  const frames: TraceFrame[] = [];
  let answer: [number, number] | null = null;

  // The map is drawn as its own two-row table, key over index, because that
  // is the entry a teacher writes: "2 goes to 0". Mirroring the array in a
  // second row underneath said nothing about what a hash map holds.
  const mapAside = (highlight: number | null) => {
    const keys = [...seen.keys()];
    const marks = new Map<number, TraceMark>();
    if (highlight !== null) {
      const at = keys.indexOf(highlight);
      if (at >= 0) marks.set(at, "active");
    }
    return [
      aside("key", "key", "row", keys.map((key) => String(key)), values.length, marks),
      aside("idx", "index", "row", keys.map((key) => String(seen.get(key))), values.length, marks),
    ];
  };

  const state = (activeColumn: number, partner: number | null, highlightKey: number | null) => ({
    kind: "array" as const,
    cells: values.map((value, index): TraceCell => ({
      text: String(value),
      ...(index === activeColumn
        ? { mark: "active" as const }
        : index === partner
          ? { mark: "done" as const }
          : {}),
    })),
    showIndices: true,
    note: `target = ${input.target}`,
    asides: mapAside(highlightKey),
  });

  frames.push({
    id: "input",
    caption: `Find two values summing to ${input.target}`,
    narrationIntent: `The array is not sorted, so walking in from both ends will not work. Instead we go left to right and remember every value we pass in a map from the value to the index it was at, so the partner we need can be looked up in one step.`,
    state: state(-1, null, null),
  });

  for (let i = 0; i < values.length && frames.length < MAX_FRAMES; i += 1) {
    const need = input.target - values[i]!;
    const partner = seen.get(need);
    if (partner !== undefined) {
      answer = [partner, i];
      frames.push({
        id: `hit${i}`,
        caption: `${need} + ${values[i]} = ${input.target}, answer [${partner}, ${i}]`,
        narrationIntent: `${values[i]} needs ${need} to reach ${input.target}, and ${need} is a key in the map already, stored at index ${partner}. That is the pair, found with one lookup instead of a second loop.`,
        state: state(i, partner, need),
      });
      break;
    }
    seen.set(values[i]!, i);
    frames.push({
      id: `store${i}`,
      caption: `need ${need}, not in the map`,
      narrationIntent: `${values[i]} would need ${need} as its partner, and ${need} is not a key in the map, so nothing pairs with it yet. ${values[i]} goes into the map against index ${i} and we move on.`,
      state: state(i, null, values[i]!),
    });
  }

  return {
    algorithmId: "hash_map_two_sum",
    title: "Two sum with a hash map",
    input: { values, target: input.target },
    result: answer,
    resultText: answer ? `[${answer[0]}, ${answer[1]}]` : "no pair",
    earlyExit: answer !== null && answer[1] < values.length - 1,
    frames,
  };
}

export interface UnionFindInput {
  size: number;
  unions: Array<[number, number]>;
}

export function simulateUnionFind(input: UnionFindInput): AlgorithmTrace | null {
  const { size, unions } = input;
  if (size < 3 || size > 8) return null;
  if (unions.length < 1 || unions.length > 8) return null;
  if (unions.some(([a, b]) => a < 0 || b < 0 || a >= size || b >= size || a === b)) return null;

  const parent = Array.from({ length: size }, (_, index) => index);
  const find = (id: number): number => {
    let root = id;
    while (parent[root] !== root) root = parent[root]!;
    return root;
  };

  const nodes = Array.from({ length: size }, (_, index) => index);
  const frames: TraceFrame[] = [];

  /** The parent array, with the cell that actually changed lit. */
  const gridNow = (touched: readonly number[], changed: number | null) => ({
    kind: "grid" as const,
    rowLabels: ["i", "p[i]"],
    colLabels: nodes.map((index) => String(index)),
    cells: [
      nodes.map((index): TraceCell => ({
        text: String(index),
        ...(touched.includes(index) ? { mark: "candidate" as const } : {}),
      })),
      parent.map((value, index): TraceCell => ({
        text: String(value),
        ...(index === changed
          ? { mark: "active" as const }
          : value !== index
            ? { mark: "done" as const }
            : {}),
      })),
    ],
    note: `components: ${new Set(nodes.map((index) => find(index))).size}`,
  });

  frames.push({
    id: "singletons",
    caption: `${size} separate components`,
    narrationIntent: `Every element starts as its own parent, so there are ${size} components. Union-find answers "are these two already connected?" without ever walking the graph, by climbing to each one's root.`,
    state: gridNow([], null),
  });

  for (const [a, b] of unions) {
    if (frames.length >= MAX_FRAMES) break;
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) {
      frames.push({
        id: `same_${a}_${b}`,
        caption: `${a} and ${b} are already connected`,
        narrationIntent: `${a} climbs to root ${rootA} and ${b} climbs to the same root, so they are already in one component and this union changes nothing. That is exactly the check Kruskal uses to reject an edge that would close a cycle.`,
        state: gridNow([a, b], null),
      });
      continue;
    }
    parent[rootA] = rootB;
    frames.push({
      id: `union_${a}_${b}`,
      caption: `union(${a}, ${b}): p[${rootA}] becomes ${rootB}`,
      narrationIntent: `${a} sits under root ${rootA} and ${b} under root ${rootB}. Pointing root ${rootA} at root ${rootB} joins the two components, and it is the only cell that changes: everything else keeps the parent it had.`,
      state: gridNow([a, b], rootA),
    });
  }

  const components = new Set(nodes.map((index) => find(index))).size;
  if (frames.length >= 2) {
    frames[frames.length - 1]!.caption = `${components} component${components === 1 ? "" : "s"} left`;
  }
  return {
    algorithmId: "union_find",
    title: "Union-find",
    input: { size, unions },
    result: { components },
    resultText: `${components} component${components === 1 ? "" : "s"}`,
    frames,
  };
}
