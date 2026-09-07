/**
 * Simulator gate: every DSA family's trace matches a hand-computed expectation.
 *
 * The expected values below were worked out by hand, not captured from the
 * code, which is the only way this gate can catch a simulator that is wrong
 * rather than merely stable. If a change here starts failing, verify the
 * arithmetic by hand before touching the expectation.
 *
 * The structural checks matter as much as the values. Every grid trace must
 * be exactly `rowLabels.length` by `colLabels.length`, so there is no header
 * row inside `cells` to be stripped by a heuristic — the bug that put a
 * Floyd-Warshall 3 in the wrong column had no way to fail before this.
 */
import { ALGORITHM_FAMILIES, familyById } from "../../src/dsa/algorithmCatalog";
import { detectAlgorithm, looksLikeCodingProblem, rankAlgorithms } from "../../src/dsa/detectAlgorithm";
import {
  traceStructureOf,
  type AlgorithmTrace,
  type TraceAside,
  type TraceFrame,
  type TraceFrameState,
  type TraceMark,
} from "../../src/dsa/trace/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Frames one family may spend.
 *
 * This was 8, which is one frame per pass for an exchange sort and therefore
 * exactly the budget that made bubble sort unteachable: the comparisons and
 * swaps that are the algorithm all happened between two frames. A walk-through
 * that shows the operations needs room for them, and the pacing gate confirms
 * the resulting lesson still lands in the 6 to 10 minute band.
 */
const MAX_FRAMES_PER_FAMILY = 16;


function runDefault(id: string): AlgorithmTrace {
  const family = familyById(id);
  assert(family, `family ${id} is missing from the catalog`);
  const run = family.run("");
  assert(run, `family ${id} could not produce its own default example`);
  assert(run.exampleSource === "default", `family ${id} claimed a question example for an empty question`);
  return run.trace;
}

function gridOf(frame: TraceFrame): {
  rowLabels: string[];
  colLabels: string[];
  cells: string[][];
} {
  assert(frame.state.kind === "grid", `frame ${frame.id} is not a grid`);
  return {
    rowLabels: frame.state.rowLabels,
    colLabels: frame.state.colLabels,
    cells: frame.state.cells.map((row) => row.map((cell) => cell.text)),
  };
}

function arrayOf(frame: TraceFrame): string[] {
  assert(frame.state.kind === "array", `frame ${frame.id} is not an array`);
  return frame.state.cells.map((cell) => cell.text);
}

/** The cells of one panel of a stacked frame, as text. */
function panelOf(frame: TraceFrame, part: number): string[] {
  assert(frame.state.kind === "stacked", `frame ${frame.id} is not stacked`);
  const inner = frame.state.parts[part]?.state;
  assert(inner?.kind === "array", `frame ${frame.id} panel ${part} is not an array`);
  return (inner as Extract<typeof inner, { kind: "array" }>).cells.map((cell) => cell.text);
}

/** Indices of one panel's cells carrying a mark. */
function markedIn(frame: TraceFrame, part: number, mark: TraceMark): number[] {
  assert(frame.state.kind === "stacked", `frame ${frame.id} is not stacked`);
  const inner = frame.state.parts[part]!.state as Extract<TraceFrameState, { kind: "array" }>;
  return inner.cells.flatMap((cell, at) => (cell.mark === mark ? [at] : []));
}

/** Follow the arrows from `head`, returning the labels in reading order. */
function walkList(frame: TraceFrame, head: string): string[] {
  assert(frame.state.kind === "list", `frame ${frame.id} is not a list`);
  const state = frame.state;
  const label = new Map(state.nodes.map((node) => [node.id, node.label] as const));
  const next = new Map(state.links.map((link) => [link.from, link.to] as const));
  const seen = new Set<string>();
  const out: string[] = [];
  for (let at: string | undefined = head; at && !seen.has(at); at = next.get(at)) {
    seen.add(at);
    out.push(label.get(at) ?? "?");
  }
  return out;
}

function listOf(frame: TraceFrame): Extract<TraceFrame["state"], { kind: "list" }> {
  assert(frame.state.kind === "list", `frame ${frame.id} is not a list`);
  return frame.state;
}

/**
 * The two rows of a stacked heap frame: what the tree nodes hold and what the
 * array cells hold. A heap is the one figure where those two lists must be
 * identical, and nothing else in the pipeline compares them.
 */
function heapRows(frame: TraceFrame): { tree: string[]; array: string[]; asideIds: string[] } {
  assert(frame.state.kind === "stacked", `frame ${frame.id} is not stacked`);
  const parts = frame.state.parts;
  assert(parts.length === 2, `frame ${frame.id} has ${parts.length} parts, expected a tree over an array`);
  const top = parts[0]!.state;
  const bottom = parts[1]!.state;
  assert(top.kind === "tree" && bottom.kind === "array", `frame ${frame.id} is not a tree over an array`);
  return {
    tree: top.nodes.map((node) => node.label),
    array: bottom.cells.map((cell) => cell.text),
    asideIds: (bottom.asides ?? []).map((item) => item.id),
  };
}

/** Every stacked heap frame draws the tree and the array saying the same thing. */
function assertHeapFigure(id: string, trace: AlgorithmTrace, slots: number): void {
  for (const frame of trace.frames) {
    const rows = heapRows(frame);
    assert(
      JSON.stringify(rows.tree) === JSON.stringify(rows.array),
      `${id}/${frame.id}: the tree reads [${rows.tree.join(",")}] but the array reads [${rows.array.join(",")}] — ` +
        "a heap's tree and its array are the same object and may never disagree",
    );
    assert(
      rows.tree.length === slots,
      `${id}/${frame.id}: ${rows.tree.length} slots drawn, expected ${slots} in every frame so the figure never relayouts`,
    );
  }
}

function treeOf(frame: TraceFrame): {
  nodes: Array<{ id: string; label: string; mark?: string }>;
  layout: Array<{ id: string; label: string }>;
  edges: Array<{ from: string; to: string }>;
  out: string[];
} {
  assert(frame.state.kind === "tree", `frame ${frame.id} is not a tree`);
  const state = frame.state;
  return {
    nodes: state.nodes,
    layout: state.layoutNodes ?? state.nodes,
    edges: state.layoutEdges ?? state.edges,
    out: (state.asides ?? []).flatMap((row) => row.cells.map((cell) => cell.text)).filter((text) => text.length > 0),
  };
}

// --- Structural invariants that hold for every family. ---

for (const family of ALGORITHM_FAMILIES) {
  const trace = runDefault(family.id);

  assert(trace.frames.length >= 2, `${family.id}: a single frame is a static picture, not a walk-through`);
  assert(
    trace.frames.length <= MAX_FRAMES_PER_FAMILY,
    `${family.id}: ${trace.frames.length} frames will not fit the lesson budget`,
  );

  const structure = traceStructureOf(trace);
  assert(structure, `${family.id}: frame kinds change mid-trace, so cell addresses are not comparable`);
  assert(
    structure === family.structure,
    `${family.id}: catalog declares ${family.structure} but the trace is ${structure}`,
  );

  const ids = trace.frames.map((frame) => frame.id);
  assert(new Set(ids).size === ids.length, `${family.id}: duplicate frame ids ${ids.join(",")}`);

  // Every frame's narration intent now reaches the teaching model verbatim, so
  // two frames that share one make the tutor say the same thing twice. A frame
  // that cannot be described in its own words is a frame with nothing new on
  // it, which is a walk-through problem rather than a wording problem.
  const intents = trace.frames.map((frame) => frame.narrationIntent);
  const repeated = intents.filter((intent, index) => intents.indexOf(intent) !== index);
  assert(
    repeated.length === 0,
    `${family.id}: ${repeated.length} frames repeat another frame's narration — "${repeated[0]?.slice(0, 70)}…"`,
  );
  for (const frame of trace.frames) {
    assert(frame.caption.length > 0 && frame.caption.length <= 60, `${family.id}/${frame.id}: caption must be 1-60 chars`);
    // The caption is drawn on the board and the intent is the material the
    // tutor speaks from, so both are copy the student meets: no em dash and no
    // hyphen standing in for a comma. The base teaching prompt bans dashes in
    // board text and speech, and a dash in this material invites one straight
    // back out.
    for (const [what, text] of [["caption", frame.caption], ["narration", frame.narrationIntent]] as const) {
      assert(
        !/[—–]/.test(text) && !/\s-\s/.test(text),
        `${family.id}/${frame.id}: ${what} "${text.slice(0, 70)}" uses a dash as punctuation`,
      );
    }
    assert(frame.narrationIntent.length > 20, `${family.id}/${frame.id}: narration intent is too thin to speak`);
  }

  // Determinism. A simulator that reads the clock or a shared mutable would
  // make the trace-versus-render check meaningless.
  const again = runDefault(family.id);
  assert(
    JSON.stringify(again) === JSON.stringify(trace),
    `${family.id}: two runs of the same input produced different traces`,
  );

  // Grids are exactly headers-by-headers, with no header text inside cells.
  for (const frame of trace.frames) {
    if (frame.state.kind !== "grid") continue;
    const { rowLabels, colLabels, cells } = gridOf(frame);
    assert(
      cells.length === rowLabels.length,
      `${family.id}/${frame.id}: ${cells.length} rows for ${rowLabels.length} row labels`,
    );
    for (const [index, row] of cells.entries()) {
      assert(
        row.length === colLabels.length,
        `${family.id}/${frame.id}: row ${index} has ${row.length} cells for ${colLabels.length} column labels`,
      );
    }
  }

  // Array traces keep a fixed width so a pointer index means the same thing
  // in every frame.
  const widths = new Set(
    trace.frames
      .filter((frame) => frame.state.kind === "array")
      .map((frame) => (frame.state.kind === "array" ? frame.state.cells.length : 0)),
  );
  assert(widths.size <= 1, `${family.id}: array width changes between frames (${[...widths].join(",")})`);

  for (const [index, frame] of trace.frames.entries()) {
    if (frame.state.kind !== "array") continue;
    const state = frame.state;
    for (const pointer of state.pointers ?? []) {
      assert(
        pointer.index >= 0 && pointer.index < state.cells.length,
        `${family.id}/${frame.id}: pointer ${pointer.name} points outside the array`,
      );
    }

    // A bar is a second rendering of the value in the cell beneath it. If the
    // two disagree the board contradicts itself, and the taller channel is the
    // one a student reads first.
    if (state.bars) {
      assert(
        state.bars.length === state.cells.length,
        `${family.id}/${frame.id}: ${state.bars.length} bars for ${state.cells.length} cells`,
      );
      for (const [at, bar] of state.bars.entries()) {
        const text = state.cells[at]!.text;
        assert(
          String(bar) === text,
          `${family.id}/${frame.id}: bar ${at} measures ${bar} while its cell reads "${text}"`,
        );
      }
    }

    // A declared swap has to be the swap that actually happened. This is the
    // whole claim the crossing arcs make, and nothing downstream can check it:
    // the renderer draws the arcs wherever the trace says, truthfully or not.
    if (state.swap) {
      const previous = trace.frames[index - 1];
      assert(previous, `${family.id}/${frame.id}: a swap frame cannot be the first frame`);
      assert(
        previous!.state.kind === "array",
        `${family.id}/${frame.id}: the frame before a swap is not an array`,
      );
      const before = (previous!.state as Extract<typeof state, { kind: "array" }>).cells.map((cell) => cell.text);
      const after = state.cells.map((cell) => cell.text);
      const { from, to } = state.swap;
      assert(
        from !== to && from >= 0 && to >= 0 && from < after.length && to < after.length,
        `${family.id}/${frame.id}: swap ${from} and ${to} is not a pair of distinct cells`,
      );
      const expected = [...before];
      expected[from] = before[to]!;
      expected[to] = before[from]!;
      assert(
        JSON.stringify(expected) === JSON.stringify(after),
        `${family.id}/${frame.id}: the frame claims to swap ${from} and ${to}, but ` +
          `[${before.join(",")}] became [${after.join(",")}] rather than [${expected.join(",")}]`,
      );
    }

    for (const bracket of state.brackets ?? []) {
      assert(
        bracket.from >= 0 && bracket.to < state.cells.length && bracket.from <= bracket.to,
        `${family.id}/${frame.id}: bracket ${bracket.from} to ${bracket.to} runs outside the array`,
      );
      assert(
        bracket.label.trim().length > 0 && bracket.label.length <= 20,
        `${family.id}/${frame.id}: bracket label ${JSON.stringify(bracket.label)} must be 1-20 chars`,
      );
    }
  }
}

// --- Binary search: [2,5,8,12,16,23,38] for 16 lands on index 4 in 3 probes. ---
{
  const trace = runDefault("binary_search");
  assert(trace.result === 4, `binary_search: expected index 4, got ${String(trace.result)}`);
  assert(trace.frames.length === 4, `binary_search: expected 4 frames, got ${trace.frames.length}`);
  // mid = 3 (12, too small) -> mid = 5 (23, too big) -> mid = 4 (16, found).
  const mids = trace.frames
    .map((frame) => (frame.state.kind === "array" ? frame.state.pointers?.find((p) => p.name === "mid")?.index : undefined))
    .filter((index): index is number => index !== undefined);
  assert(
    JSON.stringify(mids) === JSON.stringify([3, 5, 4]),
    `binary_search: probe sequence should be 3,5,4 — got ${mids.join(",")}`,
  );
  assert(arrayOf(trace.frames[0]!)[4] === "16", "binary_search: value at index 4 must be 16");
}

// --- Two pointers: [1,3,4,6,8,11] for 10 meets at indices 2 and 3. ---
{
  const trace = runDefault("two_pointers");
  assert(
    JSON.stringify(trace.result) === JSON.stringify([2, 3]),
    `two_pointers: expected indices [2,3], got ${JSON.stringify(trace.result)}`,
  );
  const last = trace.frames[trace.frames.length - 1]!;
  assert(last.caption.includes("4 + 6 = 10"), `two_pointers: final caption should state 4 + 6 = 10, got "${last.caption}"`);
}

// --- Bubble sort: [5,1,4,2,8] walked comparison by comparison. ---
{
  const trace = runDefault("bubble_sort");
  assert(
    JSON.stringify(trace.result) === JSON.stringify([1, 2, 4, 5, 8]),
    `bubble_sort: wrong sorted result ${JSON.stringify(trace.result)}`,
  );

  // The defect this replaces: one frame per pass, so the board showed the
  // array before a pass and after it while every comparison and every swap
  // happened invisibly in between. The tutor was left narrating "when 5 meets
  // 1 they swap" over a picture that never showed a comparison at all.
  const compares = trace.frames.filter((frame) => frame.id.startsWith("cmp"));
  const swaps = trace.frames.filter((frame) => frame.id.startsWith("swp"));
  assert(
    compares.length === 4,
    `bubble_sort: pass one over five values makes four comparisons, got ${compares.length} frames`,
  );
  // 5 > 1, 5 > 4 and 5 > 2 all swap; 5 > 8 does not.
  assert(
    swaps.length === 3,
    `bubble_sort: pass one over [5,1,4,2,8] swaps three times, got ${swaps.length} frames`,
  );

  // Every comparison frame marks exactly the pair it is comparing, and points
  // j and j+1 at it. Without this the frame is a picture of an array with no
  // indication of what the algorithm is looking at.
  for (const frame of compares) {
    assert(frame.state.kind === "array", `bubble_sort/${frame.id}: not an array frame`);
    const state = frame.state as Extract<typeof frame.state, { kind: "array" }>;
    const active = state.cells.flatMap((cell, at) => (cell.mark === "active" ? [at] : []));
    assert(
      active.length === 2 && active[1] === active[0]! + 1,
      `bubble_sort/${frame.id}: marks cells ${active.join(",")} instead of one adjacent pair`,
    );
    const names = (state.pointers ?? []).map((pointer) => `${pointer.name}@${pointer.index}`);
    assert(
      names.join(",") === `j@${active[0]},j+1@${active[1]}`,
      `bubble_sort/${frame.id}: pointers are ${names.join(",")} but the pair is ${active.join(",")}`,
    );
  }

  // The caption states the comparison and its answer, so the student can read
  // the decision rather than infer it.
  assert(
    compares[0]!.caption === "Is 5 > 1? Yes" && compares[3]!.caption === "Is 5 > 8? No",
    `bubble_sort: comparison captions are ${JSON.stringify(compares.map((frame) => frame.caption))}`,
  );

  // Bubble sort's only mark used to be `done` on the settled tail, and a mark
  // is discarded by the renderer unless it is `active` or `window`, so the
  // sorted region had no ink at all. It is a labelled bracket now.
  // The early exit is part of what bubble sort teaches: pass three moves
  // nothing on [5,1,4,2,8], which proves the array is sorted without walking
  // the remaining passes. Dropping the `swapped` check still ends on a sorted
  // board, just one wasted frame later, so only the pass count catches it.
  const passes = trace.frames.filter((frame) => frame.id.startsWith("pass"));
  assert(
    passes.length === 3,
    `bubble_sort: [5,1,4,2,8] is settled after three passes, got ${passes.length} — ` +
      "the walk is not stopping when a pass swaps nothing",
  );

  const last = trace.frames[trace.frames.length - 1]!;
  assert(last.caption.startsWith("Sorted"), `bubble_sort: the walk ends on "${last.caption}"`);
  const lastState = last.state as Extract<typeof last.state, { kind: "array" }>;
  assert(
    JSON.stringify(lastState.cells.map((cell) => cell.text)) === JSON.stringify(["1", "2", "4", "5", "8"]),
    "bubble_sort: the last frame must show the sorted array",
  );
  assert(
    lastState.brackets?.length === 1 &&
      lastState.brackets[0]!.label === "sorted" &&
      lastState.brackets[0]!.from === 0 &&
      lastState.brackets[0]!.to === 4,
    `bubble_sort: the final frame must bracket the whole array as sorted, got ${JSON.stringify(lastState.brackets)}`,
  );
  for (const frame of trace.frames) {
    const state = frame.state as Extract<typeof frame.state, { kind: "array" }>;
    assert(
      state.brackets?.length === 1,
      `bubble_sort/${frame.id}: every frame needs its region bracket, or the figure changes height and rescales`,
    );
  }
}

// --- Merge sort: breaks down then rebuilds, ending sorted. ---
{
  const trace = runDefault("merge_sort");
  assert(
    JSON.stringify(trace.result) === JSON.stringify([3, 9, 27, 38, 43, 82]),
    `merge_sort: wrong sorted result ${JSON.stringify(trace.result)}`,
  );
  const final = trace.frames[trace.frames.length - 1]!;
  assert(
    JSON.stringify(arrayOf(final)) === JSON.stringify(["3", "9", "27", "38", "43", "82"]),
    "merge_sort: last frame must show the sorted array",
  );
  assert(
    final.state.kind === "array" && final.state.groups === undefined,
    "merge_sort: the last frame is one merged run, not separate blocks",
  );
  const splitFrames = trace.frames.filter((frame) => frame.id.startsWith("split"));
  assert(splitFrames.length >= 2, "merge_sort: the break-down needs at least two split frames to read as a process");
  const singles = splitFrames[splitFrames.length - 1]!;
  assert(
    singles.state.kind === "array" && singles.state.groups?.every((group) => group.cells.length === 1),
    "merge_sort: the deepest split must reach single values",
  );
}

// --- Floyd-Warshall: the case that shipped broken. ---
{
  const trace = runDefault("floyd_warshall");
  const first = gridOf(trace.frames[0]!);
  assert(
    JSON.stringify(first.rowLabels) === JSON.stringify(["A", "B", "C", "D"]),
    `floyd_warshall: row labels should be A..D, got ${first.rowLabels.join(",")}`,
  );
  assert(
    JSON.stringify(first.colLabels) === JSON.stringify(["A", "B", "C", "D"]),
    "floyd_warshall: column labels should be A..D",
  );
  // The direct A->B edge weighs 3, and it belongs at row 0, column 1.
  assert(
    first.cells[0]![1] === "3",
    `floyd_warshall: A->B must be 3 at row 0 column 1 — found "${first.cells[0]![1]}"`,
  );
  assert(first.cells[0]![0] === "0", "floyd_warshall: the diagonal must be zero");
  assert(first.cells[0]![3] === "∞", "floyd_warshall: A->D has no direct edge, so it starts at infinity");
  // No header letter may appear inside the data grid.
  for (const row of first.cells) {
    for (const text of row) {
      assert(!/^[A-D]$/.test(text), `floyd_warshall: header label "${text}" leaked into a data cell`);
    }
  }
  const final = gridOf(trace.frames[trace.frames.length - 1]!);
  assert(
    JSON.stringify(final.cells) ===
      JSON.stringify([
        ["0", "3", "5", "8"],
        ["3", "0", "2", "5"],
        ["5", "2", "0", "4"],
        ["8", "5", "4", "0"],
      ]),
    `floyd_warshall: wrong final distance matrix ${JSON.stringify(final.cells)}`,
  );
}

// --- Longest common subsequence: "ABCB" vs "BDCB" is 3 ("BCB"). ---
{
  const trace = runDefault("lcs");
  assert(trace.result === 3, `lcs: expected 3, got ${String(trace.result)}`);
  const final = gridOf(trace.frames[trace.frames.length - 1]!);
  assert(
    JSON.stringify(final.rowLabels) === JSON.stringify(["ε", "A", "B", "C", "B"]),
    "lcs: rows are the empty prefix then the letters of A",
  );
  assert(final.cells[4]![4] === "3", `lcs: bottom-right must be 3, got "${final.cells[4]![4]}"`);
  assert(final.cells[0]!.every((text) => text === "0"), "lcs: the empty-prefix row is all zeroes");
}

// --- Edit distance: horse -> ros is 3. ---
{
  const trace = runDefault("edit_distance");
  assert(trace.result === 3, `edit_distance: expected 3, got ${String(trace.result)}`);
}

// --- Next greater element: [2,1,2,4,3] -> [4,2,4,null,null]. ---
{
  const trace = runDefault("monotonic_stack");
  assert(
    JSON.stringify(trace.result) === JSON.stringify([4, 2, 4, null, null]),
    `monotonic_stack: wrong answers ${JSON.stringify(trace.result)}`,
  );
}

// --- Union-find: 6 elements, four unions, two components remain. ---
{
  const trace = runDefault("union_find");
  assert(
    JSON.stringify(trace.result) === JSON.stringify({ components: 2 }),
    `union_find: expected 2 components, got ${JSON.stringify(trace.result)}`,
  );
}

// --- Kruskal: A-B 1, B-C 2, A-C 3 rejected as a cycle, C-D 4. Total 7. ---
{
  const trace = runDefault("kruskal");
  const result = trace.result as { edges: string[]; weight: number };
  assert(result.weight === 7, `kruskal: expected total weight 7, got ${result.weight}`);
  assert(result.edges.length === 3, `kruskal: a 4-node tree needs 3 edges, got ${result.edges.length}`);
  assert(
    trace.frames.some((frame) => frame.caption.includes("closes a cycle")),
    "kruskal: the rejected edge is the point of the algorithm and must appear in a frame",
  );
}

// --- Dijkstra: distances from A over the default graph. ---
{
  const trace = runDefault("dijkstra");
  const result = trace.result as Record<string, number | null>;
  assert(result.A === 0 && result.B === 3 && result.C === 5 && result.D === 8, `dijkstra: wrong distances ${JSON.stringify(result)}`);
}

// --- Reverse a linked list: every arrow flips. ---
{
  const trace = runDefault("reverse_linked_list");
  const first = trace.frames[0]!;
  const last = trace.frames[trace.frames.length - 1]!;
  assert(first.state.kind === "list" && last.state.kind === "list", "reverse_linked_list: frames must be lists");
  const forward = first.state.links.map((link) => `${link.from}->${link.to}`).sort();
  const backward = last.state.links.map((link) => `${link.to}->${link.from}`).sort();
  assert(
    JSON.stringify(forward) === JSON.stringify(backward),
    `reverse_linked_list: the final links are not the reverse of the initial ones (${forward.join(",")} vs ${backward.join(",")})`,
  );
}

// --- Tree traversal: inorder over the default BST is sorted. ---
{
  const trace = runDefault("tree_traversal");
  assert(
    JSON.stringify(trace.result) === JSON.stringify(["1", "3", "6", "8", "10", "14"]),
    `tree_traversal: inorder over a BST must be sorted, got ${JSON.stringify(trace.result)}`,
  );
}

// --- Number of islands: 4 + 2 + 1 land cells make three islands. ---
{
  const trace = runDefault("grid_islands");
  assert(trace.result === 3, `grid_islands: expected 3 islands, got ${String(trace.result)}`);
  assert(trace.frames.length === 8, `grid_islands: one scan frame plus seven land cells, got ${trace.frames.length}`);

  // The order the walk visits cells in IS the algorithm: a stack that popped
  // in push order would visit (0,1) second and teach a breadth-first spread
  // under a depth-first name.
  const order = trace.frames.slice(1).map((frame) => frame.id).join(" ");
  assert(
    order === "walk_0_0 walk_1_0 walk_1_1 walk_0_1 walk_0_4 walk_1_4 walk_3_0",
    `grid_islands: the depth-first order is "${order}"`,
  );

  // `path` is the route in, not the order of visits. Joining consecutive
  // visits would draw a leap from (0,1) to (0,4), a step across three water
  // cells that the algorithm never takes.
  for (const frame of trace.frames) {
    assert(frame.state.kind === "matrix", `grid_islands/${frame.id}: not a matrix frame`);
    const path = (frame.state as Extract<typeof frame.state, { kind: "matrix" }>).path ?? [];
    for (let step = 0; step + 1 < path.length; step += 1) {
      const [r1, c1] = path[step]!;
      const [r2, c2] = path[step + 1]!;
      assert(
        Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1,
        `grid_islands/${frame.id}: the route leaps from ${r1},${c1} to ${r2},${c2}`,
      );
    }
  }

  // Every frame carries the running count, so a student can read the answer
  // accumulating rather than meeting it only in the closing caption.
  const notes = trace.frames.map((frame) => (frame.state as { note?: string }).note);
  assert(
    JSON.stringify(notes) ===
      JSON.stringify([
        "islands = 0", "islands = 1", "islands = 1", "islands = 1",
        "islands = 1", "islands = 2", "islands = 2", "islands = 3",
      ]),
    `grid_islands: the running count reads ${notes.join(", ")}`,
  );
}

// --- Flood fill: six pixels reachable from (1,1); the corner 1 is not. ---
{
  const trace = runDefault("grid_dfs_fill");
  assert(
    JSON.stringify(trace.result) === JSON.stringify([["2", "2", "2"], ["2", "2", "0"], ["2", "0", "1"]]),
    `grid_dfs_fill: wrong image ${JSON.stringify(trace.result)}`,
  );
  assert(trace.frames.length === 7, `grid_dfs_fill: one start frame plus six pixels, got ${trace.frames.length}`);
  const order = trace.frames.slice(1).map((frame) => frame.id).join(" ");
  assert(
    order === "fill_1_1 fill_0_1 fill_0_0 fill_0_2 fill_1_0 fill_2_0",
    `grid_dfs_fill: the fill order is "${order}"`,
  );

  // The cells are repainted as the fill runs. Marking cells "done" over the
  // original values would draw a traversal and claim it was a fill.
  const opening = trace.frames[0]!.state as Extract<TraceFrame["state"], { kind: "matrix" }>;
  assert(opening.cells[1]![1]!.text === "1", "grid_dfs_fill: the start pixel must still read 1 before it is painted");
  const closing = trace.frames[6]!.state as typeof opening;
  assert(closing.cells[1]![1]!.text === "2", "grid_dfs_fill: the start pixel must read 2 once painted");
  assert(closing.cells[2]![2]!.text === "1", "grid_dfs_fill: the unreachable corner must never be repainted");
}

// --- Rotting oranges: one source, layers of 2, 2, 1, 1, so 4 minutes. ---
{
  const trace = runDefault("grid_bfs_multi_source");
  assert(trace.result === 4, `rotting oranges: expected 4 minutes, got ${String(trace.result)}`);
  assert(trace.frames.length === 5, `rotting oranges: minute zero plus four minutes, got ${trace.frames.length}`);
  assert(
    trace.frames.map((frame) => frame.id).join(" ") === "minute0 minute1 minute2 minute3 minute4",
    "rotting oranges: a frame must be a minute, or the answer is a number the student never watched accumulate",
  );

  // Every rotten orange is in the queue before minute one. Seeding one source
  // and looping over the rest gives the same number here and the wrong number
  // wherever two rots race for the same orange.
  const first = trace.frames[0]!.state as Extract<TraceFrame["state"], { kind: "matrix" }>;
  const active = first.cells.flatMap((row, r) => row.flatMap((cell, c) => (cell.mark === "active" ? [`${r},${c}`] : [])));
  assert(
    JSON.stringify(active) === JSON.stringify(["0,0"]),
    `rotting oranges: minute zero must light every rotten orange, got ${active.join(" ")}`,
  );

  // The board must end with nothing fresh on it.
  const last = trace.frames[4]!.state as typeof first;
  assert(
    JSON.stringify(last.cells.map((row) => row.map((cell) => cell.text))) ===
      JSON.stringify([["2", "2", "2"], ["2", "2", "0"], ["0", "2", "2"]]),
    `rotting oranges: the last frame still shows a fresh orange ${JSON.stringify(last.cells.map((row) => row.map((cell) => cell.text)))}`,
  );

  // The queue is pre-sized to the largest layer, which is two.
  for (const frame of trace.frames) {
    const asides = (frame.state as { asides?: Array<{ id: string; capacity: number }> }).asides ?? [];
    assert(
      asides.length === 1 && asides[0]!.id === "queue" && asides[0]!.capacity === 2,
      `rotting oranges/${frame.id}: the queue aside must stay two cells wide`,
    );
  }
}

// --- Bipartite: 1 and 2 are both forced to B and there is an edge 1-2. ---
{
  const trace = runDefault("grid_bipartite");
  assert(trace.result === false, `bipartite: LC 785 example 1 is not bipartite, got ${String(trace.result)}`);
  assert(
    trace.frames.map((frame) => frame.id).join(" ") === "seed_0 see_0 clash_1_2",
    `bipartite: the walk is ${trace.frames.map((frame) => frame.id).join(" ")}`,
  );

  // The colours are ink, not narration: the aside carries a letter per node.
  const asideOf = (index: number) => {
    const asides = (trace.frames[index]!.state as { asides?: Array<{ id: string; cells: Array<{ text: string }> }> }).asides ?? [];
    return asides.find((item) => item.id === "colour")?.cells.map((cell) => cell.text) ?? [];
  };
  assert(
    JSON.stringify(asideOf(0)) === JSON.stringify(["A", "", "", ""]),
    `bipartite: only node 0 is coloured at the seed, got ${JSON.stringify(asideOf(0))}`,
  );
  assert(
    JSON.stringify(asideOf(1)) === JSON.stringify(["A", "B", "B", "B"]),
    `bipartite: every neighbour of 0 must be forced to B, got ${JSON.stringify(asideOf(1))}`,
  );

  // The clash frame strikes out exactly the two nodes that broke it and the
  // edge between them; the answer of this question is which edge fails.
  const clash = trace.frames[2]!.state as Extract<TraceFrame["state"], { kind: "graph" }>;
  const struck = clash.nodes.filter((node) => node.mark === "excluded").map((node) => node.id);
  assert(
    JSON.stringify(struck) === JSON.stringify(["1", "2"]),
    `bipartite: the clash must strike nodes 1 and 2, got ${struck.join(",")}`,
  );
  assert(
    clash.edges.filter((edge) => edge.mark === "excluded").length === 1,
    "bipartite: exactly one edge closes the contradiction",
  );
}

// --- Unique paths: a 3 by 3 grid fills to 6 in the corner. ---
{
  const trace = runDefault("dp_grid_paths");
  assert(trace.result === 6, `unique paths: 3 by 3 has 6 routes, got ${String(trace.result)}`);
  assert(trace.frames.length === 5, `unique paths: a base frame plus four interior cells, got ${trace.frames.length}`);

  const final = gridOf(trace.frames[4]!);
  assert(
    JSON.stringify(final.rowLabels) === JSON.stringify(["0", "1", "2"]) &&
      JSON.stringify(final.colLabels) === JSON.stringify(["0", "1", "2"]),
    "unique paths: the headers are the row and column indices",
  );
  assert(
    JSON.stringify(final.cells) === JSON.stringify([["1", "1", "1"], ["1", "2", "3"], ["1", "3", "6"]]),
    `unique paths: wrong table ${JSON.stringify(final.cells)}`,
  );

  // The base row and column are the whole reason the recurrence terminates,
  // and they are drawn from the first frame rather than appearing filled.
  const base = gridOf(trace.frames[0]!);
  assert(
    base.cells[0]!.join("") === "111" && base.cells.map((row) => row[0]).join("") === "111",
    `unique paths: the base case must be drawn first, got ${JSON.stringify(base.cells)}`,
  );
  assert(
    base.cells[1]![1] === "" && base.cells[2]![2] === "",
    "unique paths: no interior cell may be filled before the rule is applied to it",
  );

  // Every interior cell is written from exactly the cell above and the cell
  // to the left. An extra read would draw an arrow from a cell the rule does
  // not use, which is the claim the arrows make.
  for (const frame of trace.frames.slice(1)) {
    assert(frame.state.kind === "grid", `unique paths/${frame.id}: not a grid frame`);
    const state = frame.state as Extract<typeof frame.state, { kind: "grid" }>;
    const [row, column] = state.write!;
    assert(
      JSON.stringify(state.reads) === JSON.stringify([[row - 1, column], [row, column - 1]]),
      `unique paths/${frame.id}: reads ${JSON.stringify(state.reads)} instead of the cell above and the cell to the left`,
    );
  }
}

// --- Valid parentheses: "{[()]}" nests three deep and unwinds to empty. ---
{
  const trace = runDefault("stack_matching");
  assert(trace.result === true, `stack_matching: "{[()]}" is valid, got ${String(trace.result)}`);
  assert(trace.frames.length === 8, `stack_matching: expected 8 frames, got ${trace.frames.length}`);

  // The stack is the whole lesson, so it has to be ink at the right depth.
  // A column pre-sized to the worst case is also the only way the cell
  // addresses stay comparable across frames.
  const deepest = trace.frames.find((frame) => frame.id === "at2");
  assert(deepest && deepest.state.kind === "array", "stack_matching: no frame at index 2");
  const stack = (deepest!.state as Extract<typeof deepest.state, { kind: "array" }>).asides?.[0];
  assert(
    stack && stack.orientation === "column" && stack.capacity === 3,
    `stack_matching: the stack must be a column of capacity 3, got ${JSON.stringify(stack)}`,
  );
  assert(
    JSON.stringify(stack!.cells.map((cell) => cell.text)) === JSON.stringify(["{", "[", "("]),
    `stack_matching: after three openers the stack reads ${JSON.stringify(stack!.cells.map((cell) => cell.text))}, ` +
      "expected { then [ then ( from the bottom up",
  );
  // Index 0 is the bottom of a drawn column, so the top of the stack is the
  // LAST cell. Reversing the array would draw the top on the floor.
  assert(stack!.cells[2]!.mark === "active", "stack_matching: the top of the stack must be the marked cell");

  // The pair the closer settled has to name the opener it settled against.
  const close = trace.frames.find((frame) => frame.id === "at3");
  assert(
    close?.caption === ") closes ( from index 2",
    `stack_matching: the matching frame reads "${close?.caption}"`,
  );

  // Ending empty is the half of the rule students forget, so it gets a frame.
  const last = trace.frames[trace.frames.length - 1]!;
  assert(
    last.id === "answer" && last.caption === "Stack is empty at the end, so it is valid",
    `stack_matching: the walk ends on "${last.caption}"`,
  );
  const finalStack = (last.state as Extract<typeof last.state, { kind: "array" }>).asides?.[0];
  assert(
    finalStack?.cells.every((cell) => cell.text === ""),
    "stack_matching: the closing frame must show an empty stack",
  );

  // A mismatch stops the walk and strikes both offenders rather than
  // narrating a failure over a clean picture.
  const bad = familyById("stack_matching")!.run('Input: s = "([)]"');
  assert(bad?.exampleSource === "question", "stack_matching: an explicit string must be used");
  assert(bad!.trace.result === false, "stack_matching: ([)] is not valid");
  assert(bad!.trace.earlyExit === true, "stack_matching: a mismatch must stop the walk early");
  const failure = bad!.trace.frames[bad!.trace.frames.length - 1]!;
  const failureCells = (failure.state as Extract<typeof failure.state, { kind: "array" }>).cells;
  assert(
    failureCells[1]!.mark === "excluded" && failureCells[2]!.mark === "excluded",
    `stack_matching: the mismatched pair must be struck through, got ${JSON.stringify(failureCells.map((c) => c.mark ?? null))}`,
  );
}

// --- Min stack: two columns of the same height, LC 155 Example 1. ---
{
  const trace = runDefault("min_stack");
  assert(
    JSON.stringify(trace.result) === JSON.stringify([null, null, null, -3, null, 0, -2]),
    `min_stack: wrong outputs ${JSON.stringify(trace.result)}`,
  );
  assert(trace.frames.length === 8, `min_stack: expected 8 frames, got ${trace.frames.length}`);

  // The claim of the algorithm is that the two columns move together. If they
  // are ever different heights the picture is arguing against the code.
  for (const frame of trace.frames) {
    assert(frame.state.kind === "array", `min_stack/${frame.id}: not an array frame`);
    const asides = (frame.state as Extract<typeof frame.state, { kind: "array" }>).asides ?? [];
    assert(asides.length === 2, `min_stack/${frame.id}: expected two columns, got ${asides.length}`);
    assert(
      asides.every((item) => item.orientation === "column" && item.capacity === 3),
      `min_stack/${frame.id}: both columns must be pre-sized to the deepest the stack gets, which is 3`,
    );
    const filled = asides.map((item) => item.cells.filter((cell) => cell.text !== "").length);
    assert(
      filled[0] === filled[1],
      `min_stack/${frame.id}: value column holds ${filled[0]} and min column holds ${filled[1]} — ` +
        "a min stack that is not the same height as its stack cannot undo a pop",
    );
  }

  // 0 does not become the minimum: this is the frame that separates "carry
  // the smaller" from "store what was pushed".
  const afterZero = trace.frames.find((frame) => frame.id === "op1")!;
  const columns = (afterZero.state as Extract<typeof afterZero.state, { kind: "array" }>).asides!;
  assert(
    JSON.stringify(columns[0]!.cells.map((cell) => cell.text)) === JSON.stringify(["-2", "0", ""]) &&
      JSON.stringify(columns[1]!.cells.map((cell) => cell.text)) === JSON.stringify(["-2", "-2", ""]),
    `min_stack: after push 0 the columns read ${JSON.stringify(columns.map((c) => c.cells.map((cell) => cell.text)))}, ` +
      "expected the value column to take 0 and the min column to carry -2 forward",
  );

  // The pop is what a single remembered minimum cannot do.
  const afterPop = trace.frames.find((frame) => frame.id === "op4")!;
  const popped = (afterPop.state as Extract<typeof afterPop.state, { kind: "array" }>).asides!;
  assert(
    JSON.stringify(popped[1]!.cells.map((cell) => cell.text)) === JSON.stringify(["-2", "-2", ""]),
    `min_stack: popping -3 must restore the minimum to -2, got ${JSON.stringify(popped[1]!.cells.map((cell) => cell.text))}`,
  );

  const last = trace.frames[trace.frames.length - 1]!;
  assert(
    last.caption === "getMin returns -2 in one step",
    `min_stack: the walk ends on "${last.caption}"`,
  );
}

// --- Queue from two stacks: the pour is the algorithm, so it gets a frame. ---
{
  const trace = runDefault("queue_two_stacks");
  assert(
    JSON.stringify(trace.result) === JSON.stringify([null, null, 1, 1, false]),
    `queue_two_stacks: wrong outputs ${JSON.stringify(trace.result)}`,
  );
  assert(trace.frames.length === 8, `queue_two_stacks: expected 8 frames, got ${trace.frames.length}`);

  // Without a frame for the transfer the board shows two stacks that are
  // somehow a queue, and the one move that makes it true happens off screen.
  const pour = trace.frames.find((frame) => frame.id === "pour2");
  assert(pour, "queue_two_stacks: the pour from in to out must be its own frame");
  const [inStack, outStack, queueRow] = (pour!.state as Extract<typeof pour.state, { kind: "array" }>).asides!;
  assert(
    inStack!.orientation === "column" && outStack!.orientation === "column" && queueRow!.orientation === "row",
    "queue_two_stacks: the two stacks are columns and the queue they fake is a row",
  );
  assert(
    inStack!.cells.every((cell) => cell.text === ""),
    `queue_two_stacks: the in stack must be emptied by the pour, got ${JSON.stringify(inStack!.cells.map((c) => c.text))}`,
  );
  // 2 went across first and 1 second, so 1 is on top: that reversal is the
  // whole reason two stacks make a queue.
  assert(
    JSON.stringify(outStack!.cells.map((cell) => cell.text)) === JSON.stringify(["2", "1"]),
    `queue_two_stacks: after the pour the out stack reads ${JSON.stringify(outStack!.cells.map((c) => c.text))}, ` +
      "expected 2 at the bottom and 1 on top",
  );
  // The logical queue is unchanged by the pour: nothing entered or left.
  assert(
    JSON.stringify(queueRow!.cells.map((cell) => cell.text)) === JSON.stringify(["1", "2"]),
    `queue_two_stacks: the pour must not change the queue, got ${JSON.stringify(queueRow!.cells.map((c) => c.text))}`,
  );

  const peek = trace.frames.find((frame) => frame.id === "op2")!;
  assert(
    peek.caption === "peek returns 1 without removing it",
    `queue_two_stacks: peek frame reads "${peek.caption}"`,
  );
  const last = trace.frames[trace.frames.length - 1]!;
  assert(
    last.caption === "Two stacks gave FIFO, pop returned 1 first",
    `queue_two_stacks: the walk ends on "${last.caption}"`,
  );
}

// --- Recursion: the call stack grows to the base case and then unwinds. ---
{
  const trace = runDefault("recursion_call_stack");
  assert(trace.result === 24, `recursion_call_stack: 4! is 24, got ${String(trace.result)}`);
  assert(trace.frames.length === 8, `recursion_call_stack: expected 8 frames, got ${trace.frames.length}`);

  const columnsAt = (id: string) => {
    const frame = trace.frames.find((item) => item.id === id);
    assert(frame && frame.state.kind === "array", `recursion_call_stack: no array frame ${id}`);
    const asides = (frame!.state as Extract<typeof frame.state, { kind: "array" }>).asides!;
    return asides.map((item) => item.cells.map((cell) => cell.text));
  };

  // The deepest point: every call is still on the stack and only the base
  // case has an answer. This is the frame the whole lesson turns on.
  assert(
    JSON.stringify(columnsAt("base")) === JSON.stringify([["4!", "3!", "2!", "1!"], ["", "", "", "1"]]),
    `recursion_call_stack: at the base case the columns read ${JSON.stringify(columnsAt("base"))}`,
  );

  // Halfway out: 1! has popped and 2! has its product. A trace that showed
  // the whole product appearing at once would skip the part students miss.
  assert(
    JSON.stringify(columnsAt("back2")) === JSON.stringify([["4!", "3!", "2!", ""], ["", "", "2", "1"]]),
    `recursion_call_stack: after 2! returns the columns read ${JSON.stringify(columnsAt("back2"))}`,
  );

  // The unwind must actually finish. The stack ending non-empty would mean
  // the picture never returned to the caller that started it.
  assert(
    JSON.stringify(columnsAt("back4")) === JSON.stringify([["", "", "", ""], ["24", "6", "2", "1"]]),
    `recursion_call_stack: the walk must end with an empty call stack and every return recorded, ` +
      `got ${JSON.stringify(columnsAt("back4"))}`,
  );

  // Half the frames grow the stack and half unwind it; a walk that only grew
  // would teach the half students already understand.
  const growing = trace.frames.filter((frame) => frame.id.startsWith("call")).length;
  const unwinding = trace.frames.filter((frame) => frame.id.startsWith("back")).length;
  assert(
    growing === 3 && unwinding === 3,
    `recursion_call_stack: expected 3 calls and 3 returns, got ${growing} and ${unwinding}`,
  );
  assert(
    trace.frames[trace.frames.length - 1]!.caption === "4! = 4 x 6 = 24, the stack is empty",
    `recursion_call_stack: the walk ends on "${trace.frames[trace.frames.length - 1]!.caption}"`,
  );
}

// --- Stack against queue: the same values, the two ends, side by side. ---
{
  const trace = runDefault("stack_queue_ops");
  assert(
    JSON.stringify(trace.result) === JSON.stringify({ popped: [3, 2], dequeued: [1, 2] }),
    `stack_queue_ops: wrong removal orders ${JSON.stringify(trace.result)}`,
  );
  assert(trace.frames.length === 6, `stack_queue_ops: expected 6 frames, got ${trace.frames.length}`);

  // A comparison needs both structures visible at the same instant. Two
  // separate pictures, or two separate lessons, do not make the point.
  for (const frame of trace.frames) {
    assert(frame.state.kind === "stacked", `stack_queue_ops/${frame.id}: not a stacked frame`);
    const parts = (frame.state as Extract<typeof frame.state, { kind: "stacked" }>).parts;
    assert(parts.length === 2, `stack_queue_ops/${frame.id}: expected a stack part over a queue part`);
    assert(
      parts[0]!.label === "stack" && parts[1]!.label === "queue",
      `stack_queue_ops/${frame.id}: parts are labelled ${parts.map((p) => p.label).join(", ")}`,
    );
    for (const part of parts) {
      assert(part.state.kind === "array", `stack_queue_ops/${frame.id}: a part is not an array`);
      const state = part.state as Extract<typeof part.state, { kind: "array" }>;
      // The rows never shrink: redrawing only the live contents would make a
      // removal read as the whole row sliding sideways.
      assert(
        state.cells.length === 3,
        `stack_queue_ops/${frame.id}: a row holds ${state.cells.length} cells rather than the three values`,
      );
    }
    // A stack is drawn as a column and a queue as a row. Drawing both the
    // same way is exactly the confusion the lesson is trying to clear up.
    const stackAside = (parts[0]!.state as Extract<TraceFrame["state"], { kind: "array" }>).asides![0]!;
    const queueAside = (parts[1]!.state as Extract<TraceFrame["state"], { kind: "array" }>).asides![0]!;
    assert(
      stackAside.orientation === "column" && queueAside.orientation === "row",
      `stack_queue_ops/${frame.id}: the stack must be a column and the queue a row`,
    );
    assert(
      stackAside.capacity === 3 && queueAside.capacity === 3,
      `stack_queue_ops/${frame.id}: both containers are pre-sized to the three values`,
    );
  }

  // The closing frame is the claim: the stack emptied from the right and the
  // queue from the left, on the same values in the same order.
  const last = trace.frames[trace.frames.length - 1]!;
  const parts = (last.state as Extract<typeof last.state, { kind: "stacked" }>).parts;
  const stackMarks = (parts[0]!.state as Extract<TraceFrame["state"], { kind: "array" }>).cells.map((cell) => cell.mark ?? null);
  const queueMarks = (parts[1]!.state as Extract<TraceFrame["state"], { kind: "array" }>).cells.map((cell) => cell.mark ?? null);
  assert(
    JSON.stringify(stackMarks) === JSON.stringify([null, "excluded", "excluded"]),
    `stack_queue_ops: the stack must give back its two rightmost values, got ${JSON.stringify(stackMarks)}`,
  );
  assert(
    JSON.stringify(queueMarks) === JSON.stringify(["excluded", "excluded", null]),
    `stack_queue_ops: the queue must give back its two leftmost values, got ${JSON.stringify(queueMarks)}`,
  );
  assert(
    last.caption === "Stack pops 3, queue pops 1",
    `stack_queue_ops: the walk ends on "${last.caption}"`,
  );
}

// --- Contains duplicate: [1,2,3,1] stores three keys and meets 1 again. ---
{
  const trace = runDefault("hash_set_membership");
  // Three stores then one hit: 1, 2 and 3 are new, the second 1 is not.
  const ids = trace.frames.map((frame) => frame.id);
  assert(
    JSON.stringify(ids) === JSON.stringify(["input", "add0", "add1", "add2", "hit3", "answer"]),
    `hash_set_membership: frame ids are ${ids.join(",")}`,
  );

  // The set is pre-sized to the three keys it will actually hold, not to the
  // four cells of the array. A row sized by the array would leave one slot
  // permanently blank and imply the walk stopped early when it did not.
  for (const frame of trace.frames) {
    const asides = (frame.state as { asides?: Array<{ id: string; capacity: number }> }).asides ?? [];
    const seen = asides.find((item) => item.id === "seen");
    assert(seen?.capacity === 3, `hash_set_membership/${frame.id}: seen row is ${seen?.capacity} wide, want 3`);
  }
  const hit = trace.frames.find((frame) => frame.id === "hit3")!;
  const seenAt = ((hit.state as { asides?: Array<{ id: string; cells: Array<{ text: string }> }> }).asides ?? [])
    .find((item) => item.id === "seen")!
    .cells.map((cell) => cell.text);
  assert(
    JSON.stringify(seenAt) === JSON.stringify(["1", "2", "3"]),
    `hash_set_membership: the set at the hit reads ${seenAt.join(",")}`,
  );

  // The answer frame washes exactly the two equal cells and ticks the rest,
  // so the repeated pair is visible rather than merely stated.
  const last = trace.frames[trace.frames.length - 1]!;
  const cells = (last.state as { cells: Array<{ mark?: string }> }).cells;
  const active = cells.flatMap((cell, at) => (cell.mark === "active" ? [at] : []));
  assert(
    JSON.stringify(active) === JSON.stringify([0, 3]),
    `hash_set_membership: the answer frame marks ${active.join(",")} instead of 0 and 3`,
  );
  assert(!trace.earlyExit, "hash_set_membership: the repeat is the last element, so nothing was skipped");
}

// --- Valid anagram: "anagram" and "nagaram" cancel to zero on five keys. ---
{
  const trace = runDefault("hash_map_counting");
  // One frame for the input, seven for the seven letters, one for the answer.
  assert(trace.frames.length === 9, `hash_map_counting: expected 9 frames, got ${trace.frames.length}`);

  const rowOf = (frameId: string, asideId: string) =>
    ((trace.frames.find((frame) => frame.id === frameId)!.state as {
      asides?: Array<{ id: string; cells: Array<{ text: string }> }>;
    }).asides ?? [])
      .find((item) => item.id === asideId)!
      .cells.map((cell) => cell.text);

  // Five distinct letters across both words, so the count row is five wide
  // for the whole walk even though only two keys exist at step 0.
  const first = rowOf("step0", "count");
  assert(first.length === 5, `hash_map_counting: count row is ${first.length} wide, want 5`);
  assert(
    JSON.stringify(first.slice(0, 2)) === JSON.stringify(["a:1", "n:-1"]),
    `hash_map_counting: step 0 should read a:1 and n:-1, got ${first.slice(0, 2).join(",")}`,
  );

  // Every count is back to zero at the end. This is the whole claim, and it
  // must be ink on the board rather than only a boolean in the result.
  const finalRow = rowOf("answer", "count");
  assert(
    JSON.stringify(finalRow) === JSON.stringify(["a:0", "n:0", "g:0", "r:0", "m:0"]),
    `hash_map_counting: the closing map reads ${finalRow.join(",")}`,
  );

  // t is drawn as its own row under s, seven cells wide, so both strings are
  // on the board at once rather than one replacing the other mid-walk.
  const tRow = rowOf("answer", "tstr");
  assert(
    JSON.stringify(tRow) === JSON.stringify([..."nagaram"]),
    `hash_map_counting: the t row reads ${tRow.join("")}`,
  );
}

// --- Group anagrams: six words, three signature keys, sizes 3, 2 and 1. ---
{
  const trace = runDefault("hash_map_grouping");
  // Input, one frame per word, one closing frame.
  assert(trace.frames.length === 8, `hash_map_grouping: expected 8 frames, got ${trace.frames.length}`);

  // Three keys, so the key row is three wide in every frame, and it ends
  // reading the three group sizes, which must sum to the six input words.
  const last = trace.frames[trace.frames.length - 1]!;
  const keyRow = ((last.state as { asides?: Array<{ id: string; cells: Array<{ text: string }> }> }).asides ?? [])
    .find((item) => item.id === "sig")!
    .cells.map((cell) => cell.text);
  assert(
    JSON.stringify(keyRow) === JSON.stringify(["aet:3", "ant:2", "abt:1"]),
    `hash_map_grouping: the key row reads ${keyRow.join(",")}`,
  );
  const sizes = keyRow.map((text) => Number(text.split(":")[1]));
  assert(
    sizes.reduce((total, size) => total + size, 0) === 6,
    `hash_map_grouping: the group sizes sum to ${sizes.reduce((total, size) => total + size, 0)}, not 6`,
  );

  // The closing frame regroups the words into labelled blocks. Without this
  // the answer is a count, and the student still has to pair words with keys
  // by eye off a row that never moved.
  const state = last.state as {
    cells: Array<{ text: string }>;
    groups?: Array<{ label?: string; cells: Array<{ text: string }> }>;
  };
  assert(
    JSON.stringify(state.groups?.map((group) => group.label)) === JSON.stringify(["aet", "ant", "abt"]),
    `hash_map_grouping: closing blocks are labelled ${JSON.stringify(state.groups?.map((group) => group.label))}`,
  );
  assert(
    JSON.stringify(state.groups?.map((group) => group.cells.map((cell) => cell.text))) ===
      JSON.stringify([["eat", "tea", "ate"], ["tan", "nat"], ["bat"]]),
    "hash_map_grouping: the closing blocks do not hold the three groups",
  );
  // The row keeps its six cells even when it is drawn as three blocks, so a
  // pointer index means the same thing in the closing frame as in the walk.
  assert(state.cells.length === 6, `hash_map_grouping: closing row has ${state.cells.length} cells, want 6`);
}

// --- Longest palindrome: "abccccdd" makes three pairs plus one middle. ---
{
  const trace = runDefault("char_count_pairing");
  // Input, eight letters, one pairing summary, one answer.
  assert(trace.frames.length === 11, `char_count_pairing: expected 11 frames, got ${trace.frames.length}`);

  // Exactly three pairs complete during the walk: the second c, the fourth c
  // and the second d. A fourth would mean an odd count was paired with itself.
  const completed = trace.frames.filter((frame) => frame.caption.includes("completes pair"));
  assert(
    completed.length === 3,
    `char_count_pairing: "abccccdd" makes three pairs, got ${completed.length} frames claiming one`,
  );
  assert(
    JSON.stringify(completed.map((frame) => frame.id)) === JSON.stringify(["read3", "read5", "read7"]),
    `char_count_pairing: pairs complete at ${completed.map((frame) => frame.id).join(",")}`,
  );

  // The pairing frame ticks the six paired cells and dashes the two odd ones.
  // Six plus two is eight, the length of the string, so nothing is unaccounted.
  const pairs = trace.frames.find((frame) => frame.id === "pairs")!;
  const marks = (pairs.state as { cells: Array<{ mark?: string }> }).cells.map((cell) => cell.mark);
  assert(
    marks.filter((mark) => mark === "done").length === 6 &&
      marks.filter((mark) => mark === "candidate").length === 2,
    `char_count_pairing: pairing frame marks ${JSON.stringify(marks)}`,
  );

  // A palindrome has exactly one middle, so exactly one odd letter is washed
  // and the rest are struck out. Two washed cells would be a wrong lesson.
  const answer = trace.frames[trace.frames.length - 1]!;
  const finalMarks = (answer.state as { cells: Array<{ mark?: string }> }).cells.map((cell) => cell.mark);
  assert(
    finalMarks.filter((mark) => mark === "active").length === 1 &&
      finalMarks.filter((mark) => mark === "excluded").length === 1,
    `char_count_pairing: answer frame marks ${JSON.stringify(finalMarks)}`,
  );

  // The counts on the board must add up to the string that produced them.
  const countRow = ((answer.state as { asides?: Array<{ id: string; cells: Array<{ text: string }> }> }).asides ?? [])
    .find((item) => item.id === "count")!
    .cells.map((cell) => cell.text);
  assert(
    JSON.stringify(countRow) === JSON.stringify(["a:1", "b:1", "c:4", "d:2"]),
    `char_count_pairing: the count row reads ${countRow.join(",")}`,
  );
  assert(
    countRow.reduce((total, text) => total + Number(text.split(":")[1]), 0) === 8,
    "char_count_pairing: the counts do not sum to the eight letters of the input",
  );
}

// --- Hash map buckets: 12, 7 and 22 all land on bucket 2; 3 lands alone. ---
{
  const trace = runDefault("hash_map_buckets");
  // Setup, one frame per key, a lookup, and the finished table.
  assert(trace.frames.length === 7, `hash_map_buckets: expected 7 frames, got ${trace.frames.length}`);

  // Every frame stacks the key row over the bucket table. The keys have to
  // stay on the board: a table on its own says nothing about where a value
  // came from, and the modulo step is the whole lesson.
  for (const frame of trace.frames) {
    assert(frame.state.kind === "stacked", `hash_map_buckets/${frame.id}: not a stacked frame`);
    const parts = (frame.state as { parts: Array<{ state: { kind: string }; label?: string }> }).parts;
    assert(
      parts.length === 2 && parts[0]!.state.kind === "array" && parts[1]!.state.kind === "grid",
      `hash_map_buckets/${frame.id}: parts are ${parts.map((part) => part.state.kind).join(",")}`,
    );
    const grid = parts[1]!.state as unknown as { rowLabels: string[]; colLabels: string[]; cells: Array<Array<{ text: string }>> };
    // Five rows because the table has five buckets; three columns because the
    // deepest chain holds three keys.
    assert(
      grid.rowLabels.length === 5 && grid.colLabels.length === 3,
      `hash_map_buckets/${frame.id}: table is ${grid.rowLabels.length} by ${grid.colLabels.length}, want 5 by 3`,
    );
    assert(grid.cells.length === 5 && grid.cells.every((row) => row.length === 3), `hash_map_buckets/${frame.id}: ragged table`);
  }

  // Two of the four inserts collide, because only 3 finds an empty bucket.
  const chained = trace.frames.filter((frame) => frame.caption.includes("chains on"));
  assert(
    chained.length === 2,
    `hash_map_buckets: 7 and 22 both collide with 12, so two inserts chain, got ${chained.length}`,
  );

  // The finished table: bucket 2 reads 12, 7, 22 across its three columns and
  // bucket 3 holds 3 alone. This is the value-in-the-right-cell check.
  const last = trace.frames[trace.frames.length - 1]!;
  const table = ((last.state as { parts: Array<{ state: unknown }> }).parts[1]!.state as {
    cells: Array<Array<{ text: string }>>;
  }).cells.map((row) => row.map((cell) => cell.text));
  assert(
    JSON.stringify(table) ===
      JSON.stringify([["", "", ""], ["", "", ""], ["12", "7", "22"], ["3", "", ""], ["", "", ""]]),
    `hash_map_buckets: the finished table is ${JSON.stringify(table)}`,
  );

  // The lookup walks past two misses to one hit. Without it chaining looks
  // like a way to avoid losing data rather than something a read can survive.
  const find = trace.frames.find((frame) => frame.id === "find")!;
  const chain = ((find.state as { parts: Array<{ state: unknown }> }).parts[1]!.state as {
    cells: Array<Array<{ mark?: string }>>;
  }).cells[2]!.map((cell) => cell.mark);
  assert(
    JSON.stringify(chain) === JSON.stringify(["excluded", "excluded", "active"]),
    `hash_map_buckets: the lookup marks bucket 2 as ${JSON.stringify(chain)}`,
  );
}

// --- Climbing stairs: n = 6 has 13 routes, and the table is built, not shown. ---
{
  // ways(0) = 1 (stand still), ways(1) = 1, ways(2) = 1 + 1 = 2,
  // ways(3) = 2 + 1 = 3, ways(4) = 3 + 2 = 5, ways(5) = 5 + 3 = 8,
  // ways(6) = 8 + 5 = 13.
  const trace = runDefault("dp_fibonacci");
  assert(trace.result === 13, `dp_fibonacci: six stairs have 13 routes, got ${String(trace.result)}`);
  assert(trace.frames.length === 6, `dp_fibonacci: one base frame plus i = 2..6, got ${trace.frames.length}`);

  // dp[4] = dp[3] + dp[2] = 3 + 2 = 5, and cells past 4 are still blank: a
  // simulator that filled the row up front would draw a finished table and
  // narrate it being built.
  const write = trace.frames.find((frame) => frame.id === "stair4")!;
  assert(
    JSON.stringify(panelOf(write, 1)) === JSON.stringify(["1", "1", "2", "3", "5", "", ""]),
    `dp_fibonacci/stair4: dp row is ${JSON.stringify(panelOf(write, 1))}`,
  );
  assert(
    JSON.stringify(markedIn(write, 1, "window")) === JSON.stringify([2, 3]),
    "dp_fibonacci/stair4: the cell must read dp[2] and dp[3], nothing else",
  );
  assert(
    JSON.stringify(markedIn(write, 1, "active")) === JSON.stringify([4]),
    "dp_fibonacci/stair4: exactly one cell is being written",
  );

  // The input panel is the move set. Drawing the staircase there would repeat
  // the index row underneath and state the actual rule nowhere.
  for (const frame of trace.frames) {
    assert(
      JSON.stringify(panelOf(frame, 0)) === JSON.stringify(["1", "2"]),
      `dp_fibonacci/${frame.id}: input panel is ${JSON.stringify(panelOf(frame, 0))}`,
    );
  }
}

// --- Min cost climbing stairs: [1,100,1,1,1,100] costs 3 to reach the top. ---
{
  // dp[0] = dp[1] = 0 (either is a free start).
  // dp[2] = min(dp[1] + 100, dp[0] + 1) = min(100, 1) = 1.
  // dp[3] = min(dp[2] + 1, dp[1] + 100) = min(2, 100) = 2.
  // dp[4] = min(dp[3] + 1, dp[2] + 1) = min(3, 2) = 2.
  // dp[5] = min(dp[4] + 1, dp[3] + 1) = min(3, 3) = 3.
  // dp[6] = min(dp[5] + 100, dp[4] + 1) = min(103, 3) = 3.
  const trace = runDefault("dp_min_cost_stairs");
  assert(trace.result === 3, `dp_min_cost_stairs: expected 3, got ${String(trace.result)}`);

  const last = trace.frames[trace.frames.length - 1]!;
  // The table is one cell longer than the input: the answer is the top of the
  // floor, one past the last step. Same-width tables answer "cheapest way to
  // stand on the last step", which is 10 rather than 15 on [10,15,20].
  assert(
    panelOf(last, 1).length === panelOf(last, 0).length + 1,
    `dp_min_cost_stairs: dp has ${panelOf(last, 1).length} cells for ${panelOf(last, 0).length} costs`,
  );
  assert(
    JSON.stringify(panelOf(last, 1)) === JSON.stringify(["0", "0", "1", "2", "2", "3", "3"]),
    `dp_min_cost_stairs: dp row is ${JSON.stringify(panelOf(last, 1))}`,
  );

  // The final cell comes from step 4 for 1, not from step 5 for 100, so the
  // cost cell the walk lights is index 4.
  assert(
    JSON.stringify(markedIn(last, 0, "active")) === JSON.stringify([4]),
    `dp_min_cost_stairs: the winning cost is c[4] = 1, marked ${JSON.stringify(markedIn(last, 0, "active"))}`,
  );

  const base = trace.frames[0]!;
  assert(
    panelOf(base, 1)[0] === "0" && panelOf(base, 1)[1] === "0",
    "dp_min_cost_stairs: both of the first two steps are free to start from",
  );

  // On [10,15,20] the two readings visibly differ: standing on the last step
  // costs 10, reaching the top costs 15, and 15 is the answer.
  const short = familyById("dp_min_cost_stairs")!.run("cost = [10,15,20]");
  assert(short?.exampleSource === "question", "dp_min_cost_stairs: the question's own costs must be used");
  assert(short!.trace.result === 15, `dp_min_cost_stairs [10,15,20]: expected 15, got ${String(short!.trace.result)}`);
  const shortLast = short!.trace.frames[short!.trace.frames.length - 1]!;
  assert(
    panelOf(shortLast, 1)[2] === "10" && panelOf(shortLast, 1)[3] === "15",
    `dp_min_cost_stairs [10,15,20]: dp is ${JSON.stringify(panelOf(shortLast, 1))}`,
  );
}

// --- House robber: [2,7,9,3,1] takes houses 0, 2 and 4 for 12. ---
{
  // dp[0] = 2. dp[1] = max(2, 7) = 7. dp[2] = max(7, 2 + 9) = 11.
  // dp[3] = max(11, 7 + 3) = max(11, 10) = 11. dp[4] = max(11, 11 + 1) = 12.
  // Robbing houses 0, 2 and 4 gives 2 + 9 + 1 = 12, the answer LeetCode states.
  const trace = runDefault("dp_house_robber");
  assert(trace.result === 12, `dp_house_robber: expected 12, got ${String(trace.result)}`);
  assert(trace.frames.length === 5, `dp_house_robber: base, dp[1], then i = 2..4, got ${trace.frames.length}`);

  const last = trace.frames[trace.frames.length - 1]!;
  assert(
    JSON.stringify(panelOf(last, 1)) === JSON.stringify(["2", "7", "11", "11", "12"]),
    `dp_house_robber: dp row is ${JSON.stringify(panelOf(last, 1))}`,
  );

  // dp[3] is a max and not a sum. Adding the two reads would write 11 + 3 = 14
  // and the table would still look plausible all the way to the end.
  const third = trace.frames.find((frame) => frame.id === "house3")!;
  assert(
    panelOf(third, 1)[3] === "11",
    `dp_house_robber/house3: skipping house 3 keeps 11, robbing it gives dp[1] + 3 = 10, got ${panelOf(third, 1)[3]}`,
  );

  // The final cell took the rob branch, so the cell it read is dp[2] and the
  // one it merely compared is dp[3]. Exactly one of the two is bracketed.
  assert(
    JSON.stringify(markedIn(last, 1, "window")) === JSON.stringify([2]) &&
      JSON.stringify(markedIn(last, 1, "candidate")) === JSON.stringify([3]),
    `dp_house_robber/house4: reads are window ${JSON.stringify(markedIn(last, 1, "window"))}, candidate ${JSON.stringify(markedIn(last, 1, "candidate"))}`,
  );
}

// --- Coin change: [1,3,4] makes 6 with two coins, where greedy takes three. ---
{
  // dp[0] = 0. dp[1] = 1 + dp[0] = 1. dp[2] = 1 + dp[1] = 2.
  // dp[3] = min(1 + dp[2], 1 + dp[0]) = min(3, 1) = 1.
  // dp[4] = min(1 + dp[3], 1 + dp[1], 1 + dp[0]) = min(2, 2, 1) = 1.
  // dp[5] = min(1 + dp[4], 1 + dp[2], 1 + dp[1]) = min(2, 3, 2) = 2.
  // dp[6] = min(1 + dp[5], 1 + dp[3], 1 + dp[2]) = min(3, 2, 3) = 2, a 3 and a 3.
  // Largest coin first would take 4, then 1, then 1: three coins.
  // For coins [2,4,6] and amount 3: dp[1] is infinity because no coin is small
  // enough, dp[2] = 1, and dp[3] can only spend the 2, which leaves dp[1] at
  // infinity, so dp[3] is infinity too and the answer is minus one.
  const trace = runDefault("dp_coin_change");
  assert(trace.result === 2, `dp_coin_change: 6 is 3 + 3, so two coins, got ${String(trace.result)}`);

  const last = trace.frames[trace.frames.length - 1]!;
  assert(
    JSON.stringify(panelOf(last, 1)) === JSON.stringify(["0", "1", "2", "1", "1", "2", "2"]),
    `dp_coin_change: dp row is ${JSON.stringify(panelOf(last, 1))}`,
  );
  assert(
    panelOf(last, 1).length === 7,
    "dp_coin_change: the table runs from amount 0 to amount 6, and dp[0] is a real base case",
  );

  // The winning coin is the 3, not the 4. This is the whole reason the family
  // exists rather than a greedy scan, and it is the one cell where the two
  // disagree on the default input.
  assert(
    JSON.stringify(markedIn(last, 0, "active")) === JSON.stringify([1]),
    `dp_coin_change: coin index 1 is the 3 and must win, marked ${JSON.stringify(markedIn(last, 0, "active"))}`,
  );

  // An amount nothing can make is drawn as infinity, not left blank: blank
  // means "not reached yet" and the two must not look the same.
  const impossible = familyById("dp_coin_change")!.run("coins = [2,4,6], amount = 3");
  assert(impossible?.exampleSource === "question", "dp_coin_change: the question's own coins must be used");
  assert(impossible!.trace.result === -1, "dp_coin_change: even denominations cannot make 3");
  const tail = impossible!.trace.frames[impossible!.trace.frames.length - 1]!;
  assert(
    panelOf(tail, 1)[1] === "∞" && panelOf(tail, 1)[3] === "∞",
    `dp_coin_change: amounts 1 and 3 are unreachable, row is ${JSON.stringify(panelOf(tail, 1))}`,
  );
}

// --- Longest increasing subsequence: [10,9,2,5,3,7,101,18] is 4 long. ---
{
  // dp[i] is the longest run ending at i:
  // dp[0] = 1 (10). dp[1] = 1 (nothing before 9 is smaller). dp[2] = 1.
  // dp[3] = 1 + dp[2] = 2 (5 follows 2). dp[4] = 1 + dp[2] = 2 (3 follows 2).
  // dp[5] = 1 + max(dp[2], dp[3], dp[4]) = 3 (7 follows 5).
  // dp[6] = 1 + dp[5] = 4 (101 follows 7). dp[7] = 1 + dp[5] = 4 (18 follows 7).
  // Max is 4, first at index 6, and the predecessors run 6 to 5 to 3 to 2,
  // which is 2, 5, 7, 101: LeetCode's stated subsequence.
  const trace = runDefault("dp_lis");
  assert(trace.result === 4, `dp_lis: expected 4, got ${String(trace.result)}`);
  assert(trace.frames.length === 9, `dp_lis: eight positions plus the answer, got ${trace.frames.length}`);

  const walked = trace.frames[7]!;
  assert(
    JSON.stringify(panelOf(walked, 1)) === JSON.stringify(["1", "1", "1", "2", "2", "3", "4", "4"]),
    `dp_lis: dp row is ${JSON.stringify(panelOf(walked, 1))}`,
  );

  // 101 extends 7 at index 5, not 18 and not 10. The bracketed read is the one
  // whose value flowed into the cell.
  const at101 = trace.frames.find((frame) => frame.id === "pos6")!;
  assert(
    JSON.stringify(markedIn(at101, 1, "window")) === JSON.stringify([5]),
    `dp_lis/pos6: read is ${JSON.stringify(markedIn(at101, 1, "window"))}, want index 5`,
  );

  // The answer is the largest cell, not the last one. On this input dp[7] is
  // also 4, so a walk that read the end would agree by luck; the closing frame
  // has to mark the cell that actually holds the maximum and name the run.
  const answer = trace.frames[trace.frames.length - 1]!;
  assert(answer.id === "answer", `dp_lis: the walk must close on its answer, got ${answer.id}`);
  assert(
    JSON.stringify(markedIn(answer, 1, "active")) === JSON.stringify([6]),
    `dp_lis: the maximum is first reached at index 6, marked ${JSON.stringify(markedIn(answer, 1, "active"))}`,
  );
  assert(
    JSON.stringify(markedIn(answer, 0, "done")) === JSON.stringify([2, 3, 5, 6]),
    `dp_lis: the run is 2, 5, 7, 101 at indices 2, 3, 5, 6, ticked ${JSON.stringify(markedIn(answer, 0, "done"))}`,
  );
}

// --- Kadane: [-2,1,-3,4,-1,2,1] is 6, from index 3 to index 6. ---
{
  // cur[i] is the best sum of a subarray ending at i:
  // cur[0] = -2, best -2.
  // i = 1: max(1, -2 + 1 = -1) = 1, so the run restarts at index 1; best 1.
  // i = 2: max(-3, 1 + -3 = -2) = -2, carry on; best stays 1.
  // i = 3: max(4, -2 + 4 = 2) = 4, restart at index 3; best 4.
  // i = 4: max(-1, 4 + -1 = 3) = 3, carry on; best stays 4.
  // i = 5: max(2, 3 + 2 = 5) = 5, carry on; best 5.
  // i = 6: max(1, 5 + 1 = 6) = 6, carry on; best 6, run indices 3 to 6.
  // 4 + (-1) + 2 + 1 = 6, which is LeetCode's stated subarray.
  const trace = runDefault("kadane");
  assert(trace.result === 6, `kadane: expected 6, got ${String(trace.result)}`);
  assert(trace.frames.length === 8, `kadane: seven positions plus the answer, got ${trace.frames.length}`);

  // The running row is the algorithm. A walk that forgot to restart would read
  // -2,-1,-4,0,-1,1,2 and still finish on a board that looks like a walk.
  const last = trace.frames[trace.frames.length - 1]!;
  assert(last.state.kind === "array", "kadane: frames are plain array rows, not a table");
  const cur = (last.state as Extract<typeof last.state, { kind: "array" }>).asides?.[0];
  assert(
    cur?.id === "cur" && JSON.stringify(cur.cells.map((cell) => cell.text)) === JSON.stringify(["-2", "1", "-2", "4", "3", "5", "6"]),
    `kadane: running sums are ${JSON.stringify(cur?.cells.map((cell) => cell.text))}`,
  );
  assert(cur!.capacity === 7, `kadane: one aside slot per input cell, got ${cur!.capacity}`);

  // The winning stretch is bracketed and named, so the answer is ink rather
  // than an assertion in the narration.
  const brackets = (last.state as Extract<typeof last.state, { kind: "array" }>).brackets ?? [];
  assert(
    brackets.length === 1 && brackets[0]!.from === 3 && brackets[0]!.to === 6 && brackets[0]!.label === "best sum 6",
    `kadane: closing bracket is ${JSON.stringify(brackets)}, want indices 3 to 6 labelled "best sum 6"`,
  );

  // The restart at index 1 is the step the whole algorithm turns on: carrying
  // -2 forward gives -1, which is worse than starting again at 1.
  const restart = trace.frames.find((frame) => frame.id === "pos1")!;
  const restartBracket = (restart.state as Extract<typeof restart.state, { kind: "array" }>).brackets?.[0];
  assert(
    restartBracket?.from === 1 && restartBracket.to === 1,
    `kadane/pos1: the run must restart, bracket is ${JSON.stringify(restartBracket)}`,
  );

  // Every frame keeps its bracket, or the figure changes height and rescales.
  for (const frame of trace.frames) {
    const state = frame.state as Extract<typeof frame.state, { kind: "array" }>;
    assert(state.brackets?.length === 1, `kadane/${frame.id}: every frame needs its region bracket`);
  }
}

// --- Jump game: [2,3,1,1,4] is reachable and [3,2,1,0,4] is blocked. ---
{
  // reach is the furthest index standable on.
  // [2,3,1,1,4]: i = 0 gives 0 + 2 = 2. i = 1 gives 1 + 3 = 4. i = 2 gives
  // 2 + 1 = 3, no gain. i = 3 gives 3 + 1 = 4, no gain. i = 4 gives 4 + 4 = 8.
  // Every index was within reach when the scan arrived, so the last one is too.
  // [3,2,1,0,4]: i = 0 gives 3, and i = 1, 2 and 3 all give 3. Index 4 is
  // beyond 3, so the scan stops there and the answer is false.
  const trace = runDefault("greedy_jump");
  assert(trace.result === true, `greedy_jump: [2,3,1,1,4] is reachable, got ${String(trace.result)}`);
  assert(trace.frames.length === 6, `greedy_jump: five indices plus the verdict, got ${trace.frames.length}`);
  assert(!trace.earlyExit, "greedy_jump: the successful scan runs to the end of the array");

  const last = trace.frames[trace.frames.length - 1]!;
  const reach = (last.state as Extract<typeof last.state, { kind: "array" }>).asides?.[0];
  assert(
    reach?.id === "reach" && JSON.stringify(reach.cells.map((cell) => cell.text)) === JSON.stringify(["2", "4", "4", "4", "8"]),
    `greedy_jump: reach is ${JSON.stringify(reach?.cells.map((cell) => cell.text))}, want 2,4,4,4,8`,
  );

  // Reach is a high water mark. Indices 2 and 3 reach only 3 and 4, so a
  // simulator that assigned rather than maxed would drop it to 3 and answer
  // false on an array that is reachable.
  assert(
    reach!.cells[2]!.text === "4" && reach!.cells[3]!.text === "4",
    "greedy_jump: a shorter jump must not shrink the reach",
  );

  // The blocked case: the scan stops at the first index it cannot stand on,
  // and says so on the board rather than walking the rest of the array.
  const blocked = familyById("greedy_jump")!.run("jump game on nums = [3,2,1,0,4]");
  assert(blocked?.exampleSource === "question", "greedy_jump: the question's own array must be used");
  assert(blocked!.trace.result === false, "greedy_jump: [3,2,1,0,4] cannot reach the last index");
  assert(blocked!.trace.earlyExit === true, "greedy_jump: a blocked scan exits before the end");
  assert(blocked!.trace.frames.length === 5, `greedy_jump: indices 0..3 then the verdict, got ${blocked!.trace.frames.length}`);
  const verdict = blocked!.trace.frames[4]!;
  const cells = (verdict.state as Extract<typeof verdict.state, { kind: "array" }>).cells;
  assert(
    cells[4]!.mark === "excluded",
    `greedy_jump: index 4 is out of reach and must be struck out, mark is ${String(cells[4]!.mark)}`,
  );
}

// --- Rotated binary search: [4,5,6,7,0,1,2] for 0 lands on index 4. ---
{
  // lo=0, hi=6, mid=3, a[3]=7. a[0]=4 <= 7, so [0..3] = 4,5,6,7 is the sorted
  // half; 0 is not in [4,7], so that half goes and lo=4. lo=4, hi=6, mid=5,
  // a[5]=1. a[4]=0 <= 1, so [4..5] = 0,1 is sorted; 0 is in [0,1], so the
  // other half goes and hi=4. lo=hi=mid=4, a[4]=0, found. Three probes.
  const trace = runDefault("rotated_binary_search");
  assert(trace.result === 4, `rotated_binary_search: expected index 4, got ${String(trace.result)}`);
  assert(trace.frames.length === 4, `rotated_binary_search: one intro plus three probes, got ${trace.frames.length}`);

  const mids = trace.frames
    .map((frame) => (frame.state.kind === "array" ? frame.state.pointers?.find((p) => p.name === "mid")?.index : undefined))
    .filter((index): index is number => index !== undefined);
  assert(
    JSON.stringify(mids) === JSON.stringify([3, 5, 4]),
    `rotated_binary_search: probe sequence should be 3,5,4 — got ${mids.join(",")}`,
  );

  // The teaching content is the sorted-half decision, so it must be ink on
  // every probe frame, not a sentence in the narration.
  const probes = trace.frames.filter((frame) => (frame.state as { pointers?: Array<{ name: string }> }).pointers?.some((p) => p.name === "mid"));
  assert(probes.length === 3, `rotated_binary_search: expected 3 probe frames, got ${probes.length}`);
  for (const frame of probes) {
    const state = frame.state as Extract<typeof frame.state, { kind: "array" }>;
    assert(
      // "sorted", not "sorted half": the two labels are 11 and 12 characters
      // and the last probe spans one and two cells, so the pair overlapped on
      // the board. The claim is the same, the words are shorter.
      state.brackets?.some((bracket) => bracket.label === "sorted"),
      `rotated_binary_search/${frame.id}: no "sorted" bracket, so the board never says which half is in order`,
    );
  }

  // The first probe splits 7 values at index 3: [0..3] sorted, [4..6] rotated.
  const firstProbe = trace.frames[1]!;
  const first = firstProbe.state as Extract<typeof firstProbe.state, { kind: "array" }>;
  assert(
    JSON.stringify(first.brackets) ===
      JSON.stringify([
        { from: 0, to: 3, label: "sorted" },
        { from: 4, to: 6, label: "rotated" },
      ]),
    `rotated_binary_search: first probe brackets are ${JSON.stringify(first.brackets)}`,
  );

  // The array must reach the board rotated. Sorting it is the defect that
  // made binary_search veto this statement in the first place.
  assert(
    JSON.stringify(arrayOf(trace.frames[0]!)) === JSON.stringify(["4", "5", "6", "7", "0", "1", "2"]),
    "rotated_binary_search: the board must show the rotated order, not a sorted copy",
  );
}

// --- Binary search on the answer: piles [3,6,7,11] in 8 hours needs speed 4. ---
{
  // The search space is speeds 1 to 11 (the largest pile), and hours at speed k
  // is the sum of the ceilings. lo=1, hi=11, mid=6: 1+1+2+2 = 6 hours, within
  // 8, so hi=6. mid=3: 1+2+3+4 = 10 hours, over 8, so lo=4. mid=5: 1+2+2+3 = 8,
  // within, hi=5. mid=4: 1+2+2+3 = 8, within, hi=4. lo=hi=4. Speed 3 needs 10
  // and speed 4 needs exactly 8, so 4 is the slowest that fits.
  const trace = runDefault("binary_search_on_answer");
  assert(trace.result === 4, `binary_search_on_answer: expected speed 4, got ${String(trace.result)}`);
  assert(trace.frames.length === 6, `binary_search_on_answer: one intro, four probes, one answer; got ${trace.frames.length}`);

  // The row on the board is the SEARCH SPACE, not the input. Drawing the four
  // piles and putting lo/mid/hi on them is how this problem is mistaught.
  const row = arrayOf(trace.frames[0]!);
  assert(row.length === 11, `binary_search_on_answer: the row should be 11 candidate speeds, got ${row.length} cells`);
  assert(
    JSON.stringify(row) === JSON.stringify(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]),
    `binary_search_on_answer: the row must read 1..11, got ${row.join(",")}`,
  );
  assert(row[0] !== "3", "binary_search_on_answer: cell 0 is speed 1, not the first pile");

  // Speed k lives at index k-1, so writing 0..10 under speeds 1..11 would let
  // a student read the answer off the index and say 3.
  for (const frame of trace.frames) {
    const state = frame.state as Extract<typeof frame.state, { kind: "array" }>;
    assert(state.showIndices === false, `binary_search_on_answer/${frame.id}: indices under a row of speeds are off by one`);
  }

  // mid = 6 (6 h, fits) -> 3 (10 h, too slow) -> 5 (8 h, fits) -> 4 (8 h, fits).
  const probes = trace.frames
    .map((frame) => (frame.state.kind === "array" ? frame.state.pointers?.find((p) => p.name === "mid")?.index : undefined))
    .filter((index): index is number => index !== undefined)
    .map((index) => index + 1);
  assert(
    JSON.stringify(probes) === JSON.stringify([6, 3, 5, 4]),
    `binary_search_on_answer: probe speeds should be 6,3,5,4 — got ${probes.join(",")}`,
  );

  // The piles are still on the board, as the aside they are.
  const opener = trace.frames[0]!;
  const piles = (opener.state as Extract<typeof opener.state, { kind: "array" }>).asides?.[0];
  assert(
    piles?.id === "piles" && JSON.stringify(piles.cells.map((cell) => cell.text)) === JSON.stringify(["3", "6", "7", "11"]),
    `binary_search_on_answer: the piles must appear as an aside, got ${JSON.stringify(piles)}`,
  );
}

// --- Merge sorted arrays: four writes from the back fill six slots. ---
{
  // k=5: 3 against 6, 6 wins. k=4: 3 against 5, 5 wins. k=3: 3 against 2, 3
  // wins. k=2: 2 against 2, not greater, so nums2's 2 wins and nums2 is spent.
  // Slots 0 and 1 already hold 1 and 2, which are correct, so four writes fill
  // six slots and the result is [1,2,2,3,5,6].
  const trace = runDefault("merge_two_sorted_arrays");
  assert(
    JSON.stringify(trace.result) === JSON.stringify([1, 2, 2, 3, 5, 6]),
    `merge_two_sorted_arrays: wrong merge ${JSON.stringify(trace.result)}`,
  );
  assert(trace.frames.length === 6, `merge_two_sorted_arrays: one intro, four writes, one answer; got ${trace.frames.length}`);

  // Four writes, at slots 5, 4, 3 and 2. Slots 1 and 0 are never touched,
  // which is the point of merging backwards.
  const writes = trace.frames.filter((frame) => frame.id.startsWith("w")).map((frame) => Number(frame.id.slice(1)));
  assert(
    JSON.stringify(writes) === JSON.stringify([5, 4, 3, 2]),
    `merge_two_sorted_arrays: writes should run 5,4,3,2 — got ${writes.join(",")}`,
  );

  // j indexes nums2, not the drawn row. A pointer named j on the main row
  // would mark a cell it has nothing to do with.
  for (const frame of trace.frames) {
    const state = frame.state as Extract<typeof frame.state, { kind: "array" }>;
    assert(
      !(state.pointers ?? []).some((pointer) => pointer.name === "j"),
      `merge_two_sorted_arrays/${frame.id}: j is an index into nums2 and must not sit on the nums1 row`,
    );
    assert(
      state.asides?.some((item) => item.id === "nums2" && item.capacity === 3),
      `merge_two_sorted_arrays/${frame.id}: nums2 must be a fixed-width aside`,
    );
  }

  // Every intermediate board is a real snapshot of nums1, so the first write
  // must land 6 in slot 5 and leave the rest alone.
  assert(
    JSON.stringify(arrayOf(trace.frames[1]!)) === JSON.stringify(["1", "2", "3", "0", "0", "6"]),
    `merge_two_sorted_arrays: after the first write the row is ${arrayOf(trace.frames[1]!).join(",")}`,
  );
  assert(
    JSON.stringify(arrayOf(trace.frames[trace.frames.length - 1]!)) === JSON.stringify(["1", "2", "2", "3", "5", "6"]),
    "merge_two_sorted_arrays: the last frame must show the merged row",
  );
}

// --- 3Sum: [-1,0,1,2,-1,-4] has two triplets and one duplicate skip. ---
{
  // Sorted: [-4,-1,-1,0,1,2].
  // Fix a[0] = -4: (1,5) gives -3; (2,5) gives -3; (3,5) gives -2; (4,5) gives
  // -1. All under 0, so left ran up to 5 and the scan ended. Four steps.
  // Fix a[1] = -1: (2,5) gives -1-1+2 = 0, a hit; markers move to (3,4) which
  // gives -1+0+1 = 0, a second hit. Two hits.
  // a[2] = -1 repeats a[1], so it is skipped.
  // Fix a[3] = 0: (4,5) gives 3, over 0, right comes down and the scan ends.
  // Total step frames 4+2+1+1 = 8, plus the unsorted opener and the answer = 10.
  const trace = runDefault("three_sum_two_pointers");
  assert(
    JSON.stringify(trace.result) === JSON.stringify([[-1, -1, 2], [-1, 0, 1]]),
    `three_sum_two_pointers: wrong triplets ${JSON.stringify(trace.result)}`,
  );
  assert(trace.frames.length === 10, `three_sum_two_pointers: expected 10 frames, got ${trace.frames.length}`);

  // The sort is not bookkeeping: the student has to see the input before it,
  // or the two-pointer step looks like it works on anything.
  assert(
    JSON.stringify(arrayOf(trace.frames[0]!)) === JSON.stringify(["-1", "0", "1", "2", "-1", "-4"]),
    "three_sum_two_pointers: the first frame must show the unsorted input",
  );
  assert(
    JSON.stringify(arrayOf(trace.frames[1]!)) === JSON.stringify(["-4", "-1", "-1", "0", "1", "2"]),
    "three_sum_two_pointers: every frame after the first shows the sorted array",
  );

  // Exactly two hits, and exactly one duplicate skip. Dropping the skip still
  // finds both triplets and then finds them again, so only the frame count
  // catches it.
  const hits = trace.frames.filter((frame) => frame.id.startsWith("hit"));
  assert(hits.length === 2, `three_sum_two_pointers: [-1,-1,2] and [-1,0,1] are two hits, got ${hits.length}`);
  const skips = trace.frames.filter((frame) => frame.id.startsWith("skip"));
  assert(
    skips.length === 1 && skips[0]!.id === "skip2",
    `three_sum_two_pointers: a[2] repeats a[1] and must be skipped, got ${JSON.stringify(skips.map((f) => f.id))}`,
  );

  // Fixing -4 costs four steps and finds nothing: -4 + -1 + 2 is -3, and the
  // best it ever reaches is -4 + 1 + 2 = -1.
  const fixedFirst = trace.frames.filter((frame) => frame.id.startsWith("lo0_"));
  assert(fixedFirst.length === 4, `three_sum_two_pointers: -4 takes four steps to rule out, got ${fixedFirst.length}`);

  // Three markers, and the fixed one is a marker like the other two.
  const firstWalk = trace.frames[1]!;
  const walk = firstWalk.state as Extract<typeof firstWalk.state, { kind: "array" }>;
  assert(
    JSON.stringify((walk.pointers ?? []).map((p) => `${p.name}@${p.index}`)) === JSON.stringify(["i@0", "left@1", "right@5"]),
    `three_sum_two_pointers: the first walk frame's markers are ${JSON.stringify(walk.pointers)}`,
  );
}

// --- Trapping rain water: five pools hold 1, 1, 2, 1 and 1, so 6 units. ---
{
  // Running maxima on [0,1,0,2,1,0,1,3,2,1,2,1]:
  //   leftMax  = [0,1,1,2,2,2,2,3,3,3,3,3]
  //   rightMax = [3,3,3,3,3,3,3,3,2,2,2,1]
  // Water at a column is min(leftMax, rightMax) - height, floored at 0, so
  // column 2 holds 1, column 4 holds 1, column 5 holds 2, column 6 holds 1 and
  // column 9 holds 1. Total 1+1+2+1+1 = 6. The two markers price one column per
  // step and meet on index 7, the tallest column, which is never priced: 12
  // columns, 11 steps, plus the opener and the total is 13 frames.
  const trace = runDefault("trapping_rain_water_two_pointers");
  assert(trace.result === 6, `trapping_rain_water: expected 6 units, got ${String(trace.result)}`);
  assert(trace.frames.length === 13, `trapping_rain_water: 11 steps plus an opener and a total, got ${trace.frames.length}`);

  const row = arrayOf(trace.frames[0]!);
  assert(
    JSON.stringify(row) === JSON.stringify(["0", "1", "0", "2", "1", "0", "1", "3", "2", "1", "2", "1"]),
    `trapping_rain_water: the elevation map is ${row.join(",")}`,
  );

  // The captions carry the depth per column, so a wrong depth cannot hide
  // inside a right total.
  const depths = trace.frames.flatMap((frame) => {
    const match = /^Column (\d+) is \d+ under a wall of \d+: (\d+) deep$/.exec(frame.caption);
    return match ? [[Number(match[1]), Number(match[2])] as const] : [];
  });
  assert(
    JSON.stringify(depths) === JSON.stringify([[2, 1], [9, 1], [4, 1], [5, 2], [6, 1]]),
    `trapping_rain_water: the pools priced are ${JSON.stringify(depths)}`,
  );
  assert(
    depths.reduce((sum, [, held]) => sum + held, 0) === 6,
    "trapping_rain_water: the priced pools must add up to the stated answer",
  );

  // The markers meet on the tallest column, index 7, which is why it is the
  // one column the walk never prices.
  assert(
    !depths.some(([at]) => at === 7),
    "trapping_rain_water: column 7 is the tallest and holds nothing, so it must never be priced",
  );

  // The water has to be ink. On an elevation map with a zero column the
  // simulator draws a depth bracket under each pool rather than a water
  // overlay; either way five pools are drawn on the closing frame.
  const last = trace.frames[trace.frames.length - 1]!;
  const closing = last.state as Extract<typeof last.state, { kind: "array" }>;
  const pools = closing.overlays?.length ?? closing.brackets?.filter((bracket) => /^\+\d+$/.test(bracket.label)).length ?? 0;
  assert(pools === 5, `trapping_rain_water: the closing frame draws ${pools} pools, not 5`);
}

// --- Best time to buy and sell: [7,1,5,3,6,4] makes 5. ---
{
  // Day 0: price 7, cheapest so far 7, best 0. Day 1: 1 is cheaper, so the buy
  // day moves to 1; best still 0. Day 2: 5 - 1 = 4, a new best. Day 3:
  // 3 - 1 = 2, best stays 4. Day 4: 6 - 1 = 5, a new best. Day 5: 4 - 1 = 3,
  // best stays 5. Buy at 1 on day 1, sell at 6 on day 4, profit 5. Six day
  // frames plus the answer is 7.
  const trace = runDefault("single_pass_min_tracking");
  assert(trace.result === 5, `single_pass_min_tracking: expected profit 5, got ${String(trace.result)}`);
  assert(trace.frames.length === 7, `single_pass_min_tracking: six days plus an answer, got ${trace.frames.length}`);

  // The magnitude is the lesson: the profit is the height between the buy bar
  // and the sell bar, so a frame without bars has no figure left.
  for (const frame of trace.frames) {
    const state = frame.state as Extract<typeof frame.state, { kind: "array" }>;
    assert(
      JSON.stringify(state.bars) === JSON.stringify([7, 1, 5, 3, 6, 4]),
      `single_pass_min_tracking/${frame.id}: bars are ${JSON.stringify(state.bars)}`,
    );
  }

  // The cheapest day is found on day 1 and never moves again, which is the
  // whole reason one pass is enough.
  const buys = trace.frames
    .slice(2, 6)
    .map((frame) => (frame.state as Extract<typeof frame.state, { kind: "array" }>).pointers?.find((p) => p.name === "buy")?.index);
  assert(
    JSON.stringify(buys) === JSON.stringify([1, 1, 1, 1]),
    `single_pass_min_tracking: the buy marker should stay on day 1, got ${JSON.stringify(buys)}`,
  );

  // 5 - 1 = 4 on day 2, then 6 - 1 = 5 on day 4. Day 3 and day 5 make less
  // and must not be recorded as a new best.
  assert(
    trace.frames[2]!.caption === "Day 2 sells at 5: 5 minus 1 is 4",
    `single_pass_min_tracking: day 2's caption is "${trace.frames[2]!.caption}"`,
  );
  assert(
    trace.frames[4]!.caption === "Day 4 sells at 6: 6 minus 1 is 5",
    `single_pass_min_tracking: day 4's caption is "${trace.frames[4]!.caption}"`,
  );

  // The profit is drawn as the rectangle between the two days.
  const answerFrame = trace.frames[6]!;
  const answer = answerFrame.state as Extract<typeof answerFrame.state, { kind: "array" }>;
  assert(
    JSON.stringify(answer.overlays) === JSON.stringify([{ from: 1, to: 4, bottom: 1, top: 6, label: "+5" }]),
    `single_pass_min_tracking: the closing profit rectangle is ${JSON.stringify(answer.overlays)}`,
  );
}

// --- Invert: 4(2(1,3),7(6,9)) mirrored. ---
{
  // invert(4) swaps 2 and 7, so 7 and its subtree become the left branch.
  // invert(7) then swaps 6 and 9, and invert(2) swaps 1 and 3. The four
  // leaves have no children and swap nothing, so exactly three nodes swap.
  const trace = runDefault("tree_invert_recursion");
  assert(
    JSON.stringify(trace.result) === JSON.stringify([4, 7, 2, 9, 6, 3, 1]),
    `tree_invert_recursion: expected [4,7,2,9,6,3,1], got ${JSON.stringify(trace.result)}`,
  );
  const swaps = trace.frames.filter((frame) => frame.id.startsWith("swap"));
  assert(
    swaps.length === 3,
    `tree_invert_recursion: only the three nodes with children swap, got ${swaps.length} frames`,
  );

  // The point of the figure: the slot ids do not move, the VALUES cross over
  // them. After the root's swap, slot t1 holds 7 and slot t2 holds 2. A
  // simulator that gave the id to the value instead would relayout every
  // frame and the tree would slide across the board.
  const first = swaps[0]!;
  assert(first.state.kind === "tree", "tree_invert_recursion: frames must be trees");
  const state = first.state as Extract<typeof first.state, { kind: "tree" }>;
  const labelAt = (id: string) => state.nodes.find((node) => node.id === id)?.label;
  assert(
    labelAt("t1") === "7" && labelAt("t2") === "2",
    `tree_invert_recursion: after the root swap t1/t2 should read 7/2, got ${labelAt("t1")}/${labelAt("t2")}`,
  );

  // Every frame shares one layout skeleton, which is the union of every
  // arrangement the walk passes through.
  const skeletons = new Set(
    trace.frames.map((frame) =>
      frame.state.kind === "tree"
        ? (frame.state.layoutNodes ?? frame.state.nodes).map((node) => node.id).sort().join(",")
        : "",
    ),
  );
  assert(skeletons.size === 1, `tree_invert_recursion: the layout changes between frames (${skeletons.size} versions)`);
}

// --- Validate BST: 5(1,4(3,6)) fails, and it fails on an ancestor. ---
{
  // check(5,-inf,inf) passes and splits the window. check(1,-inf,5) passes.
  // check(4,5,inf) fails: 4 is a fine child of nothing above it locally, but
  // it sits in 5's right subtree, so it has to beat 5. This is the exact case
  // the naive "node.left.val < node.val < node.right.val" check gets wrong,
  // and 3 and 6 below it are never examined.
  const trace = runDefault("bst_validate_bounds");
  assert(trace.result === false, `bst_validate_bounds: [5,1,4,null,null,3,6] is not a BST, got ${String(trace.result)}`);
  assert(trace.earlyExit === true, "bst_validate_bounds: a failure stops the walk, which the lesson owes the student");

  // The failing node carries the bound it inherited from its GRANDparent
  // side, not from its own parent. Without this the board could show a
  // failure with no reason attached to it.
  const failing = trace.frames.find((frame) => frame.caption.includes("4 must sit inside"));
  assert(failing, `bst_validate_bounds: no frame states the window 4 failed, captions ${JSON.stringify(trace.frames.map((f) => f.caption))}`);
  const annotations =
    failing!.state.kind === "tree" ? (failing!.state.annotations ?? []) : [];
  assert(
    annotations.some((annotation) => annotation.text === "(5,∞)"),
    `bst_validate_bounds: 4 must be annotated with the window (5,∞), got ${JSON.stringify(annotations.map((a) => a.text))}`,
  );

  // Three checks and a verdict: 3 and 6 are below the failure and never run.
  const checks = trace.frames.filter((frame) => frame.id.startsWith("check"));
  assert(
    checks.length === 3,
    `bst_validate_bounds: the walk visits 5, 1 and 4 and then stops, got ${checks.length} checks`,
  );
  assert(
    !checks.some((frame) => frame.caption.startsWith("3 ") || frame.caption.startsWith("6 ")),
    "bst_validate_bounds: nothing under the failing node may be checked",
  );
}

// --- LCA: 6(2(0,4),8(7,9)) with p = 0 and q = 4. ---
{
  // At 6 both 0 and 4 are smaller, so the answer is on the left and the whole
  // right subtree (8, 7, 9) is gone in one comparison. At 2 they straddle:
  // 0 is left of 2 and 4 is right, so 2 is the last node their paths share.
  const trace = runDefault("bst_lca");
  assert(trace.result === 2, `bst_lca: 0 and 4 meet at 2, got ${String(trace.result)}`);
  assert(trace.earlyExit === true, "bst_lca: the walk touches 2 of 7 nodes, which is the whole selling point");

  // One comparison, three nodes struck out. If the pruning is not drawn the
  // frame is a spotlight moving down a tree and teaches nothing.
  const descend = trace.frames.find((frame) => frame.id.startsWith("descend"));
  assert(descend, "bst_lca: the walk must contain a descent frame");
  const excluded =
    descend!.state.kind === "tree"
      ? descend!.state.nodes.filter((node) => node.mark === "excluded").map((node) => node.label).sort()
      : [];
  assert(
    JSON.stringify(excluded) === JSON.stringify(["7", "8", "9"]),
    `bst_lca: going left from 6 rules out 8, 7 and 9, got ${JSON.stringify(excluded)}`,
  );
  const last = trace.frames[trace.frames.length - 1]!;
  assert(
    last.caption.includes("the LCA is 2"),
    `bst_lca: the walk ends on "${last.caption}"`,
  );
}

// --- Maximum path sum: -10(9,20(15,7)) is 42, and the root returns 25. ---
{
  // Postorder. gain(9) = 9. gain(15) = 15. gain(7) = 7.
  // gain(20) = 20 + max(15,7) = 35, but the path THROUGH 20 is 15+20+7 = 42.
  // gain(-10) = max(0, -10 + max(9,35)) = 25, and through it is
  // -10+9+35 = 34, which does not beat 42.
  // So the answer is recorded at 20 and the root's return value is not it.
  const trace = runDefault("tree_max_path_sum");
  assert(trace.result === 42, `tree_max_path_sum: expected 42, got ${String(trace.result)}`);

  // The two numbers at the root must be visibly different, because believing
  // the answer is whatever the root returns is the standard wrong solution.
  const rootFrame = trace.frames.find((frame) => frame.caption.startsWith("through -10"));
  assert(rootFrame, `tree_max_path_sum: no frame scores the root, captions ${JSON.stringify(trace.frames.map((f) => f.caption))}`);
  const rootAnnotations =
    rootFrame!.state.kind === "tree" ? (rootFrame!.state.annotations ?? []) : [];
  assert(
    rootAnnotations.some((annotation) => annotation.text === "↑25"),
    `tree_max_path_sum: the root returns 25 upward, got ${JSON.stringify(rootAnnotations.map((a) => a.text))}`,
  );
  assert(
    rootFrame!.caption.includes("34") && rootFrame!.caption.includes("42"),
    `tree_max_path_sum: the root frame must show 34 losing to 42, got "${rootFrame!.caption}"`,
  );

  // The winning path is drawn, so the closing number can be counted rather
  // than believed: 15, 20 and 7 are highlighted, -10 and 9 are not.
  const answer = trace.frames[trace.frames.length - 1]!;
  const highlighted =
    answer.state.kind === "tree"
      ? answer.state.nodes.filter((node) => node.mark === "active").map((node) => node.label).sort()
      : [];
  assert(
    JSON.stringify(highlighted) === JSON.stringify(["15", "20", "7"]),
    `tree_max_path_sum: the closing frame must highlight 15, 20 and 7, got ${JSON.stringify(highlighted)}`,
  );
}

// --- Serialize: 1(2,3(4,5)) is eleven tokens, six of them markers. ---
{
  // Preorder writes 1, then descends left to 2, whose two empty children each
  // write a marker, then 3, then 4 with two markers, then 5 with two markers.
  // Five nodes always produce 2n+1 = 11 tokens and n+1 = 6 markers, and that
  // count is exactly what makes the string readable back into one tree.
  const trace = runDefault("tree_serialize_preorder");
  const tokens = trace.result as string[];
  assert(
    JSON.stringify(tokens) === JSON.stringify(["1", "2", "#", "#", "3", "4", "#", "#", "5", "#", "#"]),
    `tree_serialize_preorder: wrong string ${JSON.stringify(tokens)}`,
  );
  assert(
    tokens.filter((token) => token === "#").length === 6,
    "tree_serialize_preorder: five nodes have six empty children, and every one is written",
  );

  // A frame that writes a marker names the node whose child is missing, or
  // the marker is a token from nowhere. The closing frame is excluded: it
  // reads the finished string back, so its caption carries every marker while
  // it belongs to no single parent and annotates none.
  const markerFrames = trace.frames.slice(0, -1).filter((frame) => frame.caption.includes("#"));
  assert(
    markerFrames.length >= 3,
    `tree_serialize_preorder: the empty children need their own frames, got ${markerFrames.length}`,
  );
  for (const frame of markerFrames) {
    const annotations = frame.state.kind === "tree" ? (frame.state.annotations ?? []) : [];
    assert(
      annotations.some((annotation) => annotation.text === "#"),
      `tree_serialize_preorder/${frame.id}: a marker frame must mark the parent it belongs to`,
    );
  }

  // Eleven boxes in one row squeeze the tree until a value stops fitting its
  // circle, so the row wraps. The two rows keep their widths for the whole
  // walk, or the cell addresses shift under the render check.
  const widths = new Map<string, number>();
  for (const frame of trace.frames) {
    for (const item of (frame.state as { asides?: TraceAside[] }).asides ?? []) {
      const seen = widths.get(item.id);
      if (seen === undefined) widths.set(item.id, item.capacity);
      else assert(seen === item.capacity, `tree_serialize_preorder: aside ${item.id} changed width`);
    }
  }
  assert(
    JSON.stringify([...widths.values()]) === JSON.stringify([6, 5]),
    `tree_serialize_preorder: the eleven tokens must wrap onto rows of 6 and 5, got ${JSON.stringify([...widths.values()])}`,
  );
}

// --- BST insert: 8,3,10,1,6,14 builds 8(3(1,6),10(_,14)). ---
{
  // 8 is the root. 3 < 8 goes left. 10 > 8 goes right. 1 < 8 then 1 < 3 goes
  // left of 3. 6 < 8 then 6 > 3 goes right of 3. 14 > 8 then 14 > 10 goes
  // right of 10. Reading that tree in order gives 1, 3, 6, 8, 10, 14.
  const trace = runDefault("bst_insert");
  assert(
    JSON.stringify(trace.result) === JSON.stringify(["1", "3", "6", "8", "10", "14"]),
    `bst_insert: wrong in-order reading ${JSON.stringify(trace.result)}`,
  );
  assert(
    trace.frames.length === 7,
    `bst_insert: six insertions and one closing read, got ${trace.frames.length} frames`,
  );

  // 6 is the interesting placement: it is smaller than the root and larger
  // than the root's left child, so it needs both comparisons. Drawing only
  // the final position would hide the second one.
  const sixth = trace.frames.find((frame) => frame.caption.startsWith("6<8"));
  assert(sixth, `bst_insert: no frame walks 6 down the tree, captions ${JSON.stringify(trace.frames.map((f) => f.caption))}`);
  const marks =
    sixth!.state.kind === "tree" ? (sixth!.state.annotations ?? []).map((a) => a.text) : [];
  assert(
    JSON.stringify(marks) === JSON.stringify(["6<8", "6>3"]),
    `bst_insert: inserting 6 compares against 8 then 3, got ${JSON.stringify(marks)}`,
  );

  // The in-order row is sorted after EVERY insertion, not only at the end.
  // That invariant is the reason the family is worth teaching, and a walk
  // that only fills the row at the close never shows it.
  for (const frame of trace.frames) {
    const row = ((frame.state as { asides?: TraceAside[] }).asides ?? [])[0];
    assert(row?.id === "sorted", `bst_insert/${frame.id}: every frame carries the in-order row`);
    const values = row!.cells.map((cell) => cell.text).filter((text) => text.length > 0).map(Number);
    const ordered = [...values].sort((a, b) => a - b);
    assert(
      JSON.stringify(values) === JSON.stringify(ordered),
      `bst_insert/${frame.id}: the in-order row is out of order: ${JSON.stringify(values)}`,
    );
  }
}

// --- Merge intervals: [[1,3],[2,6],[8,10],[15,18]] merges only the first pair. ---
{
  const trace = runDefault("merge_intervals");
  // Sorted by start the input is already 1,2,8,15. Open [1,3]; 2 <= 3 so the
  // run absorbs [2,6] and its end becomes max(3,6) = 6. 8 > 6 and 15 > 10, so
  // the other two intervals never touch anything.
  assert(
    JSON.stringify(trace.result) === JSON.stringify([[1, 6], [8, 10], [15, 18]]),
    `merge_intervals: expected [[1,6],[8,10],[15,18]], got ${JSON.stringify(trace.result)}`,
  );

  // The merge itself has to be ink. On the frame that absorbs [2,6] the output
  // lane must carry one live bar running 1 to 6; a run that only grew in the
  // caption is the defect this whole layer exists to stop.
  const grow = trace.frames.find((frame) => frame.id === "grow1")!;
  assert(grow?.state.kind === "numberline", "merge_intervals: grow1 is not a number line");
  const live = grow.state.bars.filter((bar) => bar.lane === 0 && bar.mark === "active");
  assert(
    live.length === 1 && live[0]!.from === 1 && live[0]!.to === 6,
    `merge_intervals: the merged run must be one active bar from 1 to 6, got ${JSON.stringify(live)}`,
  );

  // Lane 0 is the answer. An input drawn on it would say the algorithm had
  // returned an interval it never merged.
  for (const frame of trace.frames) {
    if (frame.state.kind !== "numberline") continue;
    for (const bar of frame.state.bars) {
      assert(
        bar.id.startsWith("out") ? bar.lane === 0 : bar.lane > 0,
        `merge_intervals/${frame.id}: bar ${bar.id} sits on lane ${bar.lane}`,
      );
    }
  }

  // The decision is a comparison and the caption must state it: 8 is past 6,
  // so the run closes rather than growing.
  const test2 = trace.frames.find((frame) => frame.id === "test2")!;
  assert(
    test2.caption === "8 is past 6, so the run closes",
    `merge_intervals: the closing comparison reads "${test2.caption}"`,
  );

  // The walk ends on the whole answer: three settled runs and nothing live.
  const last = trace.frames[trace.frames.length - 1]!;
  assert(last.state.kind === "numberline", "merge_intervals: the last frame is not a number line");
  const out = last.state.bars.filter((bar) => bar.lane === 0);
  assert(
    JSON.stringify(out.map((bar) => [bar.from, bar.to, bar.mark])) ===
      JSON.stringify([[1, 6, "done"], [8, 10, "done"], [15, 18, "done"]]),
    `merge_intervals: the output lane ends as ${JSON.stringify(out.map((bar) => [bar.from, bar.to, bar.mark]))}`,
  );
}

// --- Quick sort: one Lomuto pass over [5,3,8,4,2] with 5 as the pivot. ---
{
  const trace = runDefault("quick_sort");
  // boundary starts at 0. j=1: 3 < 5 and the boundary is already next to it, so
  // it only widens. j=2: 8 is not smaller. j=3: 4 < 5, swap cells 2 and 3 giving
  // [5,3,4,8,2], boundary 2. j=4: 2 < 5, swap cells 3 and 4 giving [5,3,4,2,8],
  // boundary 3. Finally the pivot trades with cell 3, giving [2,3,4,5,8] with 5
  // at index 3.
  assert(
    JSON.stringify(trace.result) === JSON.stringify([2, 3, 4, 5, 8]),
    `quick_sort: wrong sorted result ${JSON.stringify(trace.result)}`,
  );

  const swapFrames = trace.frames.filter((frame) => frame.state.kind === "array" && frame.state.swap);
  assert(
    JSON.stringify(swapFrames.map((frame) => frame.id)) === JSON.stringify(["swp3", "swp4", "place"]),
    `quick_sort: exchanges happen at ${swapFrames.map((frame) => frame.id).join(",")}, expected swp3,swp4,place`,
  );

  // The placement is the point of the pass: the pivot lands on the boundary, at
  // index 3, and everything left of it is at most 5.
  const place = trace.frames.find((frame) => frame.id === "place")!;
  const placeState = place.state as Extract<typeof place.state, { kind: "array" }>;
  assert(
    JSON.stringify(placeState.swap) === JSON.stringify({ from: 0, to: 3 }),
    `quick_sort: the pivot must trade cell 0 with cell 3, got ${JSON.stringify(placeState.swap)}`,
  );
  assert(
    JSON.stringify(arrayOf(place)) === JSON.stringify(["2", "3", "4", "5", "8"]),
    `quick_sort: after placement the row reads ${arrayOf(place).join(",")}`,
  );
  assert(placeState.cells[3]!.mark === "done", "quick_sort: the placed pivot is final and must be marked done");

  // The boundary is the algorithm, so every frame carries it as a bracket. On
  // the last scan frame it covers 0 to 3, which is exactly the run of values at
  // most 5 once 2 has crossed.
  for (const frame of trace.frames) {
    const state = frame.state as Extract<typeof frame.state, { kind: "array" }>;
    assert(
      (state.brackets?.length ?? 0) >= 1,
      `quick_sort/${frame.id}: the partition boundary must be drawn as a bracket`,
    );
  }
  const swp4 = trace.frames.find((frame) => frame.id === "swp4")!;
  const scanEnd = swp4.state as Extract<typeof swp4.state, { kind: "array" }>;
  assert(
    JSON.stringify(scanEnd.brackets?.[0]) === JSON.stringify({ from: 0, to: 3, label: "5 or less" }),
    `quick_sort: the scan must end with 0 to 3 bracketed as "5 or less", got ${JSON.stringify(scanEnd.brackets?.[0])}`,
  );

  // A value that is not smaller than the pivot moves nothing at all.
  const keep = trace.frames.find((frame) => frame.id === "keep2")!;
  assert(
    JSON.stringify(arrayOf(keep)) === JSON.stringify(["5", "3", "8", "4", "2"]),
    `quick_sort: comparing 8 with the pivot must move nothing, row reads ${arrayOf(keep).join(",")}`,
  );
}

// --- Insertion sort: [5,3,8,4,2], one key at a time into a growing prefix. ---
{
  const trace = runDefault("insertion_sort");
  // 3 walks one place past 5 giving [3,5,8,4,2]. 8 is already past 5 and stays.
  // 4 walks two places, past 8 and past 5, giving [3,4,5,8,2]. 2 walks four
  // places, past everything, giving [2,3,4,5,8].
  assert(
    JSON.stringify(trace.result) === JSON.stringify([2, 3, 4, 5, 8]),
    `insertion_sort: wrong sorted result ${JSON.stringify(trace.result)}`,
  );

  // Only the first key moves a single place, and only a single place is an
  // exchange of two cells. The 4 and the 2 travel two and four places, which are
  // rotations; claiming a swap for those would draw a move that never happened.
  const swapFrames = trace.frames.filter((frame) => frame.state.kind === "array" && frame.state.swap);
  assert(
    swapFrames.length === 1 && swapFrames[0]!.id === "put1",
    `insertion_sort: exactly one frame is a true swap, got ${swapFrames.map((frame) => frame.id).join(",") || "none"}`,
  );
  assert(
    JSON.stringify((swapFrames[0]!.state as Extract<TraceFrame["state"], { kind: "array" }>).swap) ===
      JSON.stringify({ from: 0, to: 1 }),
    "insertion_sort: the first key trades cells 0 and 1",
  );

  // The sorted prefix is one bracket per frame and it never shrinks: it runs
  // 0..0, 0..0, 0..1, 0..1, 0..2, 0..2, 0..3, 0..3, 0..4, 0..4 as each key is
  // lifted and then placed.
  const ends = trace.frames.map((frame) => {
    const state = frame.state as Extract<typeof frame.state, { kind: "array" }>;
    assert(
      state.brackets?.length === 1 && state.brackets[0]!.from === 0,
      `insertion_sort/${frame.id}: needs exactly one bracket starting at index 0`,
    );
    return state.brackets![0]!.to;
  });
  assert(
    JSON.stringify(ends) === JSON.stringify([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]),
    `insertion_sort: the sorted prefix runs ${ends.join(",")}, expected 0,0,1,1,2,2,3,3,4,4`,
  );

  // The prefix is sorted, not settled: a later key is inserted into the middle
  // of it and pushes those cells right. A tick would promise they are final,
  // which is bubble sort's guarantee and not this one.
  for (const frame of trace.frames.slice(0, -1)) {
    const state = frame.state as Extract<typeof frame.state, { kind: "array" }>;
    assert(
      state.cells.every((cell) => cell.mark !== "done"),
      `insertion_sort/${frame.id}: a cell is ticked as settled before the sort has finished`,
    );
  }

  // A key already in place moves nothing.
  const put2 = trace.frames.find((frame) => frame.id === "put2")!;
  assert(
    JSON.stringify(arrayOf(put2)) === JSON.stringify(["3", "5", "8", "4", "2"]),
    `insertion_sort: 8 is already past 5 and must not move, row reads ${arrayOf(put2).join(",")}`,
  );
}

// --- Single number: [4,1,2,1,2] folds to 4. ---
{
  const trace = runDefault("xor_fold");
  // 0^4 = 4 (0000^0100), 4^1 = 5 (0100^0001), 5^2 = 7 (0101^0010),
  // 7^1 = 6 (0111^0001), 6^2 = 4 (0110^0010). Both 1s and both 2s cancel.
  assert(trace.result === 4, `xor_fold: expected 4, got ${String(trace.result)}`);

  const runningRow = (frame: TraceFrame): string[] => {
    const asides = (frame.state as { asides?: Array<{ id: string; cells: Array<{ text: string }> }> }).asides ?? [];
    const row = asides.find((item) => item.id === "x");
    assert(row, `xor_fold/${frame.id}: the running value aside is missing`);
    return row!.cells.map((cell) => cell.text);
  };
  assert(
    JSON.stringify(runningRow(trace.frames[trace.frames.length - 1]!)) === JSON.stringify(["4", "5", "7", "6", "4"]),
    `xor_fold: the running value must read 4,5,7,6,4, got ${runningRow(trace.frames[trace.frames.length - 1]!).join(",")}`,
  );

  // The cancellation is the lesson, so both copies are struck out on the frame
  // that closes the pair. The second 1 sits at index 3 and the first at index 1,
  // and index 3 is the cell the walk is on, so it is active rather than struck.
  const cancel = trace.frames.find((frame) => frame.id === "fold3")!;
  const cancelState = cancel.state as Extract<typeof cancel.state, { kind: "array" }>;
  const struck = cancelState.cells.flatMap((cell, at) => (cell.mark === "excluded" ? [at] : []));
  assert(
    JSON.stringify(struck) === JSON.stringify([1]) && cancelState.cells[3]!.mark === "active",
    `xor_fold: folding the second 1 must strike the first (index 1) while index 3 is live, got struck ${struck.join(",")}`,
  );
  // 0111 XOR 0001 is 0110, so the note carries the arithmetic and the bits.
  assert(
    (cancel.state as { note?: string }).note === "7 xor 1 = 6  0110",
    `xor_fold: the note must show 7 xor 1 = 6 and 0110, got "${(cancel.state as { note?: string }).note}"`,
  );

  // Everything paired is struck out at the end and only the survivor is ticked.
  const last = trace.frames[trace.frames.length - 1]!.state as Extract<TraceFrame["state"], { kind: "array" }>;
  assert(
    JSON.stringify(last.cells.map((cell) => cell.mark)) ===
      JSON.stringify(["done", "excluded", "excluded", "excluded", "excluded"]),
    `xor_fold: only the single value survives, got ${JSON.stringify(last.cells.map((cell) => cell.mark))}`,
  );

  // An aside is addressed by cell across frames, so its width may not change.
  const widths = new Set(trace.frames.map((frame) => runningRow(frame).length));
  assert(
    widths.size === 1 && [...widths][0] === 5,
    `xor_fold: the running row must stay 5 wide, got ${[...widths].join(",")}`,
  );
}

// --- Number of 1 bits: n = 11 is 1011, three clears. ---
{
  const trace = runDefault("bit_count");
  // 11 & 10 is 1011 & 1010 = 1010, which is 10. 10 & 9 is 1010 & 1001 = 1000,
  // which is 8. 8 & 7 is 1000 & 0111 = 0000. Three turns of the loop.
  assert(trace.result === 3, `bit_count: expected 3, got ${String(trace.result)}`);
  assert(
    JSON.stringify(arrayOf(trace.frames[0]!)) === JSON.stringify(["1", "0", "1", "1"]),
    `bit_count: 11 is 1011 most significant first, got ${arrayOf(trace.frames[0]!).join(",")}`,
  );

  // Once per set bit, not once per bit. A walk that stepped through all four
  // columns would still end on 3 and would teach the wrong cost.
  const clears = trace.frames.filter((frame) => frame.id.startsWith("clear"));
  assert(
    clears.length === 3,
    `bit_count: 1011 has three 1s so the loop turns three times, got ${clears.length} frames`,
  );

  // The borrow is what makes the AND work, so it has to be on the board: after
  // the first clear n is 1010 and the row beneath it is 9, which is 1001.
  const first = trace.frames.find((frame) => frame.id === "clear1")!;
  assert(
    JSON.stringify(arrayOf(first)) === JSON.stringify(["1", "0", "1", "0"]),
    `bit_count: after one clear n is 10, which is 1010, got ${arrayOf(first).join(",")}`,
  );
  const aside = ((first.state as { asides?: Array<{ id: string; cells: Array<{ text: string }> }> }).asides ?? [])
    .find((item) => item.id === "prev");
  assert(aside, "bit_count: the n minus 1 row is missing");
  assert(
    JSON.stringify(aside!.cells.map((cell) => cell.text)) === JSON.stringify(["1", "0", "0", "1"]),
    `bit_count: 10 minus 1 is 9, which is 1001, got ${aside!.cells.map((cell) => cell.text).join(",")}`,
  );

  // The walk ends on an empty row, and exactly the three columns that held a 1
  // are struck out. Column 1 was a 0 in 1011 and was never cleared, so striking
  // it would claim the loop had touched a bit it never looked at.
  const lastState = trace.frames[trace.frames.length - 1]!.state as Extract<TraceFrame["state"], { kind: "array" }>;
  assert(lastState.cells.every((cell) => cell.text === "0"), "bit_count: the walk must end on 0000");
  const clearedColumns = lastState.cells.flatMap((cell, at) => (cell.mark === "excluded" ? [at] : []));
  assert(
    JSON.stringify(clearedColumns) === JSON.stringify([0, 2, 3]),
    `bit_count: 1011 clears columns 0, 2 and 3 and never touches column 1, got ${clearedColumns.join(",")}`,
  );
}

// --- Trie: insert cat, car, dog then search car. ---
{
  const trace = runDefault("trie_insert_search");
  // cat hangs 3 nodes off the root, car reuses c and a and adds only r, dog
  // hangs 3 more. Root plus 3 plus 1 plus 3 is 8 nodes and 7 edges.
  assert(
    (trace.result as { found: boolean }).found === true,
    "trie_insert_search: car was inserted, so the search must find it",
  );

  const last = trace.frames[trace.frames.length - 1]!;
  assert(last.state.kind === "tree", "trie_insert_search: frames must be trees");
  const lastState = last.state as Extract<typeof last.state, { kind: "tree" }>;
  assert(
    lastState.nodes.length === 8 && lastState.edges.length === 7,
    `trie_insert_search: the finished trie is 8 nodes and 7 edges, got ${lastState.nodes.length} and ${lastState.edges.length}`,
  );

  // Every frame is laid out on the finished trie, including the one that draws
  // only the root. Without that the nodes of the first word slide sideways when
  // the second is inserted and the shared prefix reads as a drawing accident.
  const layout = trace.frames.map((frame) =>
    ((frame.state as Extract<TraceFrame["state"], { kind: "tree" }>).layoutNodes ?? []).map((node) => node.id).join(","),
  );
  assert(
    new Set(layout).size === 1 && layout[0]!.split(",").length === 8,
    `trie_insert_search: layoutNodes must be the whole trie in every frame, got ${new Set(layout).size} variants`,
  );

  // The prefix claim: inserting car adds exactly one node to the four cat left.
  const drawn = (id: string) =>
    (trace.frames.find((frame) => frame.id === id)!.state as Extract<TraceFrame["state"], { kind: "tree" }>).nodes.length;
  assert(
    drawn("insert0") === 4 && drawn("insert1") === 5,
    `trie_insert_search: cat draws 4 nodes and car adds one more, got ${drawn("insert0")} then ${drawn("insert1")}`,
  );

  // A word end is a fact about the trie, not about the step, so it is drawn on
  // every frame: three words, three end markers on the finished tree.
  assert(
    (lastState.annotations ?? []).length === 3 &&
      (lastState.annotations ?? []).every((annotation) => annotation.text === "$"),
    `trie_insert_search: three word ends must be marked, got ${JSON.stringify(lastState.annotations)}`,
  );
  const ends = lastState.nodes.filter((node) => node.mark === "done" || node.mark === "active");
  assert(ends.length === 3, `trie_insert_search: three terminal nodes, got ${ends.length}`);
}

// --- Spiral matrix: [[1,2,3],[4,5,6],[7,8,9]] reads 1 2 3 6 9 8 7 4 5. ---
{
  const trace = runDefault("spiral_layers");
  // Top row 1 2 3 and top becomes 1; right column 6 9 and right becomes 1;
  // bottom row 8 7 and bottom becomes 1; left column 4 and left becomes 1; the
  // boundaries now meet on the single cell 5.
  assert(
    JSON.stringify(trace.result) === JSON.stringify(["1", "2", "3", "6", "9", "8", "7", "4", "5"]),
    `spiral_layers: wrong order ${JSON.stringify(trace.result)}`,
  );

  const last = trace.frames[trace.frames.length - 1]!;
  assert(last.state.kind === "matrix", "spiral_layers: frames must be matrices");
  const path = last.state.path ?? [];
  assert(path.length === 9, `spiral_layers: the path must visit all 9 cells, got ${path.length}`);
  // A spiral is a walk, so consecutive steps are neighbours. A path that jumped
  // would draw an arrow across the middle of the figure.
  for (let step = 0; step + 1 < path.length; step += 1) {
    const [r1, c1] = path[step]!;
    const [r2, c2] = path[step + 1]!;
    assert(
      Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1,
      `spiral_layers: step ${step} jumps from ${r1},${c1} to ${r2},${c2}`,
    );
  }

  // The first side reads the whole top row and moves that one boundary.
  const top = trace.frames.find((frame) => frame.id === "top1")!;
  assert(
    JSON.stringify((top.state as Extract<TraceFrame["state"], { kind: "matrix" }>).path) ===
      JSON.stringify([[0, 0], [0, 1], [0, 2]]),
    "spiral_layers: the first side is the whole top row",
  );
  assert(
    (top.state as { note?: string }).note === "top = 1",
    `spiral_layers: reading the top row moves top to 1, note says "${(top.state as { note?: string }).note}"`,
  );

  // The shrinking boundary is what the marks say: by the time the left column is
  // read, the whole outer ring is outside the live rectangle and the centre has
  // not been reached.
  const left = trace.frames.find((frame) => frame.id === "left4")!
    .state as Extract<TraceFrame["state"], { kind: "matrix" }>;
  assert(
    left.cells[0]!.every((cell) => cell.mark === "done"),
    "spiral_layers: the top row is peeled off by the time the left column is read",
  );
  assert(
    left.cells[1]![1]!.mark === undefined,
    "spiral_layers: the centre cell is still live while the outer ring is being read",
  );
}

// --- Merge two sorted lists: [1,2,4] and [1,3,4] splice into 1 1 2 3 4 4. ---
{
  // The row is a0 a1 a2 b0 b1 b2 at indices 0..5, holding 1 2 4 and 1 3 4, and
  // ties take list2. 1 vs 1 takes b0 and writes nothing, the tail being the
  // dummy. 1 vs 3 takes a0 and writes b0->a0. 2 vs 3 takes a1 and a0->a1 is
  // already there. 4 vs 3 takes b1 and writes a1->b1. 4 vs 4 ties, so b2 goes
  // and b1->b2 is already there. list2 empties, so b2->a2 hangs on the rest.
  // Final arrows a0->a1, a1->b1, b0->a0, b1->b2, b2->a2, head b0 at index 3.
  const trace = runDefault("merge_two_lists");
  assert(
    JSON.stringify(trace.result) === JSON.stringify([1, 1, 2, 3, 4, 4]),
    `merge_two_lists: wrong merge ${JSON.stringify(trace.result)}`,
  );
  assert(
    JSON.stringify(trace.frames.map((frame) => frame.id)) ===
      JSON.stringify(["input", "take1", "take2", "take3", "take4", "take5", "rest", "merged"]),
    `merge_two_lists: the walk is ${trace.frames.map((frame) => frame.id).join(",")}`,
  );

  // The whole claim of a splice: the finished list is the same six nodes with
  // new arrows, and reading it from the head gives the merged order.
  const last = trace.frames[trace.frames.length - 1]!;
  const state = listOf(last);
  const head = state.pointers?.find((pointer) => pointer.name === "head");
  assert(head?.index === 3, `merge_two_lists: the merged head is list2's first node, got ${JSON.stringify(head)}`);
  assert(
    JSON.stringify(walkList(last, state.nodes[head!.index]!.id)) === JSON.stringify(["1", "1", "2", "3", "4", "4"]),
    `merge_two_lists: following the arrows reads ${walkList(last, state.nodes[head!.index]!.id).join(",")}`,
  );
  assert(
    JSON.stringify(state.links.map((link) => `${link.from}->${link.to}`).sort()) ===
      JSON.stringify(["a0->a1", "a1->b1", "b0->a0", "b1->b2", "b2->a2"]),
    `merge_two_lists: final arrows are ${state.links.map((link) => `${link.from}->${link.to}`).join(",")}`,
  );

  // No node is created, moved, or dropped: the same six ids in the same order
  // in every frame, and an output row pre-sized to hold all of them.
  for (const frame of trace.frames) {
    const here = listOf(frame);
    assert(
      JSON.stringify(here.nodes.map((node) => node.id)) === JSON.stringify(["a0", "a1", "a2", "b0", "b1", "b2"]),
      `merge_two_lists/${frame.id}: the node row changed`,
    );
    assert(
      here.asides?.length === 1 && here.asides[0]!.id === "out" && here.asides[0]!.capacity === 6,
      `merge_two_lists/${frame.id}: the merged aside must be pre-sized to six`,
    );
  }

  // The output row gains exactly one value per take, so the answer is readable
  // even while the arrows weave between the two blocks.
  const filled = trace.frames.map((frame) => listOf(frame).asides![0]!.cells.filter((cell) => cell.text).length);
  assert(
    JSON.stringify(filled) === JSON.stringify([0, 1, 2, 3, 4, 5, 6, 6]),
    `merge_two_lists: the merged row fills ${filled.join(",")}`,
  );
}

// --- Remove the nth from the end: [1,2,3,4,5], n = 2 leaves 1 2 3 5. ---
{
  // Nodes n0..n4 hold 1 2 3 4 5. `fast` walks alone to index 2 (value 3),
  // opening a gap of two. Both then step until `fast` is on the last node:
  // slow 1 / fast 3, then slow 2 / fast 4. `slow` is on the 3, one before the
  // doomed 4, so n2->n4 and the 4 is off the list.
  const trace = runDefault("two_pass_or_gap_pointers");
  assert(
    JSON.stringify(trace.result) === JSON.stringify([1, 2, 3, 5]),
    `two_pass_or_gap_pointers: wrong list ${JSON.stringify(trace.result)}`,
  );

  const trail = trace.frames.map((frame) => {
    const state = listOf(frame);
    const slow = state.pointers?.find((pointer) => pointer.name === "slow")?.index ?? null;
    const fast = state.pointers?.find((pointer) => pointer.name === "fast")?.index ?? null;
    return `${slow}/${fast}`;
  });
  assert(
    JSON.stringify(trail) === JSON.stringify(["0/0", "0/1", "0/2", "1/3", "2/4", "2/4", "2/null"]),
    `two_pass_or_gap_pointers: the cursors walk ${trail.join(" ")}`,
  );
  // Once opened the gap is exactly n for the rest of the walk. That invariant
  // is the entire technique and nothing else checks it.
  for (const frame of trace.frames.slice(2, 5)) {
    const state = listOf(frame);
    const slow = state.pointers!.find((pointer) => pointer.name === "slow")!.index;
    const fast = state.pointers!.find((pointer) => pointer.name === "fast")!.index;
    assert(fast - slow === 2, `two_pass_or_gap_pointers/${frame.id}: the gap is ${fast - slow}, not 2`);
  }

  const unlink = trace.frames.find((frame) => frame.id === "unlink")!;
  const state = listOf(unlink);
  const excluded = state.nodes.filter((node) => node.mark === "excluded");
  assert(
    excluded.length === 1 && excluded[0]!.id === "n3" && excluded[0]!.label === "4",
    `two_pass_or_gap_pointers: the dropped node must be the 4 at index 3, got ${JSON.stringify(excluded)}`,
  );
  const arrows = state.links.map((link) => `${link.from}->${link.to}`);
  assert(
    arrows.includes("n2->n4") && !arrows.includes("n2->n3"),
    `two_pass_or_gap_pointers: slow must point past the doomed node, arrows are ${arrows.join(",")}`,
  );
  // The removed node keeps its own next, drawn dashed: the node object still
  // has it, the list simply cannot reach it any more.
  assert(
    state.links.find((link) => link.from === "n3")?.mark === "excluded",
    "two_pass_or_gap_pointers: the arrow out of the removed node must be marked excluded",
  );
  assert(
    JSON.stringify(walkList(unlink, "n0")) === JSON.stringify(["1", "2", "3", "5"]),
    `two_pass_or_gap_pointers: the surviving list reads ${walkList(unlink, "n0").join(",")}`,
  );
}

// --- Add two numbers: 342 + 465 = 807, written back to front. ---
{
  // l1 = [2,4,3] is 342 and l2 = [5,6,4] is 465. Column 1: 2 + 5 = 7, carry 0.
  // Column 2: 4 + 6 = 10, write 0, carry 1. Column 3: 3 + 4 + 1 = 8, carry 0.
  // Both lists are exhausted and the carry is 0, so the walk stops: 7 0 8.
  const trace = runDefault("digit_carry_list");
  assert(
    JSON.stringify(trace.result) === JSON.stringify([7, 0, 8]),
    `digit_carry_list: wrong sum ${JSON.stringify(trace.result)}`,
  );
  assert(trace.frames.length === 5, `digit_carry_list: expected 5 frames, got ${trace.frames.length}`);

  // The carry column is the one that has to be on the board: 4 + 6 makes ten,
  // so the sum row gains a 0 and the 1 is carried into the next column.
  const carryFrame = trace.frames[2]!;
  assert(
    carryFrame.caption.includes("4 + 6 = 10") && carryFrame.caption.includes("carry 1"),
    `digit_carry_list: the carry column reads "${carryFrame.caption}"`,
  );
  const sums = trace.frames.map((frame) => listOf(frame).asides![0]!.cells.map((cell) => cell.text).join("").trim());
  assert(
    JSON.stringify(sums) === JSON.stringify(["", "7", "70", "708", "708"]),
    `digit_carry_list: the sum row grows ${sums.join(" ")}`,
  );

  // This is the one walk of the four that builds a NEW list, so the input
  // arrows must be untouched from the first frame to the last. A frame that
  // rewired them would be drawing a splice, which is a different algorithm.
  const arrowsOf = (frame: TraceFrame) =>
    listOf(frame).links.map((link) => `${link.from}->${link.to}`).sort().join(",");
  for (const frame of trace.frames) {
    assert(arrowsOf(frame) === arrowsOf(trace.frames[0]!), `digit_carry_list/${frame.id}: the input lists were rewired`);
  }
  for (const frame of trace.frames) {
    assert(
      listOf(frame).asides![0]!.capacity === 4,
      `digit_carry_list/${frame.id}: the sum row stays four wide, one more than the longer input`,
    );
  }
}

// --- Reverse in k-groups: [1,2,3,4,5] with k = 2 becomes 2 1 4 3 5. ---
{
  // Nodes n0..n4 hold 1 2 3 4 5, k = 2. Block one is n0 n1: reversed it is
  // n1->n0, and n0->n2 because the block's old head now leads to whatever
  // follows. Block two is n2 n3: reversed it is n3->n2, n2->n4; at that moment
  // n0 still points at n2, so two arrows land on n2 and the new head n3 hangs
  // off nothing. The join swings n0->n3. One node is left, fewer than k, so it
  // stays. Final n0->n3, n1->n0, n2->n4, n3->n2; from n1 that reads 2 1 4 3 5.
  const trace = runDefault("reverse_k_group");
  assert(
    JSON.stringify(trace.result) === JSON.stringify([2, 1, 4, 3, 5]),
    `reverse_k_group: wrong result ${JSON.stringify(trace.result)}`,
  );
  assert(
    JSON.stringify(trace.frames.map((frame) => frame.id)) ===
      JSON.stringify(["input", "blk1", "flip1", "blk2", "flip2", "join2", "rest", "done"]),
    `reverse_k_group: the walk is ${trace.frames.map((frame) => frame.id).join(",")}`,
  );

  const last = trace.frames[trace.frames.length - 1]!;
  const state = listOf(last);
  const head = state.pointers?.find((pointer) => pointer.name === "head");
  assert(head?.index === 1, `reverse_k_group: the new head is the kth node, index 1, got ${JSON.stringify(head)}`);
  assert(
    JSON.stringify(walkList(last, "n1")) === JSON.stringify(["2", "1", "4", "3", "5"]),
    `reverse_k_group: following the arrows reads ${walkList(last, "n1").join(",")}`,
  );
  assert(
    JSON.stringify(state.links.map((link) => `${link.from}->${link.to}`).sort()) ===
      JSON.stringify(["n0->n3", "n1->n0", "n2->n4", "n3->n2"]),
    `reverse_k_group: final arrows are ${state.links.map((link) => `${link.from}->${link.to}`).join(",")}`,
  );

  // Each block frame outlines exactly k nodes. Counting k ahead before
  // touching anything is what stops a short final block being reversed.
  for (const id of ["blk1", "blk2"]) {
    const block = listOf(trace.frames.find((frame) => frame.id === id)!);
    const inBlock = block.nodes.filter((node) => node.mark === "window").length;
    assert(inBlock === 2, `reverse_k_group/${id}: ${inBlock} nodes outlined for k = 2`);
  }

  // The broken middle. After a block is reversed but before it is joined, the
  // previous block's tail and the block's own last node both point at the old
  // head; the join leaves exactly one. Hiding this is what makes k-group look
  // like magic rather than bookkeeping.
  const flip2 = listOf(trace.frames.find((frame) => frame.id === "flip2")!);
  const join2 = listOf(trace.frames.find((frame) => frame.id === "join2")!);
  assert(
    flip2.links.filter((link) => link.to === "n2").length === 2,
    "reverse_k_group/flip2: the reversed block must still hang off the old arrow",
  );
  assert(
    join2.links.filter((link) => link.to === "n2").length === 1,
    "reverse_k_group/join2: the join must leave one arrow into the block's tail",
  );

  // The reading row states the answer in digits, because the two joins between
  // blocks are drawn as arcs at one shared height.
  const reads = trace.frames.map((frame) =>
    listOf(frame).asides![0]!.cells.map((cell) => cell.text).filter((text) => text).join(""),
  );
  assert(
    JSON.stringify(reads) === JSON.stringify(["", "", "21", "21", "2143", "2143", "21435", "21435"]),
    `reverse_k_group: the reading row grows ${reads.join(" ")}`,
  );
}

// --- Min heap: insert 15 into [4,5,20,9,11,25], then pop the root. ---
{
  // Sift up. 15 goes to slot 6, whose parent is slot 2 holding 20. 15 < 20, so
  // they swap: [4,5,15,9,11,25,20]. Slot 2's parent is slot 0 holding 4, and
  // 15 > 4, so the climb stops. One rise.
  // Pop. The root 4 leaves, the last cell 20 moves into slot 0 and the array
  // shrinks to six: [20,5,15,9,11,25].
  // Sift down. Children of slot 0 are 5 and 15; the smaller is 5 and 20 > 5,
  // so 20 goes to slot 1. Children of slot 1 are 9 and 11; the smaller is 9
  // and 20 > 9, so 20 goes to slot 3, which has no children. Two sinks. It
  // settles at [5,9,15,20,11,25], where 5<=9, 5<=15, 9<=20, 9<=11 and 15<=25.
  const trace = runDefault("heap_sift");
  const result = trace.result as { min: number; heap: number[] };
  assert(result.min === 4, `heap_sift: the root of the heap is 4, got ${String(result.min)}`);
  assert(
    JSON.stringify(result.heap) === JSON.stringify([5, 9, 15, 20, 11, 25]),
    `heap_sift: expected [5,9,15,20,11,25] after the pop, got ${JSON.stringify(result.heap)}`,
  );
  // 15 rises once and 20 sinks twice. A walk with different counts is a
  // different heap, however plausible the final array looks.
  const rises = trace.frames.filter((frame) => frame.id.startsWith("rise")).length;
  const sinks = trace.frames.filter((frame) => frame.id.startsWith("sink")).length;
  assert(
    rises === 1 && sinks === 2,
    `heap_sift: 15 rises once and 20 sinks twice on this input, got ${rises} and ${sinks}`,
  );
  assertHeapFigure("heap_sift", trace, 7);
  // The empty tail slot is why the array width can stay fixed: free before
  // the insert, used after it, free again after the pop.
  const slotSix = trace.frames.map((frame) => heapRows(frame).array[6]!);
  assert(
    slotSix[0] === "" && slotSix[1] === "15" && slotSix[slotSix.length - 1] === "",
    `heap_sift: slot 6 should be free, then hold 15, then be free again, got ${JSON.stringify(slotSix)}`,
  );
  // Every frame must state its comparison beside the figure, or the
  // arrangement reorganises itself on the board for no visible reason.
  for (const frame of trace.frames) {
    assert(
      frame.state.kind === "stacked" && (frame.state.note ?? "").trim().length > 0,
      `heap_sift/${frame.id}: a sift frame with no note shows a swap with no stated reason`,
    );
  }
}

// --- Kth largest: [3,2,1,5,6,4] with k = 2 keeps 5 and 6, and answers 5. ---
{
  // Fill: 3 goes to slot 0. 2 goes to slot 1, and 2 < 3 so it rises to the
  // root, leaving [2,3] with root 2.
  // Offer 1: 1 <= 2, so it never enters. Turned away.
  // Offer 5: 5 > 2, so 2 is evicted. 5 takes slot 0 and sinks past 3, so the
  // heap is [3,5] and the root is 3.
  // Offer 6: 6 > 3, so 3 is evicted. 6 takes slot 0 and sinks past 5, so the
  // heap is [5,6] and the root is 5.
  // Offer 4: 4 <= 5, so it never enters. Turned away.
  // Root 5, and sorted descending the input is 6,5,4,3,2,1, so the 2nd largest
  // is 5.
  const trace = runDefault("heap_top_k");
  assert(trace.result === 5, `heap_top_k: the 2nd largest of [3,2,1,5,6,4] is 5, got ${String(trace.result)}`);
  // The two evictions in order. This is the whole content of the method: a
  // walk that evicts different values is keeping a different set.
  const evictions = trace.frames.filter((frame) => frame.id.startsWith("evict")).map((frame) => frame.caption);
  assert(
    evictions.length === 2 &&
      evictions[0]!.startsWith("5 beats 2") &&
      evictions[1]!.startsWith("6 beats 3"),
    `heap_top_k: 5 must evict 2 and 6 must evict 3, got ${JSON.stringify(evictions)}`,
  );
  const turned = trace.frames.filter((frame) => frame.id.startsWith("turn"));
  assert(
    turned.length === 2,
    `heap_top_k: 1 and 4 cannot beat the root and are turned away, got ${turned.length} such frames`,
  );
  // The eviction has to be ink. Replacing the root quietly between two frames
  // is exactly the walk-through hole this lane exists to close.
  for (const frame of trace.frames.filter((item) => item.id.startsWith("evict"))) {
    assert(heapRows(frame).array.length === 2, `heap_top_k/${frame.id}: the heap must stay at k = 2 cells`);
    assert(frame.state.kind === "stacked", `heap_top_k/${frame.id}: not stacked`);
    const top = frame.state.parts[0]!.state;
    assert(
      top.kind === "tree" && top.nodes[0]!.mark === "excluded",
      `heap_top_k/${frame.id}: the evicted root must carry the excluded mark`,
    );
  }
  assertHeapFigure("heap_top_k", trace, 2);
  // The input row is what makes "turned away" visible; without it values
  // arrive from nowhere and the rejected ones are never drawn at all.
  for (const frame of trace.frames) {
    assert(
      heapRows(frame).asideIds.includes("nums"),
      `heap_top_k/${frame.id}: every frame needs the input row beside the heap`,
    );
  }
}

// --- Top k frequent: [1,1,1,2,2,3] with k = 2 keeps 1 and 2. ---
{
  // Counts, in first-appearance order, which is the order a hash map hands
  // them back: 1:3, 2:2, 3:1.
  // Fill: 1:3 goes to slot 0. 2:2 goes to slot 1, and its count 2 is less than
  // the root's count 3, so it rises. Heap [2:2, 1:3], root 2:2.
  // Offer 3:1: count 1 is not more than the root count 2, so it is turned away
  // without entering the heap.
  // Left inside: 2:2 and 1:3, so ordered by count descending the answer is
  // [1, 2], matching the LeetCode expected output.
  const trace = runDefault("heap_frequency");
  assert(
    JSON.stringify(trace.result) === JSON.stringify([1, 2]),
    `heap_frequency: expected [1,2], got ${JSON.stringify(trace.result)}`,
  );
  // The heap must end holding the PAIRS, not the values: 2:2 at the root and
  // 1:3 below it.
  const cells = heapRows(trace.frames[trace.frames.length - 1]!).array;
  assert(
    JSON.stringify([...cells].sort()) === JSON.stringify(["1:3", "2:2"]),
    `heap_frequency: the heap must end holding 2:2 and 1:3, got ${JSON.stringify(cells)}`,
  );
  // 3 is rejected on its COUNT of 1 against the root count of 2. A board that
  // compared the value 3 against the value 2 would reach the same answer here
  // by luck and be the wrong lesson.
  assert(
    trace.frames.some((frame) => frame.id === "turn2" && frame.caption.includes("not more than 2")),
    "heap_frequency: 3 is rejected on its count, and the comparison must be the count not the value",
  );
  // Ordering by the count rather than by the value is the entire difference
  // from Kth Largest, so a heap cell that is a bare number is a wrong board.
  for (const frame of trace.frames) {
    for (const text of heapRows(frame).array) {
      assert(
        text === "" || /^-?\d+:\d+$/.test(text),
        `heap_frequency/${frame.id}: heap cell "${text}" must read value:count`,
      );
    }
  }
  assertHeapFigure("heap_frequency", trace, 2);
}

// --- Merge k sorted lists: [[1,4,5],[1,3,4],[2,6]] in 8 pops. ---
{
  // Heads go in as 1A, 1B, 2C, which is already a heap. Each pop below states
  // its refill and the heap it leaves:
  //   1A out, A sends 4  -> 1B, 4A, 2C (4 sank past 1B)
  //   1B out, B sends 3  -> 2C, 4A, 3B (3 sank past 2C)
  //   2C out, C sends 6  -> 3B, 4A, 6C (6 sank past 3B)
  //   3B out, B sends 4  -> 4B, 4A, 6C (4 is not less than 4, so it stays)
  //   4B out, B is empty -> 6C moves to the root and sinks past 4A: 4A, 6C
  //   4A out, A sends 5  -> 5A, 6C
  //   5A out, A is empty -> 6C
  //   6C out, C is empty -> every slot free
  // Eight pops plus one setup frame is nine frames, and the output row is
  // [1,1,2,3,4,4,5,6], which matches the LeetCode expected output.
  const trace = runDefault("heap_k_way_merge");
  assert(
    JSON.stringify(trace.result) === JSON.stringify([1, 1, 2, 3, 4, 4, 5, 6]),
    `heap_k_way_merge: expected [1,1,2,3,4,4,5,6], got ${JSON.stringify(trace.result)}`,
  );
  assert(
    trace.frames.length === 9,
    `heap_k_way_merge: one setup frame plus one per output value is 9, got ${trace.frames.length}`,
  );
  // The heap holds one value per list, never a whole list. Three lists means
  // three slots in every frame, and the output row keeps one width so its
  // cell ids stay addressable.
  assertHeapFigure("heap_k_way_merge", trace, 3);
  const outputs = trace.frames.map((frame) => {
    assert(frame.state.kind === "stacked", `heap_k_way_merge/${frame.id}: not stacked`);
    const bottom = frame.state.parts[1]!.state;
    assert(bottom.kind === "array", `heap_k_way_merge/${frame.id}: no array part`);
    const out = (bottom.asides ?? []).find((item) => item.id === "out");
    assert(out, `heap_k_way_merge/${frame.id}: the merged output row is missing`);
    assert(out.capacity === 8, `heap_k_way_merge/${frame.id}: the output row must stay 8 wide`);
    return out.cells.filter((cell) => cell.text).map((cell) => cell.text).join(" ");
  });
  assert(
    outputs[0] === "" && outputs[outputs.length - 1] === "1 1 2 3 4 4 5 6",
    `heap_k_way_merge: the output row must start empty and end complete, got ${JSON.stringify(outputs)}`,
  );
  // The answer is built in front of the student, so the output may only ever
  // grow by appending. A frame that rewrote an earlier cell would mean the
  // merge emitted a value out of order and quietly corrected it.
  for (let index = 1; index < outputs.length; index += 1) {
    assert(
      outputs[index]!.startsWith(outputs[index - 1]!),
      `heap_k_way_merge: output went from "${outputs[index - 1]}" to "${outputs[index]}"`,
    );
  }
  // Lists B and A run dry before the last pop, and a heap that shrinks is
  // half of what this problem teaches.
  const exhausted = trace.frames.filter((frame) => frame.caption.includes("is empty"));
  assert(
    exhausted.length === 2,
    `heap_k_way_merge: lists B and A run out before the last pop, got ${exhausted.length} such frames`,
  );
}

// --- Subsets: nums = [1,2,3]. Eight nodes, every one of them an answer. ---
{
  // backtrack(start, path) records path, then for i from start to 2 takes
  // nums[i] and recurses from i + 1. Depth first that records {} at [], 1 at
  // [1], 12 at [1,2], 123 at [1,2,3], then 13 after popping the 2, then 2
  // after popping back to the root, then 23, then 3. Eight nodes, which is 2
  // to the power of 3, and four leaves. No node is ever refused: subsets has
  // no goal test and no prune.
  const trace = runDefault("backtracking_subsets");
  assert(
    JSON.stringify(trace.result) ===
      JSON.stringify([[], [1], [1, 2], [1, 2, 3], [1, 3], [2], [2, 3], [3]]),
    `backtracking_subsets: wrong power set ${JSON.stringify(trace.result)}`,
  );
  const last = treeOf(trace.frames[trace.frames.length - 1]!);
  assert(last.layout.length === 8, `backtracking_subsets: 2^3 is 8 nodes, got ${last.layout.length}`);
  assert(
    JSON.stringify(last.out) === JSON.stringify(["{}", "1", "12", "123", "13", "2", "23", "3"]),
    `backtracking_subsets: the output row reads ${JSON.stringify(last.out)}`,
  );
  // Nothing is ever refused here, and a strike on this board would tell the
  // student a rule exists that does not.
  assert(
    trace.frames.every((frame) => treeOf(frame).nodes.every((node) => node.mark !== "excluded")),
    "backtracking_subsets: nothing is ever pruned here, so no node may be struck out",
  );
  // The pop back out of a finished branch is the word "backtracking" and it
  // has to be visible in the walk, not only in the narration.
  assert(
    trace.frames.some((frame) => frame.caption.startsWith("Pop back")),
    "backtracking_subsets: the walk must show a pop back out of a finished branch",
  );
  const roots = last.layout.filter((node) => !last.edges.some((edge) => edge.to === node.id));
  assert(
    roots.length === 1 && roots[0]!.label === "ε",
    "backtracking_subsets: one root, labelled for the empty subset",
  );
}

// --- Permutations: nums = [1,2,3]. Sixteen nodes, six of them answers. ---
{
  // Level 0 is the root, level 1 offers 3 values, level 2 offers the 2 left,
  // level 3 offers the 1 left: 1 + 3 + 3 by 2 + 6 by 1 = 16 nodes, of which 6
  // are leaves. Depth first the leaves come out 123, 132, 213, 231, 312, 321,
  // which is LeetCode's expected set. Only leaves are answers, so the first
  // answer cannot land before the walk is three deep: frames 0, 1, 2 are the
  // root, 1 and 12, and frame 3 is 123.
  const trace = runDefault("backtracking_permutations");
  assert(
    JSON.stringify(trace.result) ===
      JSON.stringify([[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]]),
    `backtracking_permutations: wrong permutations ${JSON.stringify(trace.result)}`,
  );
  const last = treeOf(trace.frames[trace.frames.length - 1]!);
  assert(
    last.layout.length === 16,
    `backtracking_permutations: 1 + 3 + 6 + 6 is 16 nodes, got ${last.layout.length}`,
  );
  assert(
    JSON.stringify(last.out) === JSON.stringify(["123", "132", "213", "231", "312", "321"]),
    `backtracking_permutations: the output row reads ${JSON.stringify(last.out)}`,
  );
  // Only leaves are answers, so the first one cannot appear before the walk
  // is three deep. Collecting at every node would be Subsets, not this.
  const firstAnswer = trace.frames.findIndex((frame) => treeOf(frame).out.length > 0);
  assert(
    firstAnswer === 3,
    `backtracking_permutations: the first answer lands on frame ${firstAnswer}, expected the third descent`,
  );
  assert(
    trace.frames.every((frame) => treeOf(frame).nodes.every((node) => node.mark !== "excluded")),
    "backtracking_permutations: a used value is never offered, so nothing is struck out",
  );
}

// --- Combination Sum: [2,3,6,7] for 7. Seven refusals against two answers. ---
{
  // Candidates are read smallest first and the row stops at the first
  // overshoot, because every later candidate is larger. By hand:
  //   ε   total 0: children 2, 3, 6 and 7, and 7 equals the target so it is
  //       collected. No overshoot, so no refusal.
  //   2   total 2: 22 (4), 23 (5), then 2+6 = 8 > 7 so 26 is struck and the
  //       row stops.
  //   22  total 4: 222 (6), 223 (7 equals the target, collect), then
  //       4+6 = 10 > 7 so 226 is struck.
  //   222 total 6: the first candidate already gives 6+2 = 8 > 7, so 222 is
  //       itself struck.
  //   23  total 5: the first allowed candidate gives 5+3 = 8 > 7, so 23 is
  //       itself struck.
  //   3   total 3: 33 (6), then 3+6 = 9 > 7 so 36 is struck.
  //   33  total 6: 6+3 = 9 > 7, so 33 is itself struck.
  //   6   total 6: 6+6 = 12 > 7, so 6 is itself struck.
  //   7   equals the target, collected.
  // Nodes ε, 2, 22, 222, 223, 226, 23, 26, 3, 33, 36, 6, 7 = 13. Struck: four
  // dead ends (222, 23, 33, 6) plus three overshoots (226, 26, 36) = 7.
  // Collected: 223 and 7. Still open: ε, 2, 22, 3. 7 + 2 + 4 = 13.
  const trace = runDefault("backtracking_combination_sum");
  assert(
    JSON.stringify(trace.result) === JSON.stringify([[2, 2, 3], [7]]),
    `backtracking_combination_sum: wrong combinations ${JSON.stringify(trace.result)}`,
  );
  const last = treeOf(trace.frames[trace.frames.length - 1]!);
  assert(last.layout.length === 13, `backtracking_combination_sum: 13 nodes, got ${last.layout.length}`);
  const struck = last.nodes.filter((node) => node.mark === "excluded").length;
  assert(
    struck === 7,
    `backtracking_combination_sum: four dead ends and three overshoots is 7 struck nodes, got ${struck}`,
  );
  assert(
    JSON.stringify(last.out) === JSON.stringify(["223", "7"]),
    `backtracking_combination_sum: the output row reads ${JSON.stringify(last.out)}`,
  );
  // The 2 is reused three deep down the left spine. That is the whole
  // difference from Subsets, where the loop restarts one past the choice.
  const spine = ["c2", "c22", "c222"];
  assert(
    spine.every((id) => last.layout.some((node) => node.id === id && node.label === "2")),
    "backtracking_combination_sum: 2 must be reusable three deep",
  );
  // The refusal has to be readable on the board, not only in the narration.
  assert(
    trace.frames.some((frame) => frame.caption.includes("past 7")),
    "backtracking_combination_sum: the overshoot that prunes a branch must be stated on the board",
  );
}

// --- Letter combinations: "23". Thirteen nodes, nine leaves, no pruning. ---
{
  // Key 2 carries abc and key 3 carries def, so the tree is 1 root + 3 + 3 by
  // 3 = 13 nodes, of which 9 are leaves, and the depth is fixed at 2 by the
  // digit count. Nothing can violate a constraint because there is no
  // constraint, so no node is ever struck. Depth first the leaves come out
  // ad, ae, af, bd, be, bf, cd, ce, cf, LeetCode's expected list exactly.
  const trace = runDefault("backtracking_phone_letters");
  assert(
    JSON.stringify(trace.result) ===
      JSON.stringify(["ad", "ae", "af", "bd", "be", "bf", "cd", "ce", "cf"]),
    `backtracking_phone_letters: wrong words ${JSON.stringify(trace.result)}`,
  );
  const last = treeOf(trace.frames[trace.frames.length - 1]!);
  assert(last.layout.length === 13, `backtracking_phone_letters: 1 + 3 + 9 is 13 nodes, got ${last.layout.length}`);
  const leaves = last.layout.filter((node) => !last.edges.some((edge) => edge.from === node.id));
  assert(leaves.length === 9, `backtracking_phone_letters: 3 times 3 is 9 leaves, got ${leaves.length}`);
  // This is the family with no constraint at all, which is exactly what makes
  // it worth drawing beside the other three.
  assert(
    trace.frames.every((frame) => treeOf(frame).nodes.every((node) => node.mark !== "excluded")),
    "backtracking_phone_letters: there is no constraint to break, so nothing may be struck out",
  );
  assert(
    JSON.stringify(last.out) === JSON.stringify(["ad", "ae", "af", "bd", "be", "bf", "cd", "ce", "cf"]),
    `backtracking_phone_letters: the output row reads ${JSON.stringify(last.out)}`,
  );
}

// --- Routing: named techniques win, LeetCode prose is recognised, physics declines. ---
{
  const cases: Array<[string, string | null]> = [
    ["explain merge sort", "merge_sort"],
    ["reverse a linked list in java", "reverse_linked_list"],
    ["walk me through floyd-warshall", "floyd_warshall"],
    ["how does kruskal's algorithm build an mst", "kruskal"],
    ["longest substring without repeating characters", "sliding_window_unique"],
    ["explain binary search", "binary_search"],
    ["what is edit distance between two strings", "edit_distance"],
    ["a car accelerates from rest at 2 m/s^2", null],
    ["draw the velocity-time graph for the motion", null],
    ["find the area under the curve y = x^2", null],
    // Contains Duplicate and Valid Anagram are the two statements most likely
    // to steal each other: both are bare "return true if" easies, separated
    // only by vocabulary that one of them owns and the other vetoes.
    ["contains duplicate", "hash_set_membership"],
    ["return true if t is an anagram of s", "hash_map_counting"],
    ["Given an array of strings strs, group the anagrams together.", "hash_map_grouping"],
    ["return the length of the longest palindrome that can be built with those letters", "char_count_pairing"],
    ["how does a hash map work internally? explain buckets and collisions", "hash_map_buckets"],
    // The internals ask must not become Two Sum, and Two Sum must not become
    // the internals ask. Both directions are held by vetoes, not by scores.
    ["explain how to use a hash map to solve two sum", "hash_map_two_sum"],
    // Longest Palindromic Substring is a different technique with almost the
    // same words, and this family must decline it rather than draw counts.
    ["given a string s, return the longest palindromic substring in s", null],
  ];
  for (const [question, expected] of cases) {
    const detected = detectAlgorithm(question);
    const actual = detected?.family.id ?? null;
    assert(
      actual === expected,
      `routing: "${question}" should resolve to ${expected ?? "no family"}, got ${actual ?? "no family"}`,
    );
  }

  // A bare problem statement names no technique but must still reach the lane.
  const statements = [
    "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.",
    "Given the head of a singly linked list, reverse the list and return the reversed list.",
    "Example 1: Input: s = \"abcabcbb\" Output: 3. Constraints: 0 <= s.length <= 5 * 10^4",
  ];
  for (const statement of statements) {
    assert(looksLikeCodingProblem(statement), `problem shape: missed "${statement.slice(0, 48)}..."`);
  }
  const notProblems = [
    "A block of mass 2 kg slides down a frictionless incline of 30 degrees.",
    "Given a triangle with sides 3, 4 and 5, find its area.",
  ];
  for (const statement of notProblems) {
    assert(!looksLikeCodingProblem(statement), `problem shape: false positive on "${statement.slice(0, 48)}..."`);
  }
}

// --- Ambiguity declines rather than guessing. ---
{
  assert(detectAlgorithm("sort it") === null, "routing: a bare verb must not pick a sorting family");
  assert(detectAlgorithm("") === null, "routing: an empty question must decline");
  const ranked = rankAlgorithms("explain dijkstra's shortest path algorithm");
  assert(ranked[0]?.family.id === "dijkstra", "routing: dijkstra must outrank floyd-warshall when named");
}

// --- A question's own example is preferred over the canned one. ---
{
  const family = familyById("binary_search")!;
  const run = family.run("binary search for target = 7 in [1, 3, 5, 7, 9, 11]");
  assert(run, "binary_search: should accept the question's own array");
  assert(run.exampleSource === "question", "binary_search: an explicit array must be used, not the default");
  const first = run.trace.frames[0]!;
  assert(
    JSON.stringify(arrayOf(first)) === JSON.stringify(["1", "3", "5", "7", "9", "11"]),
    "binary_search: the board must show the numbers the question gave",
  );
  assert(run.trace.result === 3, `binary_search: 7 sits at index 3, got ${String(run.trace.result)}`);
}

// --- Answer oracle: every family, checked against the answer by hand. ---
{
  // Nothing else in the repo checks whether a simulator computes the right
  // ANSWER. The render check proves the board shows what the trace says; this
  // proves the trace says the right thing. Each expectation below was worked
  // out by hand from the family's own default input, which the catalog fixes,
  // so a change to either the input or the algorithm has to come back here.
  const EXPECTED: Record<string, unknown> = {
    // [2,5,8,12,16,23,38] — 16 sits at index 4.
    binary_search: 4,
    // [1,3,4,6,8,11] target 10 — 4 + 6, indices 2 and 3.
    two_pointers: [2, 3],
    // [2,1,5,1,3,2,4] width 3 — 5+1+3 = 9 from index 2, the first such window.
    sliding_window_fixed: { maxSum: 9, startIndex: 2 },
    // "abcabcbb" — "abc" from index 0, length 3.
    sliding_window_unique: { length: 3, startIndex: 0 },
    merge_sort: [3, 9, 27, 38, 43, 82],
    bubble_sort: [1, 2, 4, 5, 8],
    reverse_linked_list: [4, 3, 2, 1],
    // [3,2,0,4] with the tail pointing back at index 2 — a cycle exists.
    linked_list_cycle: true,
    // 8(3(1,6),10(_,14)) read inorder is the sorted order.
    tree_traversal: ["1", "3", "6", "8", "10", "14"],
    // 6 < 8 goes left, 6 > 3 goes right: three nodes touched.
    bst_search: ["8", "3", "6"],
    // Breadth-first from A reaches B and C, then D.
    graph_traversal: ["A", "B", "C", "D"],
    // A and B have no prerequisites; C waits for both, then D, then E.
    topological_sort: ["A", "B", "C", "D", "E"],
    // A-C improves to 5 through B, and A-D to 8 through B.
    floyd_warshall: [[0, 3, 5, 8], [3, 0, 2, 5], [5, 2, 0, 4], [8, 5, 4, 0]],
    dijkstra: { A: 0, B: 3, C: 5, D: 8 },
    // Weights 1, 2, 4 accepted; the weight-3 edge would close a cycle.
    kruskal: { edges: ["A-B", "B-C", "C-D"], weight: 7 },
    prim: { edges: ["A-B", "B-C", "C-D"], weight: 7 },
    // "ABCB" and "BDCB" share "BCB".
    lcs: 3,
    // horse -> rorse -> rose -> ros is three edits.
    edit_distance: 3,
    // Capacity 7 takes the weight-3 and weight-4 items: 4 + 5 = 9.
    knapsack: 9,
    // [2,1,2,4,3]: 2->4, 1->2, 2->4, and the last two have nothing greater.
    monotonic_stack: [4, 2, 4, null, null],
    // [2,7,11,15] target 26 — 11 + 15, indices 2 and 3.
    hash_map_two_sum: [2, 3],
    // {0,1,2,3} and {4,5} are left after the four unions.
    union_find: { components: 2 },
    // 4 by 5 map: a 4-cell block, a 2-cell block on the right edge, a lone
    // cell at the bottom left.
    grid_islands: 3,
    // [[1,1,1],[1,1,0],[1,0,1]] filled from (1,1) with 2. The bottom right 1
    // is not 4-directionally connected, so it stays 1.
    grid_dfs_fill: [["2", "2", "2"], ["2", "2", "0"], ["2", "0", "1"]],
    // [[2,1,1],[1,1,0],[0,1,1]]: the one rotten orange takes 4 minutes.
    grid_bfs_multi_source: 4,
    // [[1,2,3],[0,2],[0,1,3],[0,2]]: 1 and 2 both take side B and share an edge.
    grid_bipartite: false,
    // 3 by 3: the corner cell is 6.
    dp_grid_paths: 6,
    // "{[()]}" nests three deep and every closer matches, so it is valid.
    stack_matching: true,
    // LC 155 Example 1: push -2, push 0, push -3, getMin, pop, top, getMin.
    min_stack: [null, null, null, -3, null, 0, -2],
    // LC 232 Example 1: push 1, push 2, peek, pop, empty.
    queue_two_stacks: [null, null, 1, 1, false],
    // 4! = 4 x 3 x 2 x 1.
    recursion_call_stack: 24,
    // Same three values: the stack gives back 3 then 2, the queue 1 then 2.
    stack_queue_ops: { popped: [3, 2], dequeued: [1, 2] },
    // [1,2,3,1] — 1 is met again at index 3, so the array is not distinct.
    hash_set_membership: true,
    // "anagram" is a3 n1 g1 r1 m1 and "nagaram" is n1 a3 g1 r1 m1: same bag.
    hash_map_counting: true,
    // eat/tea/ate share aet, tan/nat share ant, bat is alone under abt.
    hash_map_grouping: [["eat", "tea", "ate"], ["tan", "nat"], ["bat"]],
    // "abccccdd" is a1 b1 c4 d2: three pairs make 6, one odd letter makes 7.
    char_count_pairing: 7,
    // 12, 7 and 22 all leave 2 on division by 5; 3 leaves 3.
    hash_map_buckets: { buckets: [[], [], [12, 7, 22], [3], []] },
    // dp = 1,1,2,3,5,8,13. Fibonacci with the stairs' off-by-one.
    dp_fibonacci: 13,
    // [1,100,1,1,1,100]: dp = 0,0,1,2,2,3,3. Start at 0 and take three doubles.
    dp_min_cost_stairs: 3,
    // [2,7,9,3,1]: dp = 2,7,11,11,12. Houses 0, 2 and 4 give 2 + 9 + 1.
    dp_house_robber: 12,
    // coins [1,3,4] for 6: 3 + 3. Greedy would take 4 + 1 + 1 and say three.
    dp_coin_change: 2,
    // [10,9,2,5,3,7,101,18]: dp = 1,1,1,2,2,3,4,4. The run is 2, 5, 7, 101.
    dp_lis: 4,
    // [-2,1,-3,4,-1,2,1]: 4 + (-1) + 2 + 1 from index 3 to index 6.
    kadane: 6,
    // [2,3,1,1,4]: reach goes 2, 4, 4, 4, 8 and never falls behind the index.
    greedy_jump: true,
    // [4,5,6,7,0,1,2] target 0 — 0 sits at index 4.
    rotated_binary_search: 4,
    // piles [3,6,7,11] in 8 hours — speed 4 takes 1+2+2+3 = 8, speed 3 takes 10.
    binary_search_on_answer: 4,
    // [1,2,3] and [2,5,6] merged in place.
    merge_two_sorted_arrays: [1, 2, 2, 3, 5, 6],
    // [-1,0,1,2,-1,-4] sorted is [-4,-1,-1,0,1,2]: two distinct triplets.
    three_sum_two_pointers: [[-1, -1, 2], [-1, 0, 1]],
    // [0,1,0,2,1,0,1,3,2,1,2,1] — columns 2,4,5,6,9 hold 1,1,2,1,1.
    trapping_rain_water_two_pointers: 6,
    // [7,1,5,3,6,4] — buy at 1 on day 1, sell at 6 on day 4.
    single_pass_min_tracking: 5,
    // 4(2(1,3),7(6,9)) mirrored is 4(7(9,6),2(3,1)).
    tree_invert_recursion: [4, 7, 2, 9, 6, 3, 1],
    // 5(1,4(3,6)): 4 is a legal right child of nothing, it sits in 5's right
    // subtree and must exceed 5.
    bst_validate_bounds: false,
    // 6(2(0,4),8(7,9)) with p 0 and q 4: both below 6, then they straddle 2.
    bst_lca: 2,
    // -10(9,20(15,7)): 15 + 20 + 7, which the root never sees.
    tree_max_path_sum: 42,
    // 1(2,3(4,5)) preorder with a marker for each of the six empty children.
    tree_serialize_preorder: ["1", "2", "#", "#", "3", "4", "#", "#", "5", "#", "#"],
    // 8,3,10,1,6,14 arriving in that order, read back in order.
    bst_insert: ["1", "3", "6", "8", "10", "14"],
    // [[1,3],[2,6],[8,10],[15,18]] sorted by start is unchanged. 2 <= 3 so the
    // first two merge with end max(3,6) = 6; 8 > 6 and 15 > 10 stand alone.
    merge_intervals: [[1, 6], [8, 10], [15, 18]],
    // [5,3,8,4,2] partitioned around 5 gives [2,3,4,5,8], and both sides are
    // then already in order, so the sorted array is [2,3,4,5,8].
    quick_sort: [2, 3, 4, 5, 8],
    insertion_sort: [2, 3, 4, 5, 8],
    // [4,1,2,1,2]: 0^4^1^2^1^2 = 4, because both 1s and both 2s cancel.
    xor_fold: 4,
    // 11 is 1011, so n & (n - 1) runs three times: 10, then 8, then 0.
    bit_count: 3,
    // cat, car and dog share the prefix ca; car was inserted, so it is found.
    trie_insert_search: { words: ["cat", "car", "dog"], search: "car", found: true },
    // The 3 by 3 grid spirals 1 2 3, down 6 9, back 8 7, up 4, and ends on 5.
    spiral_layers: ["1", "2", "3", "6", "9", "8", "7", "4", "5"],
    // [1,2,4] and [1,3,4] splice into one chain of six nodes.
    merge_two_lists: [1, 1, 2, 3, 4, 4],
    // [1,2,3,4,5] with n = 2 drops the 4.
    two_pass_or_gap_pointers: [1, 2, 3, 5],
    // 342 + 465 = 807, written least significant digit first.
    digit_carry_list: [7, 0, 8],
    // [1,2,3,4,5] with k = 2: blocks 1 2 and 3 4 flip, the 5 stays.
    reverse_k_group: [2, 1, 4, 3, 5],
    // Insert 15 into [4,5,20,9,11,25], then pop the root.
    heap_sift: { min: 4, heap: [5, 9, 15, 20, 11, 25] },
    // [3,2,1,5,6,4] descending is 6,5,4,3,2,1, so the 2nd largest is 5.
    heap_top_k: 5,
    // [1,1,1,2,2,3] counts 1 three times, 2 twice, 3 once.
    heap_frequency: [1, 2],
    // [[1,4,5],[1,3,4],[2,6]] merged in order.
    heap_k_way_merge: [1, 1, 2, 3, 4, 4, 5, 6],
    // [1,2,3]: the eight nodes of the recursion tree, in the order the walk
    // reaches them. Every node is an answer, so nodes and answers coincide.
    backtracking_subsets: [[], [1], [1, 2], [1, 2, 3], [1, 3], [2], [2, 3], [3]],
    // [1,2,3]: only the six leaves are answers; 3 then 2 then 1 choices.
    backtracking_permutations: [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]],
    // [2,3,6,7] for 7: 2+2+3 down the reuse spine, and 7 on its own.
    backtracking_combination_sum: [[2, 2, 3], [7]],
    // "23": abc crossed with def, in keypad order.
    backtracking_phone_letters: ["ad", "ae", "af", "bd", "be", "bf", "cd", "ce", "cf"],
  };

  // Every walk must end on its own answer. Daily Temperatures walked the
  // whole array correctly and stopped on "73 waits on the stack", so the
  // student saw the technique and never the result.
  for (const family of ALGORITHM_FAMILIES) {
    const trace = runDefault(family.id);
    assert(
      typeof trace.resultText === "string" && trace.resultText.trim().length > 0,
      `${family.id}: the trace must state its answer in resultText, for the closing caption and the code planner`,
    );
    const closing = trace.frames[trace.frames.length - 1]!;
    assert(
      trace.resultText!.length <= 60,
      `${family.id}: resultText is the spoken answer, not the whole state (${trace.resultText!.length} chars)`,
    );
    const caption = closing.caption.toLowerCase();
    const tokens = trace.resultText!.toLowerCase().split(/[^a-z0-9∞.-]+/).filter((token) => token.length > 0);
    const stated = tokens.filter((token) => caption.includes(token)).length;
    assert(
      tokens.length === 0 || stated / tokens.length >= 0.5,
      `${family.id}: the last caption "${closing.caption}" does not state the answer "${trace.resultText}"`,
    );
  }

  // An aside is addressed by cell id across frames, so its capacity may not
  // change mid-walk: a row that grew would shift every address and the
  // trace-versus-render check would compare the wrong cells.
  for (const family of ALGORITHM_FAMILIES) {
    const trace = runDefault(family.id);
    const capacities = new Map<string, number>();
    for (const frame of trace.frames) {
      const asides = (frame.state as { asides?: Array<{ id: string; capacity: number; cells: unknown[] }> }).asides ?? [];
      for (const item of asides) {
        const width = Math.max(item.capacity, item.cells.length);
        const seen = capacities.get(item.id);
        if (seen === undefined) capacities.set(item.id, width);
        else assert(seen === width, `${family.id}/${frame.id}: aside "${item.id}" changed width ${seen} to ${width}`);
      }
    }
  }

  const missing = ALGORITHM_FAMILIES.filter((family) => !(family.id in EXPECTED));
  assert(
    missing.length === 0,
    `no answer oracle for ${missing.map((family) => family.id).join(", ")} — a new family must state the answer it computes`,
  );

  for (const family of ALGORITHM_FAMILIES) {
    const trace = runDefault(family.id);
    const expected = JSON.stringify(EXPECTED[family.id]);
    const actual = JSON.stringify(trace.result);
    assert(
      actual === expected,
      `${family.id}: computed ${actual}, but the answer is ${expected}`,
    );
  }
}

console.log(`verify-dsa-trace: ${ALGORITHM_FAMILIES.length} families, all checks passed`);
