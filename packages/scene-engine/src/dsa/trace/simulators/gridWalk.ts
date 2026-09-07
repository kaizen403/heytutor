/**
 * Walks over a grid: island counts, flood fills, a multi-source spread, a
 * two-colouring, and the unique-paths table.
 *
 * These are the questions the graph families had to decline. A grid is a
 * graph, but drawing it as a ring of lettered discs throws away the only
 * thing the student is reading about: that a cell's neighbours are the four
 * cells beside it. So the map itself is the figure, `matrix` frames with the
 * map characters still in the cells, and the algorithm's state lives in the
 * marks: `active` is the cell being looked at, `done` a cell already dealt
 * with, `candidate` the frontier waiting its turn. Water and blocked cells
 * carry no mark at all, which is what makes the shape of an island readable
 * as a shape rather than as a table of ones.
 *
 * Two rendering choices are deliberate and worth stating, because the obvious
 * alternative teaches something false.
 *
 * **`path` is the route down, not the order of visits.** A depth-first walk
 * backtracks, so joining consecutive *visits* with arrows draws a long
 * diagonal leap across the map from wherever the walk gave up to wherever it
 * resumed, and no such step exists: the algorithm only ever moves between
 * neighbouring cells. `path` is therefore the chain of parent links from the
 * cell the walk entered this island at down to the cell it is standing on,
 * which is a real route made of real steps, and it shortens when the walk
 * backtracks exactly as the recursion does.
 *
 * **Rotting oranges advances one minute per frame, not one cell.** The answer
 * to that question is a number of minutes, so a frame has to be a minute. A
 * frame per dequeued cell would draw a beautiful breadth-first walk whose
 * final caption states a number the student never saw accumulate.
 *
 * Bipartite is the odd one out and says so: its input is an adjacency list,
 * not a map, so it uses `graph` frames. Its two colours are the two ring
 * styles a mark can draw, `done` for side A and `candidate` for side B, with
 * a `colour` aside spelling out the letter per node, because a ring style is
 * a hint and the letter is the claim.
 */
import {
  aside,
  type AlgorithmTrace,
  type GraphFrameState,
  type MatrixFrameState,
  type TraceAside,
  type TraceCell,
  type TraceEdge,
  type TraceFrame,
  type TraceMark,
  type TraceNode,
} from "../types";

/**
 * A frame per visited cell means the walk length is the frame budget. The
 * gate allows 16; leaving two spare keeps room for the opening frame and a
 * closing verdict without a family having to know the gate's number.
 */
const MAX_FRAMES = 14;

/**
 * Cells one walk may touch. Past this the figure is fine but the lesson is
 * not: nobody watches thirty frames of the same flood. An oversized example
 * declines so the caller falls back to the canonical one, which is the same
 * rule the rest of the catalog follows.
 */
const MAX_VISITS = 12;

const MIN_SIDE = 2;
const MAX_SIDE = 8;

/** Four-directional neighbours in reading order: up, down, left, right. */
const STEPS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function rectangular(rows: ReadonlyArray<ReadonlyArray<string>>): boolean {
  if (rows.length < MIN_SIDE || rows.length > MAX_SIDE) return false;
  const width = rows[0]?.length ?? 0;
  if (width < MIN_SIDE || width > MAX_SIDE) return false;
  // A ragged matrix is a parser bug upstream. Declining is the only honest
  // answer: guessing the missing cells would put values on the board that the
  // question never wrote.
  return rows.every((row) => row.length === width);
}

/** Cells are addressed by a single number so sets and maps stay cheap. */
function keyOf(row: number, column: number, columns: number): number {
  return row * columns + column;
}

function cellOf(key: number, columns: number): [number, number] {
  return [Math.floor(key / columns), key % columns];
}

interface MatrixPaint {
  text: ReadonlyArray<ReadonlyArray<string>>;
  columns: number;
  active: ReadonlySet<number>;
  done: ReadonlySet<number>;
  frontier: ReadonlySet<number>;
  excluded?: ReadonlySet<number>;
}

/**
 * The map with this instant's marks on it. Precedence matters: a cell being
 * looked at right now is `active` even though it is also, by then, visited.
 */
function matrixCells(paint: MatrixPaint): TraceCell[][] {
  return paint.text.map((row, r) =>
    row.map((text, c): TraceCell => {
      const key = keyOf(r, c, paint.columns);
      const mark: TraceMark | undefined = paint.active.has(key)
        ? "active"
        : paint.excluded?.has(key)
          ? "excluded"
          : paint.done.has(key)
            ? "done"
            : paint.frontier.has(key)
              ? "candidate"
              : undefined;
      return mark ? { text, mark } : { text };
    }),
  );
}

/**
 * The chain of parent links from the cell a walk started at down to `at`.
 * See the file header: this is the route, not the visit order.
 */
function routeTo(parents: ReadonlyMap<number, number>, at: number, columns: number): Array<[number, number]> {
  const chain: number[] = [];
  const guard = new Set<number>();
  let cursor: number | undefined = at;
  while (cursor !== undefined && !guard.has(cursor)) {
    guard.add(cursor);
    chain.push(cursor);
    cursor = parents.get(cursor);
  }
  chain.reverse();
  return chain.map((key) => cellOf(key, columns));
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "1 orange rots" but "2 oranges rot": the verb has to agree too. */
function agrees(count: number, verb: string): string {
  return count === 1 ? `${verb}s` : verb;
}

/** "1, 2 and 3" rather than "1 and 2 and 3". */
function listOf(items: ReadonlyArray<string | number>): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// --- Number of Islands (LC 200) --------------------------------------------

export interface GridIslandsInput {
  grid: string[][];
  /** The character that counts as land. LeetCode writes "1". */
  land?: string;
}

/**
 * A depth-first flood of each unvisited land cell, counting components.
 *
 * The count is the answer, so it is in the frame note on every frame rather
 * than only in the closing caption: a student who looks up mid-walk should be
 * able to read how many islands have been finished so far.
 */
export function simulateGridIslands(input: GridIslandsInput): AlgorithmTrace | null {
  const grid = input.grid;
  if (!rectangular(grid)) return null;
  const land = input.land ?? "1";
  const rows = grid.length;
  const columns = grid[0]!.length;
  const isLand = (row: number, column: number) => grid[row]![column] === land;

  const landKeys: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (isLand(row, column)) landKeys.push(keyOf(row, column, columns));
    }
  }
  // No land at all counts zero islands correctly and draws one static
  // picture, which is not a walk-through. Too much land runs past the frame
  // budget. Either way the canonical example is the better lesson.
  if (landKeys.length < 1 || landKeys.length > MAX_VISITS) return null;

  const frames: TraceFrame[] = [];
  const visited = new Set<number>();
  const parents = new Map<number, number>();
  let islands = 0;

  const state = (options: {
    active: number | null;
    frontier: ReadonlySet<number>;
    route: Array<[number, number]>;
  }): MatrixFrameState => ({
    kind: "matrix",
    cells: matrixCells({
      text: grid,
      columns,
      active: new Set(options.active === null ? [] : [options.active]),
      done: visited,
      frontier: options.frontier,
    }),
    showIndices: true,
    ...(options.route.length >= 2 ? { path: options.route } : {}),
    note: `islands = ${islands}`,
  });

  const firstLand = landKeys[0]!;
  const [firstRow, firstColumn] = cellOf(firstLand, columns);
  frames.push({
    id: "scan",
    caption: `Read the map: ${land} is land, everything else water`.slice(0, 60),
    narrationIntent: `Nothing has been visited yet. We read the map in rows from the top left, and the first ${land} we meet is at row ${firstRow} column ${firstColumn}, so that dashed cell is where the first island starts. Every cell of that island has to be found and struck off before the count can go up by one, otherwise the same island would be counted once per cell.`,
    state: state({ active: null, frontier: new Set([firstLand]), route: [] }),
  });

  for (const start of landKeys) {
    if (visited.has(start)) continue;
    islands += 1;
    const stack: number[] = [start];
    const seen = new Set<number>([start]);
    let size = 0;

    while (stack.length > 0) {
      const key = stack.pop()!;
      const [row, column] = cellOf(key, columns);
      visited.add(key);
      size += 1;

      // Pushed in reverse of STEPS so the pops come out in reading order: up,
      // then down, then left, then right. A stack reverses whatever it is
      // handed, and a walk that explored right before up would contradict the
      // order the narration reads the neighbours in.
      for (let step = STEPS.length - 1; step >= 0; step -= 1) {
        const [dr, dc] = STEPS[step]!;
        const nextRow = row + dr;
        const nextColumn = column + dc;
        if (nextRow < 0 || nextColumn < 0 || nextRow >= rows || nextColumn >= columns) continue;
        if (!isLand(nextRow, nextColumn)) continue;
        const nextKey = keyOf(nextRow, nextColumn, columns);
        if (seen.has(nextKey)) continue;
        seen.add(nextKey);
        parents.set(nextKey, key);
        stack.push(nextKey);
      }

      const complete = stack.length === 0;
      const frontier = new Set(stack);
      const route = routeTo(parents, key, columns);
      frames.push({
        id: `walk_${row}_${column}`,
        caption: complete
          ? `Island ${islands} has ${plural(size, "cell")}: ${plural(islands, "island")} so far`.slice(0, 60)
          : size === 1
            ? `New island at row ${row} column ${column}`
            : `Island ${islands} reaches row ${row} column ${column}`,
        narrationIntent: complete
          ? `Row ${row} column ${column} has no unvisited land beside it and nothing is left waiting, so island ${islands} is closed at ${plural(size, "cell")} and the count goes to ${islands}. The walk goes back to reading the map for the next ${land} it has not already struck off.`
          : size === 1
            ? `Row ${row} column ${column} is land nobody has visited, so it opens island ${islands}. We strike it off and put its unvisited land neighbours in a stack; the dashed cells are what is waiting there.`
            : `We take row ${row} column ${column} off the stack and strike it off as part of island ${islands}, which now has ${plural(size, "cell")}. The arrows are the route we came in by, and the dashed cells are the land still waiting on the stack.`,
        state: state({ active: key, frontier, route }),
      });
    }
  }

  // The closing caption has to state the answer, and the local detail of the
  // last island is the wrong thing to leave on the board.
  frames[frames.length - 1]!.caption = `${plural(islands, "island")} in the map`;
  return {
    algorithmId: "grid_islands",
    title: "Number of islands",
    input: { grid, land },
    result: islands,
    resultText: plural(islands, "island"),
    frames,
  };
}

// --- Flood Fill (LC 733) ---------------------------------------------------

export interface FloodFillInput {
  image: string[][];
  startRow: number;
  startColumn: number;
  /** The colour painted on, as it should be drawn in a cell. */
  colour: string;
}

/**
 * A depth-first repaint of the region connected to one pixel.
 *
 * The cells hold the pixel values and are rewritten as they are painted, so
 * the board shows the image changing rather than a mark claiming it changed.
 * That is the difference between watching a flood fill and watching a
 * traversal with the answer written underneath it.
 */
export function simulateFloodFill(input: FloodFillInput): AlgorithmTrace | null {
  const image = input.image;
  if (!rectangular(image)) return null;
  const rows = image.length;
  const columns = image[0]!.length;
  const { startRow, startColumn, colour } = input;
  if (!Number.isInteger(startRow) || !Number.isInteger(startColumn)) return null;
  if (startRow < 0 || startRow >= rows || startColumn < 0 || startColumn >= columns) return null;
  if (colour.length < 1 || colour.length > 2) return null;

  const original = image[startRow]![startColumn]!;
  // Painting a region the colour it already is changes nothing, so there is
  // no walk to draw: one static frame is a picture, not a walk-through.
  if (original === colour) return null;

  const painted: string[][] = image.map((row) => [...row]);
  const filledKeys: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (image[row]![column] === original) filledKeys.push(keyOf(row, column, columns));
    }
  }
  if (filledKeys.length > MAX_VISITS) return null;

  const frames: TraceFrame[] = [];
  const filled = new Set<number>();
  const parents = new Map<number, number>();
  const startKey = keyOf(startRow, startColumn, columns);

  const state = (options: {
    active: number | null;
    frontier: ReadonlySet<number>;
    route: Array<[number, number]>;
  }): MatrixFrameState => ({
    kind: "matrix",
    cells: matrixCells({
      text: painted.map((row) => [...row]),
      columns,
      active: new Set(options.active === null ? [] : [options.active]),
      done: filled,
      frontier: options.frontier,
    }),
    showIndices: true,
    ...(options.route.length >= 2 ? { path: options.route } : {}),
    note: `${original} becomes ${colour}`,
  });

  frames.push({
    id: "start",
    caption: `Start at row ${startRow} column ${startColumn}, colour ${original}`.slice(0, 60),
    narrationIntent: `The starting pixel holds ${original}, and that value is what the fill spreads through: every pixel reachable from here through pixels also holding ${original} turns into ${colour}. Pixels holding anything else are walls, and the fill stops at them. Note that we read the starting colour once, before anything is painted, because overwriting it first would leave nothing to compare against.`,
    state: state({ active: null, frontier: new Set([startKey]), route: [] }),
  });

  const stack: number[] = [startKey];
  const seen = new Set<number>([startKey]);
  while (stack.length > 0) {
    const key = stack.pop()!;
    const [row, column] = cellOf(key, columns);
    painted[row]![column] = colour;
    filled.add(key);

    for (let step = STEPS.length - 1; step >= 0; step -= 1) {
      const [dr, dc] = STEPS[step]!;
      const nextRow = row + dr;
      const nextColumn = column + dc;
      if (nextRow < 0 || nextColumn < 0 || nextRow >= rows || nextColumn >= columns) continue;
      if (image[nextRow]![nextColumn] !== original) continue;
      const nextKey = keyOf(nextRow, nextColumn, columns);
      if (seen.has(nextKey)) continue;
      seen.add(nextKey);
      parents.set(nextKey, key);
      stack.push(nextKey);
    }

    const frontier = new Set(stack);
    frames.push({
      id: `fill_${row}_${column}`,
      caption: `Row ${row} column ${column} turns ${original} into ${colour}`.slice(0, 60),
      narrationIntent: `Row ${row} column ${column} held ${original}, so it is repainted ${colour}. Then its four neighbours are checked and any that still hold ${original} go on the stack, which is what the dashed cells are. ${
        frontier.size === 0
          ? "Nothing is left waiting, so the fill is finished."
          : `${plural(frontier.size, "pixel")} still waiting.`
      }`,
      state: state({ active: key, frontier, route: routeTo(parents, key, columns) }),
    });
  }

  const count = filled.size;
  frames[frames.length - 1]!.caption = `${plural(count, "pixel")} now hold ${colour}`;
  return {
    algorithmId: "grid_dfs_fill",
    title: "Flood fill",
    input: { image, sr: startRow, sc: startColumn, color: colour },
    result: painted.map((row) => [...row]),
    resultText: `${plural(count, "pixel")} become ${colour}`,
    frames,
  };
}

// --- Rotting Oranges (LC 994) ----------------------------------------------

export interface OrangeGridInput {
  grid: string[][];
}

const EMPTY_CELL = "0";
const FRESH_ORANGE = "1";
const ROTTEN_ORANGE = "2";

/** The widest the queue may get before the aside stops fitting beside a map. */
const MAX_QUEUE = 6;

/**
 * Multi-source breadth-first search, one frame per minute.
 *
 * Every rotten orange is already in the queue at minute zero, which is the
 * whole trick: one search from many starts at once gives every fresh orange
 * its distance to the *nearest* rotten one, and the answer is the largest of
 * those. Seeding the queue with one source and looping over the others would
 * give the same number here and the wrong number on a grid where two rots
 * race, so the opening frame shows the queue already holding all of them.
 */
export function simulateRottingOranges(input: OrangeGridInput): AlgorithmTrace | null {
  const grid = input.grid;
  if (!rectangular(grid)) return null;
  const rows = grid.length;
  const columns = grid[0]!.length;

  const sources: number[] = [];
  let freshTotal = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const value = grid[row]![column]!;
      if (value === ROTTEN_ORANGE) sources.push(keyOf(row, column, columns));
      else if (value === FRESH_ORANGE) freshTotal += 1;
      else if (value !== EMPTY_CELL) return null;
    }
  }

  // Layer i is the set of oranges that rot at minute i + 1. Computing the
  // whole spread first is what lets the queue aside be pre-sized: its
  // capacity may not change mid-trace, and it cannot be known frame by frame.
  const layers: number[][] = [];
  const rotten = new Set(sources);
  let wave = sources;
  while (wave.length > 0) {
    const next: number[] = [];
    for (const key of wave) {
      const [row, column] = cellOf(key, columns);
      for (const [dr, dc] of STEPS) {
        const nextRow = row + dr;
        const nextColumn = column + dc;
        if (nextRow < 0 || nextColumn < 0 || nextRow >= rows || nextColumn >= columns) continue;
        if (grid[nextRow]![nextColumn] !== FRESH_ORANGE) continue;
        const nextKey = keyOf(nextRow, nextColumn, columns);
        if (rotten.has(nextKey)) continue;
        rotten.add(nextKey);
        next.push(nextKey);
      }
    }
    if (next.length > 0) layers.push(next);
    wave = next;
  }

  const spread = layers.reduce((total, layer) => total + layer.length, 0);
  const stranded = freshTotal - spread;
  const minutes = stranded > 0 ? -1 : layers.length;
  const needsVerdict = stranded > 0 || freshTotal === 0;
  if (1 + layers.length + (needsVerdict ? 1 : 0) > MAX_FRAMES) return null;

  const capacity = Math.max(1, sources.length, ...layers.map((layer) => layer.length));
  if (capacity > MAX_QUEUE) return null;

  const label = (key: number) => {
    const [row, column] = cellOf(key, columns);
    return `${row},${column}`;
  };
  const queueAside = (contents: readonly number[]): TraceAside[] => [
    aside("queue", "queue", "row", contents.map(label), capacity),
  ];

  const text = grid.map((row) => [...row]);
  const frames: TraceFrame[] = [];
  const settled = new Set<number>();

  frames.push({
    id: "minute0",
    caption: `Minute 0: ${plural(sources.length, "rotten orange")} to start`.slice(0, 60),
    narrationIntent: `Minute zero. Every orange that is already rotten goes into the queue at once, not one at a time, because they all start spreading in the same minute. There ${freshTotal === 1 ? "is 1 fresh orange" : `are ${freshTotal} fresh oranges`} and the dashed cells are the ones touching a rotten neighbour, so those are the ones that go first.`,
    state: {
      kind: "matrix",
      cells: matrixCells({
        text,
        columns,
        active: new Set(sources),
        done: new Set(),
        frontier: new Set(layers[0] ?? []),
      }),
      showIndices: true,
      note: "minute 0",
      asides: queueAside(sources),
    },
  });
  for (const key of sources) settled.add(key);

  layers.forEach((layer, index) => {
    const minute = index + 1;
    for (const key of layer) {
      const [row, column] = cellOf(key, columns);
      text[row]![column] = ROTTEN_ORANGE;
    }
    const before = new Set(settled);
    for (const key of layer) settled.add(key);
    const left = freshTotal - layers.slice(0, minute).reduce((total, l) => total + l.length, 0);
    frames.push({
      id: `minute${minute}`,
      caption: `Minute ${minute}: ${plural(layer.length, "orange")} ${agrees(layer.length, "rot")}, ${left} fresh left`.slice(0, 60),
      narrationIntent: `Minute ${minute}. Everything that came out of the queue rots its fresh neighbours, so ${listOf(
        layer.map((key) => `row ${cellOf(key, columns)[0]} column ${cellOf(key, columns)[1]}`),
      )} ${agrees(layer.length, "turn")} rotten and ${agrees(layer.length, "go")} into the queue for the next minute. That leaves ${left === 0 ? "nothing fresh" : plural(left, "fresh orange")}.`,
      state: {
        kind: "matrix",
        cells: matrixCells({
          text,
          columns,
          active: new Set(layer),
          done: before,
          frontier: new Set(layers[minute] ?? []),
        }),
        showIndices: true,
        note: `minute ${minute}`,
        asides: queueAside(layer),
      },
    });
  });

  if (needsVerdict) {
    const strandedKeys: number[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const key = keyOf(row, column, columns);
        if (grid[row]![column] === FRESH_ORANGE && !rotten.has(key)) strandedKeys.push(key);
      }
    }
    frames.push({
      id: "verdict",
      caption:
        stranded > 0
          ? `${plural(stranded, "orange")} never ${agrees(stranded, "rot")}, so -1`.slice(0, 60)
          : "No orange was fresh, so 0 minutes",
      narrationIntent:
        stranded > 0
          ? `The queue is empty and ${
              stranded === 1 ? "one orange is" : `${stranded} oranges are`
            } still fresh, struck through here. Nothing rotten can ever reach ${
              stranded === 1 ? "it" : "them"
            }, because rot only travels through the four sides of a cell, so the answer is minus one rather than a number of minutes.`
          : `There was never a fresh orange on this grid, so the condition the question asks about, that no cell holds a fresh orange, is already true before any minute passes. The answer is zero, and this is the case that a loop counting minutes has to be careful not to report as one.`,
      state: {
        kind: "matrix",
        cells: matrixCells({
          text,
          columns,
          active: new Set(),
          done: settled,
          frontier: new Set(),
          excluded: new Set(strandedKeys),
        }),
        showIndices: true,
        note: stranded > 0 ? "answer = -1" : "answer = 0",
        asides: queueAside([]),
      },
    });
  } else {
    frames[frames.length - 1]!.caption = `${plural(minutes, "minute")} until none are fresh`;
  }

  return {
    algorithmId: "grid_bfs_multi_source",
    title: "Rotting oranges",
    input: { grid },
    result: minutes,
    resultText:
      stranded > 0
        ? `-1: ${plural(stranded, "orange")} never ${agrees(stranded, "rot")}`
        : plural(minutes, "minute"),
    frames,
  };
}

// --- Is Graph Bipartite (LC 785) -------------------------------------------

export interface AdjacencyListInput {
  /** `adjacency[u]` is the list of nodes u is joined to, as LeetCode writes it. */
  adjacency: number[][];
}

const SIDE_A = "A";
const SIDE_B = "B";

/**
 * Two-colouring an adjacency list, breadth first.
 *
 * The input here is a node list, not a map, so this is a `graph` frame and
 * not a `matrix` one. The two sides are carried twice on purpose: as the two
 * ring styles a mark can draw, `done` for A and `candidate` for B, and as a
 * letter per node in the `colour` aside. The rings make the partition
 * readable at a glance and the letters make it checkable, and a ring style on
 * its own would be asking the student to remember which dash means which set.
 */
export function simulateBipartite(input: AdjacencyListInput): AlgorithmTrace | null {
  const adjacency = input.adjacency;
  const count = adjacency.length;
  if (count < 2 || count > 8) return null;

  const edges: TraceEdge[] = [];
  for (let node = 0; node < count; node += 1) {
    const list = adjacency[node];
    if (!Array.isArray(list)) return null;
    for (const other of list) {
      if (!Number.isInteger(other) || other < 0 || other >= count || other === node) return null;
      if (other > node) edges.push({ from: String(node), to: String(other) });
    }
  }
  if (edges.length < 1 || edges.length > 14) return null;

  const colour = new Array<number>(count).fill(-1);
  const frames: TraceFrame[] = [];
  let clash: [number, number] | null = null;

  const letters = () => colour.map((side) => (side === -1 ? "" : side === 0 ? SIDE_A : SIDE_B));
  const nodesNow = (excluded: ReadonlySet<number>): TraceNode[] =>
    Array.from({ length: count }, (_, node) => ({
      id: String(node),
      label: String(node),
      ...(excluded.has(node)
        ? { mark: "excluded" as const }
        : colour[node] === 0
          ? { mark: "done" as const }
          : colour[node] === 1
            ? { mark: "candidate" as const }
            : {}),
    }));
  const edgesNow = (looking: number | null, broken: [number, number] | null): TraceEdge[] =>
    edges.map((edge) => {
      const from = Number(edge.from);
      const to = Number(edge.to);
      if (broken && ((from === broken[0] && to === broken[1]) || (from === broken[1] && to === broken[0]))) {
        return { ...edge, mark: "excluded" as const };
      }
      // The node being expanded is already carrying its colour ring, so the
      // "we are here" signal goes on its edges instead of overwriting it.
      if (looking !== null && (from === looking || to === looking)) return { ...edge, mark: "active" as const };
      return edge;
    });
  const state = (options: {
    looking: number | null;
    broken: [number, number] | null;
    excluded: ReadonlySet<number>;
    changed: ReadonlySet<number>;
  }): GraphFrameState => ({
    kind: "graph",
    nodes: nodesNow(options.excluded),
    edges: edgesNow(options.looking, options.broken),
    asides: [
      aside(
        "colour",
        "colour",
        "row",
        letters(),
        count,
        new Map(
          [...options.changed].map((node) => [node, options.excluded.has(node) ? ("excluded" as const) : ("active" as const)]),
        ),
      ),
    ],
  });

  for (let seed = 0; seed < count && !clash; seed += 1) {
    if (colour[seed] !== -1) continue;
    colour[seed] = 0;
    frames.push({
      id: `seed_${seed}`,
      caption: `Node ${seed} takes side ${SIDE_A}`,
      narrationIntent: `Node ${seed} has no colour yet and nothing forces which side it belongs to, so we simply put it on side ${SIDE_A}. Bipartite asks whether a split exists at all, not which node lands where, so fixing one node costs nothing and everything reachable from it is then forced.`,
      state: state({ looking: null, broken: null, excluded: new Set(), changed: new Set([seed]) }),
    });

    const queue = [seed];
    while (queue.length > 0 && !clash && frames.length < MAX_FRAMES) {
      const node = queue.shift()!;
      const mine = colour[node]!;
      const painted: number[] = [];
      for (const other of adjacency[node]!) {
        if (colour[other] === -1) {
          colour[other] = 1 - mine;
          queue.push(other);
          painted.push(other);
          continue;
        }
        if (colour[other] === mine) {
          clash = [node, other];
          break;
        }
      }
      const side = mine === 0 ? SIDE_A : SIDE_B;
      const opposite = mine === 0 ? SIDE_B : SIDE_A;
      if (clash) {
        const [left, right] = clash;
        frames.push({
          id: `clash_${left}_${right}`,
          caption: `Nodes ${left} and ${right} are both ${side}: not bipartite`.slice(0, 60),
          narrationIntent: `Node ${left} is on side ${side}, and so is node ${right}, but there is an edge between them. That edge would have to join the two sides and it joins one side to itself, so no split works. The moment a colouring contradicts itself the answer is settled and there is nothing left to check.`,
          state: state({
            looking: null,
            broken: clash,
            excluded: new Set(clash),
            changed: new Set(clash),
          }),
        });
        break;
      }
      frames.push({
        id: `see_${node}`,
        caption: painted.length
          ? `Node ${node} is ${side}, so ${painted.join(", ")} must be ${opposite}`.slice(0, 60)
          : `Node ${node} is ${side} and every neighbour already fits`.slice(0, 60),
        narrationIntent: painted.length
          ? `Node ${node} sits on side ${side}, so every node it is joined to has to sit on side ${opposite}: that is what an edge means here. ${
              painted.length === 1 ? `Node ${painted[0]} takes` : `Nodes ${listOf(painted)} take`
            } side ${opposite} and ${agrees(painted.length, "join")} the queue.`
          : `Node ${node} sits on side ${side} and every neighbour it has already carries a colour, all of them on side ${opposite}. Nothing contradicts, nothing new is coloured, so the queue simply gets shorter.`,
        state: state({ looking: node, broken: null, excluded: new Set(), changed: new Set() }),
      });
    }
  }

  if (frames.length < 2 || frames.length > MAX_FRAMES) return null;
  const bipartite = clash === null;
  if (bipartite) {
    frames[frames.length - 1]!.caption = `Every edge joins ${SIDE_A} to ${SIDE_B}: bipartite`;
  }
  return {
    algorithmId: "grid_bipartite",
    title: "Is the graph bipartite",
    input: { graph: adjacency },
    result: bipartite,
    resultText: bipartite ? "bipartite" : "not bipartite",
    frames,
  };
}

// --- Unique Paths (LC 62) --------------------------------------------------

export interface GridPathsInput {
  /** Rows, LeetCode's `m`. */
  rows: number;
  /** Columns, LeetCode's `n`. */
  columns: number;
}

const MAX_PATH_SIDE = 5;

/**
 * The unique-paths table, one cell per frame.
 *
 * This is a `grid` frame rather than a `matrix` one because the row and
 * column indices are headers the arithmetic refers to, and a `grid` keeps
 * them out of `cells` where a header digit could be mistaken for a count.
 * Each interior cell is written from exactly two reads, the cell above and
 * the cell to the left, which is the whole rule: the robot arrives here
 * either by stepping down or by stepping right, and nothing else.
 */
export function simulateUniquePaths(input: GridPathsInput): AlgorithmTrace | null {
  const { rows, columns } = input;
  if (!Number.isInteger(rows) || !Number.isInteger(columns)) return null;
  // A single row or column has exactly one path and fills no interior cell,
  // so there is no rule to watch being applied.
  if (rows < 2 || rows > MAX_PATH_SIDE || columns < 2 || columns > MAX_PATH_SIDE) return null;
  if (1 + (rows - 1) * (columns - 1) > MAX_FRAMES) return null;

  const labels = (count: number) => Array.from({ length: count }, (_, index) => String(index));
  const rowLabels = labels(rows);
  const colLabels = labels(columns);
  const table: number[][] = Array.from({ length: rows }, () => Array.from({ length: columns }, () => 0));
  for (let row = 0; row < rows; row += 1) table[row]![0] = 1;
  for (let column = 0; column < columns; column += 1) table[0]![column] = 1;

  const cellsNow = (written: number, active: [number, number] | null): TraceCell[][] =>
    table.map((row, r) =>
      row.map((value, c): TraceCell => {
        const isBase = r === 0 || c === 0;
        const order = (r - 1) * (columns - 1) + (c - 1);
        if (!isBase && order >= written) return { text: "" };
        const text = String(value);
        if (active && active[0] === r && active[1] === c) return { text, mark: "active" };
        return isBase ? { text, mark: "done" } : { text };
      }),
    );

  const note = `${rows} by ${columns} grid`;
  const frames: TraceFrame[] = [
    {
      id: "base",
      caption: "One way along the top row and the left column",
      narrationIntent: `The robot only moves down or right, so along the top row it can never have stepped down and along the left column it can never have stepped right. There is exactly one way to reach any of those cells, which is why the whole first row and first column are ones. Everything else is built from cells that are already filled.`,
      state: { kind: "grid", rowLabels, colLabels, cells: cellsNow(0, null), note },
    },
  ];

  let written = 0;
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const above = table[row - 1]![column]!;
      const left = table[row]![column - 1]!;
      table[row]![column] = above + left;
      written += 1;
      frames.push({
        id: `fill_${row}_${column}`,
        caption: `Row ${row} column ${column}: ${above} + ${left} = ${above + left}`,
        narrationIntent: `To stand on row ${row} column ${column} the robot's last move was either down from row ${
          row - 1
        } column ${column} or right from row ${row} column ${
          column - 1
        }. Those two are the cells the arrows come from, they are already worked out, and no path is counted twice because a path's last move is one or the other. So this cell is ${above} plus ${left}, which is ${
          above + left
        }.`,
        state: {
          kind: "grid",
          rowLabels,
          colLabels,
          cells: cellsNow(written, [row, column]),
          write: [row, column],
          reads: [
            [row - 1, column],
            [row, column - 1],
          ],
          note,
        },
      });
    }
  }

  const answer = table[rows - 1]![columns - 1]!;
  frames[frames.length - 1]!.caption = `${plural(answer, "path")} to the bottom right corner`;
  return {
    algorithmId: "dp_grid_paths",
    title: "Unique paths",
    input: { m: rows, n: columns },
    result: answer,
    resultText: plural(answer, "path"),
    frames,
  };
}
