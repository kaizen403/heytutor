/**
 * Outline pass of the reference picture stroke plan: the grid path of
 * geeklee/srt-whiteboard-animation (`stream_render.py` 117..581, spec 2a).
 *
 * The ink mask is cut into square cells; every cell holding ink is visited
 * once, so the pencil traces the picture's line work cell by cell. Big shapes
 * are walked along their own direction (gradient walk), text lines are
 * written in narrow column strips left to right (text scan), and groups are
 * chained nearest tail to nearest head. A jump longer than one cell lifts
 * the pen, which splits the path into polylines of cell centres.
 */

import { labelComponents, simplifyPolyline } from "./strokePlanImage";

/** Cell edge in plan px: SR uses 10 at a 1080 px long edge; 8 keeps that ratio at 760. */
export const OUTLINE_CELL_EDGE = 8;
/** Grid paths only hold lattice points, so this drops exactly collinear runs and nothing else. */
const OUTLINE_SIMPLIFY_EPSILON = 1;

/** Brush width that covers a whole cell from its centre: radius ceil(0.71 * edge). */
export function outlineBrushPx(edge = OUTLINE_CELL_EDGE): number {
  return 2 * Math.ceil(0.71 * edge) + 1;
}

interface Group {
  cells: number[];
  minR: number;
  minC: number;
  maxR: number;
  maxC: number;
  /** 0 subject, 1 text, 2 contour. */
  rank: number;
}

function bounds(cells: readonly number[], cols: number): { minR: number; minC: number; maxR: number; maxC: number } {
  let minR = Infinity;
  let minC = Infinity;
  let maxR = -Infinity;
  let maxC = -Infinity;
  for (const idx of cells) {
    const r = Math.floor(idx / cols);
    const c = idx - r * cols;
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }
  return { minR, minC, maxR, maxC };
}

/**
 * Split a component at its widest thin column valley (SR 196..250): a label
 * joined to the subject by a leader line becomes its own group, so it is
 * written as text instead of being wandered through as part of a shape.
 */
function splitBridge(cells: number[], cols: number): number[][] {
  if (cells.length < 40) return [cells];
  const b = bounds(cells, cols);
  const bw = b.maxC - b.minC + 1;
  const bh = b.maxR - b.minR + 1;
  if (bw < 16 || bh < 10) return [cells];
  const colCount = new Int32Array(bw);
  for (const idx of cells) colCount[(idx % cols) - b.minC]!++;
  const thin = Math.max(3, Math.ceil(0.3 * bh));
  let best: { start: number; end: number } | null = null;
  for (let c = 0; c < bw; ) {
    if (colCount[c]! > thin) {
      c++;
      continue;
    }
    let end = c;
    while (end + 1 < bw && colCount[end + 1]! <= thin) end++;
    if (end - c + 1 >= 2 && c > 4 && end < bw - 1 - 4 && (!best || end - c > best.end - best.start)) best = { start: c, end };
    c = end + 1;
  }
  if (!best) return [cells];
  const cut = b.minC + Math.floor((best.start + best.end) / 2);
  const left = cells.filter((idx) => idx % cols <= cut);
  const right = cells.filter((idx) => idx % cols > cut);
  if (left.length < 20 || right.length < 20) return [cells];
  return [...splitBridge(left, cols), ...splitBridge(right, cols)];
}

/** Walk one shape: seed at its densest cell, follow unvisited neighbours, lift to the nearest when stuck (SR 352..428). */
function gradientWalk(cells: readonly number[], member: Int32Array, stamp: number, visited: Uint8Array, cols: number, rows: number): number[] {
  const inGroup = (r: number, c: number) => r >= 0 && r < rows && c >= 0 && c < cols && member[r * cols + c] === stamp;
  let seed = cells[0]!;
  let seedCount = -1;
  for (const idx of cells) {
    const r = Math.floor(idx / cols);
    const c = idx - r * cols;
    let n = 0;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) if (inGroup(r + dr, c + dc)) n++;
    if (n > seedCount || (n === seedCount && idx < seed)) {
      seedCount = n;
      seed = idx;
    }
  }
  const freeNeighbours = (r: number, c: number) => {
    let n = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if ((dr || dc) && inGroup(r + dr, c + dc) && !visited[(r + dr) * cols + c + dc]) n++;
      }
    }
    return n;
  };
  const path = [seed];
  visited[seed] = 1;
  let cur = seed;
  let pdr = 0;
  let pdc = 0;
  for (let remaining = cells.length - 1; remaining > 0; remaining--) {
    const cr = Math.floor(cur / cols);
    const cc = cur - cr * cols;
    let next = -1;
    let bestFree = 0;
    let bestTurn = 0;
    let ndr = 0;
    let ndc = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!(dr || dc) || !inGroup(cr + dr, cc + dc)) continue;
        const idx = (cr + dr) * cols + cc + dc;
        if (visited[idx]) continue;
        const free = freeNeighbours(cr + dr, cc + dc);
        const turn = (dr - pdr) ** 2 + (dc - pdc) ** 2;
        // argmin (-free, turn, row, col); idx order is (row, col) order.
        if (next < 0 || free > bestFree || (free === bestFree && (turn < bestTurn || (turn === bestTurn && idx < next)))) {
          next = idx;
          bestFree = free;
          bestTurn = turn;
          ndr = dr;
          ndc = dc;
        }
      }
    }
    if (next < 0) {
      let bestD = Infinity;
      for (const idx of cells) {
        if (visited[idx]) continue;
        const r = Math.floor(idx / cols);
        const d = (r - cr) ** 2 + (idx - r * cols - cc) ** 2;
        if (d < bestD || (d === bestD && idx < next)) {
          bestD = d;
          next = idx;
        }
      }
      ndr = 0;
      ndc = 0;
    }
    visited[next] = 1;
    path.push(next);
    cur = next;
    pdr = ndr;
    pdc = ndc;
  }
  return path;
}

/** Write a text line in strips four cells wide, left to right, nearest neighbour inside a strip (SR 453..489). */
function textScan(cells: readonly number[], cols: number): number[] {
  const minC = Math.min(...cells.map((idx) => idx % cols));
  const buckets = new Map<number, number[]>();
  for (const idx of cells) {
    const key = Math.floor((idx % cols - minC) / 4);
    const list = buckets.get(key);
    if (list) list.push(idx);
    else buckets.set(key, [idx]);
  }
  const path: number[] = [];
  let tail = -1;
  for (const key of [...buckets.keys()].sort((a, b) => a - b)) {
    const pending = buckets.get(key)!.slice().sort((a, b) => a - b);
    while (pending.length > 0) {
      let pick = 0;
      if (tail >= 0) {
        const tr = Math.floor(tail / cols);
        const tc = tail - tr * cols;
        let bestD = Infinity;
        for (let i = 0; i < pending.length; i++) {
          const r = Math.floor(pending[i]! / cols);
          const d = (r - tr) ** 2 + (pending[i]! - r * cols - tc) ** 2;
          if (d < bestD) {
            bestD = d;
            pick = i;
          }
        }
      }
      tail = pending.splice(pick, 1)[0]!;
      path.push(tail);
    }
  }
  return path;
}

interface Chain {
  cells: number[];
  /** A path holding text keeps its left to right writing order. */
  reversible: boolean;
}

function cellDistance2(a: number, b: number, cols: number): number {
  const ar = Math.floor(a / cols);
  const br = Math.floor(b / cols);
  return (ar - br) ** 2 + (a - ar * cols - (b - br * cols)) ** 2;
}

/** First chain in the given order, then repeatedly the chain whose head (or tail, reversed) is nearest the current tail (SR 501..576). */
function chainNearest(chains: Chain[], cols: number): Chain {
  if (chains.length === 0) return { cells: [], reversible: true };
  const remaining = chains.slice(1);
  const cells = chains[0]!.cells.slice();
  let reversible = chains[0]!.reversible;
  while (remaining.length > 0) {
    const tail = cells[cells.length - 1]!;
    let pick = 0;
    let flip = false;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const chain = remaining[i]!;
      const dHead = cellDistance2(tail, chain.cells[0]!, cols);
      if (dHead < bestD) {
        bestD = dHead;
        pick = i;
        flip = false;
      }
      if (chain.reversible) {
        const dTail = cellDistance2(tail, chain.cells[chain.cells.length - 1]!, cols);
        if (dTail < bestD) {
          bestD = dTail;
          pick = i;
          flip = true;
        }
      }
    }
    const chain = remaining.splice(pick, 1)[0]!;
    cells.push(...(flip ? chain.cells.slice().reverse() : chain.cells));
    reversible &&= chain.reversible;
  }
  return { cells, reversible };
}

/** Grid path of cells in visiting order (cell index = row * cols + col). */
export function gridPathCells(active: Uint8Array, cols: number, rows: number): number[] {
  const comps = labelComponents(active, cols, rows, true);
  const byLabel: number[][] = Array.from({ length: comps.count + 1 }, () => []);
  for (let i = 0; i < active.length; i++) if (comps.labels[i]) byLabel[comps.labels[i]!]!.push(i);
  let parts = byLabel.slice(1).flatMap((cells) => splitBridge(cells, cols));
  const totalCells = parts.reduce((sum, cells) => sum + cells.length, 0);
  if (totalCells === 0) return [];

  // Specks join the big component with the nearest centroid (SR 152..187).
  const small = Math.max(3, Math.floor(0.005 * totalCells));
  const centroid = (cells: readonly number[]) => {
    let sr = 0;
    let sc = 0;
    for (const idx of cells) {
      const r = Math.floor(idx / cols);
      sr += r;
      sc += idx - r * cols;
    }
    return [sr / cells.length, sc / cells.length] as const;
  };
  const big = parts.filter((cells) => cells.length > small);
  if (big.length > 0 && big.length < parts.length) {
    const centres = big.map(centroid);
    for (const cells of parts) {
      if (cells.length > small) continue;
      const [r, c] = centroid(cells);
      let pick = 0;
      let bestD = Infinity;
      centres.forEach(([br, bc], i) => {
        const d = (br - r) ** 2 + (bc - c) ** 2;
        if (d < bestD) {
          bestD = d;
          pick = i;
        }
      });
      big[pick]!.push(...cells);
    }
    parts = big;
  }

  // Rank: the largest part is the subject, wide dense parts are text, the rest contours (SR 333..349).
  let largest = 0;
  parts.forEach((cells, i) => {
    if (cells.length > parts[largest]!.length) largest = i;
  });
  const groups: Group[] = parts.map((cells, i) => {
    const b = bounds(cells, cols);
    const w = b.maxC - b.minC + 1;
    const h = b.maxR - b.minR + 1;
    const rank = i === largest ? 0 : h >= 2 && w / h >= 2.2 && cells.length / (w * h) >= 0.5 ? 1 : 2;
    return { cells: cells.slice().sort((a, b2) => a - b2), ...b, rank };
  });
  groups.sort((a, b) => a.rank - b.rank || a.minR - b.minR || a.minC - b.minC);

  // Regions: groups whose cell boxes come within two cells of each other (SR 263..308).
  const parent = groups.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i]!;
      const b = groups[j]!;
      if (a.minC - 2 <= b.maxC && b.minC - 2 <= a.maxC && a.minR - 2 <= b.maxR && b.minR - 2 <= a.maxR) parent[find(j)] = find(i);
    }
  }

  const member = new Int32Array(cols * rows).fill(-1);
  const visited = new Uint8Array(cols * rows);
  const paths: Chain[] = groups.map((group, i) => {
    for (const idx of group.cells) member[idx] = i;
    return group.rank === 1 ? { cells: textScan(group.cells, cols), reversible: false } : { cells: gradientWalk(group.cells, member, i, visited, cols, rows), reversible: true };
  });

  // Regions keep the order of their first group; inside and across them, chain by nearest end.
  const regionOrder: number[] = [];
  const regionChains = new Map<number, Chain[]>();
  groups.forEach((_, i) => {
    const root = find(i);
    if (!regionChains.has(root)) {
      regionChains.set(root, []);
      regionOrder.push(root);
    }
    regionChains.get(root)!.push(paths[i]!);
  });
  return chainNearest(regionOrder.map((root) => chainNearest(regionChains.get(root)!, cols)), cols).cells;
}

/**
 * Outline strokes from the ink mask: polylines of cell centres in plan px,
 * split at pen lifts, collinear points dropped. A lone cell becomes a one
 * pixel dash so every stroke has a direction.
 */
export function planOutlineStrokes(ink: Uint8Array, width: number, height: number, edge = OUTLINE_CELL_EDGE): number[][] {
  const cols = Math.ceil(width / edge);
  const rows = Math.ceil(height / edge);
  const active = new Uint8Array(cols * rows);
  for (let y = 0; y < height; y++) {
    const r = Math.floor(y / edge);
    for (let x = 0; x < width; x++) if (ink[y * width + x]) active[r * cols + Math.floor(x / edge)] = 1;
  }
  const order = gridPathCells(active, cols, rows);
  const centre = (idx: number): [number, number] => {
    const r = Math.floor(idx / cols);
    const c = idx - r * cols;
    return [Math.min(width - 1, c * edge + edge / 2), Math.min(height - 1, r * edge + edge / 2)];
  };
  const strokes: number[][] = [];
  let current: number[] = [];
  const flush = () => {
    if (current.length === 2) current.push(current[0]! + (current[0]! + 1 <= width ? 1 : -1), current[1]!);
    if (current.length >= 4) strokes.push(simplifyPolyline(current, OUTLINE_SIMPLIFY_EPSILON));
    current = [];
  };
  for (let i = 0; i < order.length; i++) {
    if (i > 0 && cellDistance2(order[i - 1]!, order[i]!, cols) > 2) flush();
    current.push(...centre(order[i]!));
  }
  flush();
  return strokes;
}

/**
 * Hold the outline under `cap` strokes by joining consecutive strokes across
 * the shortest pen lifts first: the pencil stays down for those hops, which
 * only reveals ink a few frames early.
 */
export function capStrokes(strokes: number[][], cap: number): number[][] {
  if (strokes.length <= cap) return strokes;
  const gaps = strokes.slice(1).map((stroke, i) => {
    const prev = strokes[i]!;
    return { i, d: Math.hypot(stroke[0]! - prev[prev.length - 2]!, stroke[1]! - prev[prev.length - 1]!) };
  });
  gaps.sort((a, b) => a.d - b.d || a.i - b.i);
  const join = new Uint8Array(strokes.length);
  for (const gap of gaps.slice(0, strokes.length - cap)) join[gap.i + 1] = 1;
  const out: number[][] = [];
  strokes.forEach((stroke, i) => {
    if (join[i] && out.length > 0) out[out.length - 1]!.push(...stroke);
    else out.push(stroke.slice());
  });
  return out;
}
