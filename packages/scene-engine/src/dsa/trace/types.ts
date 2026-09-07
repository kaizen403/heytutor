/**
 * Execution traces for DSA worked examples.
 *
 * A trace is what an algorithm actually did to one small concrete input,
 * recorded frame by frame. The board renders the trace, so a number sits in a
 * cell because the simulator put it there — not because a language model
 * guessed it. This is the whole point of the layer: `dsaFamilies` accepted a
 * model-authored `diagramHint` verbatim and had no assertion that mentioned a
 * value, which is how a Floyd-Warshall 3 ended up in the wrong column.
 *
 * Simulators are pure and deterministic: same input, same frames, every run.
 * That is what lets an offline gate compare a compiled label against the
 * trace value at the same address and fail when they disagree.
 *
 * A frame is more than the main structure. A teacher's board for breadth
 * first search has the graph and the queue; for a dynamic programming table
 * it has the cell being written and the cells it reads; for a stack walk it
 * has the input and the stack beside it. `asides` carry that second structure
 * for every frame kind, and `stacked` puts whole figures one above another
 * (a heap over its array, two lists over their merge).
 */

/** How a cell, node, or edge is doing at this instant of the algorithm. */
export type TraceMark =
  /** The element the algorithm is looking at right now. Drawn as a filled wash. */
  | "active"
  /** Inside the current window, range, or partition. Drawn as a dashed outline. */
  | "window"
  /** Settled — sorted, visited, finalized. Drawn as a tick (cells) or a double ring (nodes). */
  | "done"
  /** Under consideration but not yet accepted. Drawn dashed. */
  | "candidate"
  /** Ruled out; the algorithm will not revisit it. Drawn struck through. */
  | "excluded";

/** One drawn value. `text` is already stringified by the simulator. */
export interface TraceCell {
  text: string;
  mark?: TraceMark;
}

/** A named index marker (`lo`, `hi`, `slow`, `fast`, `i`, `j`). */
export interface TracePointer {
  name: string;
  index: number;
}

export interface TraceNode {
  id: string;
  label: string;
  mark?: TraceMark;
}

export interface TraceEdge {
  from: string;
  to: string;
  label?: string;
  mark?: TraceMark;
}

/** A labelled run of cells drawn as its own block (merge-sort halves). */
export interface TraceGroup {
  id: string;
  label?: string;
  cells: TraceCell[];
}

/**
 * A labelled bracket spanning a contiguous run of cells, drawn under the row.
 *
 * This is how a region claim becomes ink. A `done` mark on a cell used to be
 * the only way a simulator could say "this tail is finished", and marks are
 * discarded by the renderer unless they are `active` or `window`, so the
 * settled region of a sort was invisible on the board. A bracket is what a
 * teacher actually draws, and it carries its own label.
 */
export interface TraceBracket {
  /** Inclusive cell indices. */
  from: number;
  to: number;
  /**
   * At most 16 characters; drawn under the bracket.
   *
   * Sixteen, not twenty: the document validator's `isCompactDiagramLabel`
   * rejects anything longer, and `compileTraceScenes` fails closed, so a
   * seventeen-character bracket label costs the whole trace its figure rather
   * than costing that one bracket its words.
   */
  label: string;
}

/**
 * Two cells exchanging values, drawn as the crossing-arc glyph.
 *
 * A swap is the whole content of an exchange sort and it was previously
 * invisible: the board showed the array before a pass and after it, so every
 * comparison and every swap happened between two frames. `swap` names the
 * pair that moved so the move itself can be drawn.
 */
export interface TraceSwap {
  from: number;
  to: number;
}

/**
 * A rectangle in bar coordinates over an array frame that draws bars: the
 * water held between two lines, the rectangle a histogram pop measures, the
 * water above one cell. `bottom` and `top` are in value units on the same
 * scale as `bars`; `from` and `to` are inclusive cell indices.
 */
export interface TraceOverlay {
  from: number;
  to: number;
  bottom: number;
  top: number;
  label?: string;
}

/**
 * A second, smaller structure drawn beside the main figure: the queue during
 * a breadth first search, the stack during a bracket check, the map of values
 * already seen, the output list a traversal builds, the distance table.
 *
 * Pre-sized to `capacity` so every cell keeps its id across frames; a
 * structure that grew mid-trace would shift every address and defeat the
 * trace-versus-render check. A column grows upward from cell 0 at the bottom,
 * which is how a stack is drawn; a row grows left to right, which is how a
 * queue or an output list is drawn.
 */
export interface TraceAside {
  /** Stable slug: "queue", "stack", "seen", "out", "dist". */
  id: string;
  /** Drawn beside the structure; at most 12 characters. */
  title: string;
  orientation: "row" | "column";
  cells: TraceCell[];
  capacity: number;
}

/** A line of text drawn above the figure: "target = 9", "sum = 7, best = 8". */
export type TraceNote = string;

export interface ArrayFrameState {
  kind: "array";
  cells: TraceCell[];
  pointers?: TracePointer[];
  /** When present the frame draws these blocks instead of one flat row. */
  groups?: TraceGroup[];
  /**
   * Magnitude column above each cell, parallel to `cells`. Digits in
   * boxes make sortedness unreadable; bar heights make it obvious at a
   * glance, which is the whole reason a sorting visualizer draws bars.
   * Values must be finite and non-negative, and the scale is fixed by the
   * largest value in the frame.
   */
  bars?: number[];
  /** The exchange happening in this frame, drawn as crossing arcs. */
  swap?: TraceSwap;
  /** Labelled regions under the row, such as the settled tail. */
  brackets?: TraceBracket[];
  /** Rectangles in bar units, for water and area problems. */
  overlays?: TraceOverlay[];
  /** Whether to write the index under every cell. Defaults to true for flat rows without bars. */
  showIndices?: boolean;
  note?: TraceNote;
  asides?: TraceAside[];
}

export interface ListFrameState {
  kind: "list";
  nodes: TraceNode[];
  links: TraceEdge[];
  pointers?: TracePointer[];
  note?: TraceNote;
  asides?: TraceAside[];
}

export interface TreeAnnotation {
  nodeId: string;
  /** At most 8 characters, drawn beside the node: "(5,∞)", "↑35", "$". */
  text: string;
}

export interface TreeFrameState {
  kind: "tree";
  nodes: TraceNode[];
  edges: TraceEdge[];
  /**
   * The tree whose layout every frame uses, when the drawn tree is a subset
   * of it (an insertion walk draws the tree growing; without this each frame
   * would be laid out on its own and nodes would jump between frames).
   */
  layoutNodes?: TraceNode[];
  layoutEdges?: TraceEdge[];
  annotations?: TreeAnnotation[];
  note?: TraceNote;
  asides?: TraceAside[];
}

export interface GraphFrameState {
  kind: "graph";
  nodes: TraceNode[];
  edges: TraceEdge[];
  /** Arrowheads on every edge, from `from` to `to`. */
  directed?: boolean;
  /** Fixed positions in world units; the default is a planar-ish ring. */
  positions?: Record<string, { x: number; y: number }>;
  note?: TraceNote;
  asides?: TraceAside[];
}

export interface GridFrameState {
  kind: "grid";
  rowLabels: string[];
  colLabels: string[];
  /** `cells[row][col]`, headers excluded. Ragged rows are a simulator bug. */
  cells: TraceCell[][];
  /** Cells the written cell was computed from, drawn as arrows into `write`. */
  reads?: Array<[number, number]>;
  write?: [number, number];
  note?: TraceNote;
  asides?: TraceAside[];
}

/** A grid of cells with no headers: a map of land and water, a board, an image. */
export interface MatrixFrameState {
  kind: "matrix";
  cells: TraceCell[][];
  /** Row and column indices along the top and left. */
  showIndices?: boolean;
  /** A route through cells, drawn as arrows between consecutive centres. */
  path?: Array<[number, number]>;
  note?: TraceNote;
  asides?: TraceAside[];
}

export interface NumberLineBar {
  id: string;
  from: number;
  to: number;
  /** 0 is the output lane directly above the line; higher lanes sit above it. */
  lane: number;
  label?: string;
  mark?: TraceMark;
}

/** Intervals as bars above a number line. */
export interface NumberLineFrameState {
  kind: "numberline";
  min: number;
  max: number;
  ticks: number[];
  bars: NumberLineBar[];
  note?: TraceNote;
  asides?: TraceAside[];
}

/** Whole figures stacked top to bottom, each with its own label. */
export interface StackedFrameState {
  kind: "stacked";
  parts: Array<{ state: Exclude<TraceFrameState, StackedFrameState>; label?: string }>;
  note?: TraceNote;
}

export type TraceFrameState =
  | ArrayFrameState
  | ListFrameState
  | TreeFrameState
  | GraphFrameState
  | GridFrameState
  | MatrixFrameState
  | NumberLineFrameState
  | StackedFrameState;

export type TraceStructure = TraceFrameState["kind"];

export interface TraceFrame {
  /** Stable slug — the reveal-group id and the gate's address for this frame. */
  id: string;
  /** At most 60 characters; drawn under the figure. */
  caption: string;
  /** What the tutor should say while this frame is up. */
  narrationIntent: string;
  state: TraceFrameState;
}

export interface AlgorithmTrace {
  algorithmId: string;
  title: string;
  /** The concrete input, so narration and the code example agree with the board. */
  input: Record<string, unknown>;
  /** What the algorithm returned, so the lesson can state the answer truthfully. */
  result: unknown;
  /** The answer as a teacher would write it, for the closing caption and the planner. */
  resultText?: string;
  /**
   * The algorithm returned before it reached the end of its input, so the
   * walk-through stops early and the lesson owes the student a word about
   * what would have happened to the values it never looked at.
   */
  earlyExit?: boolean;
  frames: TraceFrame[];
}

/** A simulator never throws: an input it cannot honour returns null. */
export type SimulatorFn<Input> = (input: Input) => AlgorithmTrace | null;

export function cells(values: ReadonlyArray<string | number>): TraceCell[] {
  return values.map((value) => ({ text: String(value) }));
}

/** Apply marks to a row of cells by index, leaving the rest untouched. */
export function marked(
  base: readonly TraceCell[],
  marks: ReadonlyMap<number, TraceMark>,
): TraceCell[] {
  return base.map((cell, index) => {
    const mark = marks.get(index);
    return mark ? { ...cell, mark } : { text: cell.text };
  });
}

/** An aside pre-sized to `capacity`, blank cells drawn as a dot. */
export function aside(
  id: string,
  title: string,
  orientation: "row" | "column",
  values: ReadonlyArray<string | number>,
  capacity: number,
  marks: ReadonlyMap<number, TraceMark> = new Map(),
): TraceAside {
  const filled = values.slice(0, capacity).map((value, index): TraceCell => {
    const mark = marks.get(index);
    return mark ? { text: String(value), mark } : { text: String(value) };
  });
  while (filled.length < capacity) filled.push({ text: "" });
  return { id, title, orientation, cells: filled, capacity };
}

/**
 * A frame's cell count must never change mid-trace for a fixed structure —
 * the gate compares addresses across frames, and a row that grows or shrinks
 * silently would break that comparison rather than fail it.
 */
export function traceStructureOf(trace: AlgorithmTrace): TraceStructure | null {
  const first = trace.frames[0];
  if (!first) return null;
  const kind = first.state.kind;
  return trace.frames.every((frame) => frame.state.kind === kind) ? kind : null;
}
