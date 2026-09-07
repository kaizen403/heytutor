/**
 * Discrete-structure synthesis gate: every DSA structure compiles green from
 * a well-formed hint, and malformed or dishonest hints fail closed.
 */
import {
  normalizeDsaDiagramHint,
  synthesizeDsaHintFrames,
  synthesizeDsaScene,
  synthesizeDsaSceneDocument,
  compileSceneDocument,
} from "../../src";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function primitiveBounds(primitive: { points: Array<{ x: number; y: number }> }): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const xs = primitive.points.map((point) => point.x);
  const ys = primitive.points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function labelBox(primitive: {
  points: Array<{ x: number; y: number }>;
  provenance?: Record<string, unknown>;
}): { x: number; y: number; width: number; height: number } {
  const bounds = primitive.provenance?.labelBounds;
  if (
    bounds &&
    typeof bounds === "object" &&
    typeof (bounds as { x?: unknown }).x === "number"
  ) {
    const box = bounds as { x: number; y: number; width: number; height: number };
    return box;
  }
  const point = primitive.points[0]!;
  return { x: point.x - 8, y: point.y - 8, width: 16, height: 16 };
}

function boxInside(
  inner: { x: number; y: number; width: number; height: number },
  outer: { x: number; y: number; width: number; height: number },
  gap: number,
): boolean {
  return (
    inner.x >= outer.x + gap &&
    inner.y >= outer.y + gap &&
    inner.x + inner.width <= outer.x + outer.width - gap &&
    inner.y + inner.height <= outer.y + outer.height - gap
  );
}

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  gap: number,
): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

function assertValueLabelsInsideMarks(
  scene: { primitives: Array<{
    kind: string;
    entityId: string;
    points: Array<{ x: number; y: number }>;
    radius?: number;
    provenance?: Record<string, unknown>;
  }> },
  message: string,
  gap = 4,
): void {
  const marks = scene.primitives.filter((primitive) =>
    primitive.kind === "rectangle" || primitive.kind === "circle",
  );
  for (const mark of marks) {
    const label = scene.primitives.find((primitive) =>
      primitive.kind === "label" && primitive.entityId === mark.entityId,
    );
    if (!label) continue;
    const outer = mark.kind === "circle" && mark.points[0]
      ? {
          x: mark.points[0].x - (mark.radius ?? 20),
          y: mark.points[0].y - (mark.radius ?? 20),
          width: (mark.radius ?? 20) * 2,
          height: (mark.radius ?? 20) * 2,
        }
      : primitiveBounds(mark);
    assert(boxInside(labelBox(label), outer, gap), `${message} (${mark.entityId})`);
  }
}

function assertIndexLabelsClearOfCells(
  scene: { primitives: Array<{
    kind: string;
    entityId: string;
    points: Array<{ x: number; y: number }>;
    provenance?: Record<string, unknown>;
  }> },
  message: string,
): void {
  const cells = scene.primitives.filter((primitive) => primitive.kind === "rectangle");
  for (const label of scene.primitives.filter((primitive) =>
    primitive.kind === "label" && /idx|ptr.*_lbl|index/.test(primitive.entityId),
  )) {
    const box = labelBox(label);
    for (const cell of cells) {
      assert(
        !boxesOverlap(box, primitiveBounds(cell), 2),
        `${message}: ${label.entityId} overlaps ${cell.entityId}`,
      );
    }
  }
}

// --- array ---
const array = synthesizeDsaScene({
  structure: "array",
  values: [3, 8, 12, 17, 23, 31],
  pointers: [
    { name: "lo", index: 0 },
    { name: "mid", index: 2 },
    { name: "hi", index: 5 },
  ],
  caption: "sorted array with search bounds",
});
assert(array, "array hint must compile");
assert(array.tier === "qualitative_verified", "DSA scenes are qualitative_verified");
assert(array.nonMetric, "DSA scenes are non-metric");
assert(
  array.document.constructions.filter((construction) => construction.operator === "rectangle").length === 6,
  "array must construct one rectangle per value",
);
assert(
  array.document.constructions.filter((construction) => construction.operator === "vector").length === 3,
  "array must construct one arrow per pointer",
);
assert(
  array.document.assertions.some((assertion) => assertion.predicate === "ordered_along"),
  "array must prove cell ordering",
);
assert(
  array.document.assertions.some((assertion) => assertion.predicate === "equal_spacing"),
  "array must prove even cell spacing",
);
assert(array.renderScene.primitives.length >= 9, "array scene is missing visible primitives");
assert(
  array.renderScene.revealGroups.length === 2 &&
    array.renderScene.revealGroups[0]!.id === "structure" &&
    array.renderScene.revealGroups[1]!.dependsOn.includes("structure"),
  "array reveal is staged structure -> markers",
);
assert(array.renderScene.caption?.includes("sorted array"), "caption must survive compile");
assertValueLabelsInsideMarks(array.renderScene, "array values must sit inside their cells");
assertIndexLabelsClearOfCells(array.renderScene, "array indices and pointer names must not touch cells");

// --- linked list ---
const linkedList = synthesizeDsaScene({
  structure: "linked_list",
  nodes: [
    { id: "a", label: "1" },
    { id: "b", label: "2" },
    { id: "c", label: "3" },
    { id: "d", label: "4" },
  ],
});
assert(linkedList, "linked list hint must compile");
assertValueLabelsInsideMarks(linkedList.renderScene, "linked-list values must sit inside their nodes");
assert(
  linkedList.document.constructions.filter((construction) => construction.operator === "vector").length === 3,
  "linked list must draw one next-arrow per adjacent pair",
);
assert(
  linkedList.document.assertions.some((assertion) => assertion.predicate === "ordered_along"),
  "linked list must prove node ordering",
);

// --- tree ---
const tree = synthesizeDsaScene({
  structure: "tree",
  nodes: [
    { id: "r", label: "8" },
    { id: "l", label: "3" },
    { id: "rr", label: "10" },
    { id: "ll", label: "1" },
    { id: "lr", label: "6" },
  ],
  edges: [
    { from: "r", to: "l" },
    { from: "r", to: "rr" },
    { from: "l", to: "ll" },
    { from: "l", to: "lr" },
  ],
});
assert(tree, "tree hint must compile");
assert(
  tree.document.constructions.filter((construction) => construction.operator === "circle").length === 5,
  "tree must construct one circle per node",
);
assert(
  tree.document.assertions.filter((assertion) =>
    assertion.predicate === "ordered_along" && assertion.id.startsWith("parent_above"),
  ).length === 4,
  "tree must prove parent-above-child for every edge",
);

// --- graph ---
const graph = synthesizeDsaScene({
  structure: "graph",
  nodes: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
    { id: "d", label: "D" },
  ],
  edges: [
    { from: "a", to: "b", label: "4" },
    { from: "b", to: "c", label: "2" },
    { from: "c", to: "d" },
    { from: "d", to: "a", label: "7" },
    { from: "a", to: "c" },
  ],
});
assert(graph, "graph hint must compile");
assert(
  graph.document.constructions.filter((construction) => construction.operator === "segment").length === 5,
  "graph must construct one segment per edge",
);
assert(
  graph.document.constructions.filter((construction) => construction.operator === "label").length === 3,
  "graph must label only weighted edges",
);

// --- table ---
const table = synthesizeDsaScene({
  structure: "table",
  rowLabels: ["dp[0]", "dp[1]", "dp[2]"],
  colLabels: ["0", "1", "2", "3"],
  cells: [
    ["0", "1", "1", "2"],
    ["0", "1", "2", "3"],
    ["0", "1", "2", "4"],
  ],
});
assert(table, "table hint must compile");
assert(
  table.document.constructions.filter((construction) => construction.operator === "rectangle").length === 20,
  "table must construct one rectangle per header and cell",
);
assert(
  table.document.assertions.some((assertion) =>
    assertion.predicate === "equal_spacing" && assertion.id === "rows_evenly_spaced",
  ),
  "table must prove even row spacing",
);
assert(table.renderScene.primitives.length >= 10, "table scene is missing grid primitives");
assert(
  !table.renderScene.primitives.some((primitive) =>
    primitive.kind === "line" && primitive.provenance?.dashed === true,
  ),
  "table must not emit dashed label-leader strokes",
);

const floyd = synthesizeDsaScene(
  {
    structure: "table",
    rowLabels: ["A", "B", "C"],
    colLabels: ["A", "B", "C"],
    cells: [
      ["3", "8", "∞"],
      ["8", "0", "4"],
      ["∞", "4", "0"],
    ],
  },
  { compile: { viewport: { x: 620, y: 90, width: 540, height: 460 } } },
);
assert(floyd, "Floyd–Warshall distance table must compile");
const floydThree = floyd.renderScene.primitives.find((primitive) =>
  primitive.kind === "label" && primitive.text === "3",
);
const floydEight = floyd.renderScene.primitives.find((primitive) =>
  primitive.kind === "label" && primitive.text === "8",
);
assert(floydThree?.points[0] && floydEight?.points[0], "distance labels must render");
assert(
  floydThree.points[0]!.x + 24 < floydEight.points[0]!.x,
  "a 3 in the first data column must sit left of the 8 in the next column",
);
assertValueLabelsInsideMarks(floyd.renderScene, "distance-table values must sit inside their cells");

const stripped = normalizeDsaDiagramHint({
  structure: "table",
  rowLabels: ["A", "B"],
  colLabels: ["A", "B"],
  cells: [
    ["A", "0", "3"],
    ["B", "3", "0"],
  ],
});
assert(
  stripped?.cells?.[0]?.[0] === "0" && stripped.cells[0][1] === "3",
  "a duplicated row-header column must be stripped so values keep their columns",
);

// --- viewport compile (the DSA board split) ---
const framed = synthesizeDsaScene(
  { structure: "array", values: [1, 2, 3, 4] },
  { compile: { viewport: { x: 620, y: 90, width: 540, height: 460 } } },
);
assert(framed, "array must compile into the DSA viewport");
const outOfZone = framed.renderScene.primitives.flatMap((primitive) => primitive.points)
  .filter((point) => point.x < 600 || point.x > 1180);
assert(outOfZone.length === 0, "DSA viewport compile must keep every point inside the right zone");
assertValueLabelsInsideMarks(framed.renderScene, "DSA-viewport array values must sit inside their cells");

// --- fail-closed mutations ---
assert(synthesizeDsaScene(null) === null, "null hint fails closed");
assert(synthesizeDsaScene({ structure: "none" }) === null, "structure none fails closed");
assert(synthesizeDsaScene({ structure: "array", values: [5] }) === null, "single-cell array fails closed");
assert(
  synthesizeDsaScene({
    structure: "tree",
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
    edges: [{ from: "a", to: "b" }],
  }) === null,
  "tree with disconnected nodes fails closed",
);
assert(
  synthesizeDsaScene({
    structure: "tree",
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
    edges: [{ from: "a", to: "c" }, { from: "b", to: "c" }],
  }) === null,
  "node with two parents fails closed",
);
assert(
  synthesizeDsaScene({ structure: "table", rowLabels: ["r1"], colLabels: [] }) === null,
  "table without columns fails closed",
);

const normalized = normalizeDsaDiagramHint({
  structure: "array",
  values: [1, 2, 3],
  pointers: [{ name: "p", index: 9 }],
});
assert(
  normalized && normalized.pointers!.length === 0,
  "out-of-range pointers are dropped by normalization",
);

// A dishonest layout must fail the proof, not render. Recreate the array
// document and break the cell ordering before compiling.
const brokenDocument = synthesizeDsaSceneDocument({
  structure: "array",
  values: ["1", "2", "3"],
  pointers: [],
});
assert(brokenDocument, "baseline array document must synthesize");
const sabotaged = {
  ...brokenDocument,
  constructions: brokenDocument.constructions.map((construction) =>
    construction.id === "make_c2"
      ? { ...construction, inputs: { ...construction.inputs, x: -5 } }
      : construction,
  ),
};
const sabotagedCompile = compileSceneDocument(sabotaged);
assert(
  !sabotagedCompile.ok ||
    sabotagedCompile.report.issues.some((issue) => issue.severity === "fatal"),
  "an out-of-order cell layout must fail the ordering proof",
);

// Staged example frames: the whole array, then two split halves.
const mergeSteps = synthesizeDsaScene({
  structure: "array",
  caption: "merge sort splits the input",
  values: [8, 3, 5, 1],
  steps: [
    { id: "input", caption: "input", values: [8, 3, 5, 1] },
    {
      id: "split",
      caption: "two halves",
      groups: [{ values: [8, 3] }, { values: [5, 1] }],
    },
  ],
});
assert(mergeSteps, "a two-step array example must compile");
assert(
  mergeSteps.document.revealGroups.map((group) => group.id).join(",") === "input,split",
  "each example frame is its own reveal group",
);
assert(
  mergeSteps.document.revealGroups[1]!.dependsOn.includes("input"),
  "the split frame waits on the input frame",
);
assert(
  mergeSteps.document.constructions.filter((construction) => construction.operator === "rectangle").length === 8,
  "input cells plus both halves must all be constructed",
);

// --- Table layouts that used to shift every value. ---
// The header layout is decided by the grid's shape, not by matching header
// text, and any shape that is not one of the four legible layouts declines.

// Both headers present: the natural model output for a distance matrix. This
// used to match neither strip rule and then get reshaped one row and one
// column out of place, putting header letters in data cells.
const bothHeaders = normalizeDsaDiagramHint({
  structure: "table",
  rowLabels: ["A", "B", "C"],
  colLabels: ["A", "B", "C"],
  cells: [
    ["", "A", "B", "C"],
    ["A", "0", "3", "8"],
    ["B", "3", "0", "2"],
    ["C", "8", "2", "0"],
  ],
});
assert(
  bothHeaders?.cells?.[0]?.[0] === "0" && bothHeaders.cells[0][1] === "3" && bothHeaders.cells[0][2] === "8",
  `both-headers layout must yield the data body, got ${JSON.stringify(bothHeaders?.cells?.[0])}`,
);
assert(
  bothHeaders.cells[2]?.[0] === "8",
  "row C column A must stay 8 after both headers are stripped",
);

// A header column whose labels do NOT match the declared rowLabels verbatim.
// The old exact-equality strip declined here and every value slid one column.
const renamedHeaders = normalizeDsaDiagramHint({
  structure: "table",
  rowLabels: ["dist(A)", "dist(B)"],
  colLabels: ["A", "B"],
  cells: [
    ["A", "0", "3"],
    ["B", "3", "0"],
  ],
});
assert(
  renamedHeaders?.cells?.[0]?.[0] === "0" && renamedHeaders.cells[0][1] === "3",
  `a header column must be stripped by shape even when its text differs, got ${JSON.stringify(renamedHeaders?.cells?.[0])}`,
);

// Ragged rows mean the model lost its place; repairing that is a guess.
assert(
  normalizeDsaDiagramHint({
    structure: "table",
    rowLabels: ["A", "B"],
    colLabels: ["A", "B"],
    cells: [["0", "3"], ["3"]],
  }) === null,
  "a ragged grid must decline rather than be padded into a rectangle",
);

// A flat list whose length names no exact layout used to render an all-blank
// grid that still passed every structural check.
assert(
  normalizeDsaDiagramHint({
    structure: "table",
    rowLabels: ["A", "B"],
    colLabels: ["A", "B"],
    cells: ["0", "3", "3"],
  }) === null,
  "a flat cell list of the wrong length must decline, not draw an empty table",
);

// A grid that is simply the wrong size for its headers.
assert(
  normalizeDsaDiagramHint({
    structure: "table",
    rowLabels: ["A", "B", "C"],
    colLabels: ["A", "B"],
    cells: [["0", "3"], ["3", "0"]],
  }) === null,
  "a grid with too few rows for its headers must decline",
);

// --- An unrecognised question still gets a figure that moves. ---
{
  // When no algorithm family matches, the planner's own hint steps are the
  // walk-through. They used to be stacked into one document offset row by
  // row, so a four-step array walk drew the same array four times down the
  // zone — and with one document there is nothing to advance to, so the board
  // stood still for the whole lesson.
  const hint = {
    structure: "array",
    caption: "Sliding window",
    values: [4, 2, 7, 1, 9],
    steps: [
      { id: "start", caption: "window covers 4 and 2", values: [4, 2, 7, 1, 9], pointers: [{ name: "lo", index: 0 }, { name: "hi", index: 1 }] },
      { id: "slide1", caption: "window covers 2 and 7", values: [4, 2, 7, 1, 9], pointers: [{ name: "lo", index: 1 }, { name: "hi", index: 2 }] },
      { id: "slide2", caption: "window covers 7 and 1", values: [4, 2, 7, 1, 9], pointers: [{ name: "lo", index: 2 }, { name: "hi", index: 3 }] },
    ],
  };
  const frames = synthesizeDsaHintFrames(hint, { question: "sliding window" });
  assert(frames, "a three-step array hint must compile into frames");
  assert(
    frames.frames.length === 3,
    `one figure per step, got ${frames.frames.length}`,
  );

  // Each frame is one step's figure, not the stack. Measured against the
  // stacked builder on the same hint: that one draws every step's array at
  // once, which is the duplicated-diagram the frames replace. The compiled
  // kind for a cell is "rectangle", not "path" — a guard written against the
  // wrong kind counts zero cells and passes vacuously.
  const stacked = synthesizeDsaScene(hint, {});
  assert(stacked, "the stacked builder must still work as the last-resort figure");
  const cellsIn = (primitives: ReadonlyArray<{ kind: string }>) =>
    primitives.filter((primitive) => primitive.kind === "rectangle").length;
  const stackedCells = cellsIn(stacked.renderScene.primitives);
  assert(
    stackedCells >= hint.values.length * hint.steps.length,
    `the stacked figure should draw every step's array, got ${stackedCells} cells`,
  );
  for (const [index, frame] of frames.frames.entries()) {
    const cells = cellsIn(frame.renderScene.primitives);
    assert(
      cells === hint.values.length,
      `frame ${index + 1} must draw the array exactly once (${hint.values.length} cells), got ${cells}`,
    );
  }
  for (const [index, frame] of frames.frames.entries()) {
    assert(
      frame.caption === hint.steps[index]!.caption,
      `frame ${index + 1} must carry its own caption, got "${frame.caption}"`,
    );
    assert(
      typeof frame.renderScene.caption === "string" &&
        frame.renderScene.caption.includes(frame.caption),
      `frame ${index + 1}'s caption must survive compilation`,
    );
  }

  // A hint with nothing to walk is not a walk-through; the caller falls back
  // to the single figure rather than inventing frames.
  assert(
    synthesizeDsaHintFrames({ structure: "array", values: [1, 2, 3] }, {}) === null,
    "a hint with no steps must decline",
  );
  assert(
    synthesizeDsaHintFrames({ ...hint, steps: [hint.steps[0]] }, {}) === null,
    "a single step is one figure, not a walk-through",
  );
}

// --- A dynamic programming table walks its steps. ---
//
// This is the commonest figure in all of DSA and it drew nothing at all. Two
// separate causes, both silent. The row cap was 6 while Distinct Subsequences
// needs 8, so the labels were truncated, the cells then no longer matched the
// labels, `normalizeTableCells` returned null, and the whole hint was
// discarded: the student watched a blank board for the entire lesson. And a
// table was refused a walk-through outright, on the reasoning that its steps
// carry no cells, when the planner had been sending a full grid per step all
// along and the step normaliser was dropping it.
{
  const rowLabels = ["", "r", "a", "b", "b", "b", "i", "t"];
  const colLabels = ["", "r", "a", "b", "b", "i", "t"];
  const grid = (fill: (row: number, column: number) => string): string[][] =>
    rowLabels.map((_unused, row) => colLabels.map((__unused, column) => fill(row, column)));

  const base = grid((_row, column) => (column === 0 ? "1" : "0"));
  const later = grid((row, column) => (column === 0 ? "1" : row >= column ? "1" : "0"));

  // Eight rows: one more than the old cap, and the size a real DP table needs.
  const hint = {
    structure: "table",
    caption: "DP table for s = rabbbit, t = rabbit",
    rowLabels,
    colLabels,
    cells: base,
    steps: [
      { id: "input", caption: "Base cases only", cells: base },
      { id: "filled", caption: "After the first rows", cells: later },
    ],
  };

  const single = synthesizeDsaScene(hint, {});
  assert(single, "an eight row table must compile: the cap is a drawing limit, not an arbitrary bound");

  // The steps state their values and inherit the axes, which do not change.
  // Requiring each step to repeat the headers threw every step away.
  const walk = synthesizeDsaHintFrames(hint, {});
  assert(walk, "a table whose steps carry cells must walk them");
  assert(walk!.frames.length === 2, `expected 2 table frames, got ${walk!.frames.length}`);
  assert(
    walk!.frames[0]!.caption !== walk!.frames[1]!.caption,
    "each table frame must be about its own step",
  );

  // The guard that remains: identical grids are not a walk, they are one
  // figure shown five times.
  assert(
    synthesizeDsaHintFrames({ ...hint, steps: [
      { id: "a", caption: "one", cells: base },
      { id: "b", caption: "two", cells: base },
    ] }, {}) === null,
    "identical grids are one figure, not a walk-through",
  );
  assert(
    synthesizeDsaHintFrames({ ...hint, steps: [
      { id: "a", caption: "one" },
      { id: "b", caption: "two" },
    ] }, {}) === null,
    "a table walk with no cells per step would be the same matrix every frame",
  );

  // Past the cap it still fails closed rather than drawing a corner of the
  // table as though it were the whole thing.
  const tooTall = Array.from({ length: 14 }, (_unused, row) => (row === 0 ? "" : `r${row}`));
  assert(
    synthesizeDsaScene({
      structure: "table",
      rowLabels: tooTall,
      colLabels,
      cells: tooTall.map(() => colLabels.map(() => "1")),
    }, {}) === null,
    "a table past the cap must draw nothing rather than a truncated corner presented as the whole",
  );
}

// --- Two pointers on one cell share an arrow instead of killing the figure. ---
//
// One arrow per pointer put two identical vectors and two identical labels at
// the same point, and the compiler refused the whole figure rather than the
// pointer. This is not an edge case: expand around centre starts with left
// equal to right, a two pointer walk ends with them meeting, slow and fast
// collide. Longest Palindromic Substring drew a blank board for its whole
// lesson because of it.
{
  const base = {
    structure: "array",
    caption: "expanding around the centre",
    values: ["b", "a", "b", "a", "d"],
  };

  const together = synthesizeDsaScene({ ...base, pointers: [
    { name: "l", index: 1 },
    { name: "r", index: 1 },
  ] }, {});
  assert(together, "two pointers on one cell must still draw the figure");
  const labels = together!.document.constructions
    .filter((construction) => construction.operator === "label")
    .map((construction) => String((construction.inputs as { text?: unknown }).text ?? ""));
  assert(
    labels.includes("l r"),
    `both names must be readable over the one arrow, got ${JSON.stringify(labels)}`,
  );
  // One arrow, not two stacked on the same point.
  const arrows = together!.document.entities.filter((entity) => entity.kind === "vector");
  assert(arrows.length === 1, `expected one shared arrow, got ${arrows.length}`);

  // Apart, they are still two arrows.
  const apart = synthesizeDsaScene({ ...base, pointers: [
    { name: "l", index: 1 },
    { name: "r", index: 3 },
  ] }, {});
  assert(apart, "pointers on different cells must draw");
  assert(
    apart!.document.entities.filter((entity) => entity.kind === "vector").length === 2,
    "pointers on different cells keep their own arrows",
  );
}

console.log("verify-discrete-structures: all checks passed");
