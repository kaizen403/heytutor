/**
 * Fill pass of the reference picture stroke plan: the lane sweeps of
 * letuandat131/whiteboard-animation-vi (`v181d_subject_fill.py`, spec 3b to
 * 3d), without colour groups in v1.
 *
 * Each connected region of the fill target is cut into lanes `bw` wide,
 * tilted 12 degrees off vertical; each lane becomes one or more straight
 * sweeps. A sweep runs along its lane's centre from the lane's first pixel to
 * its last, so a brush `bw` wide covers every target pixel by construction.
 * Sweeps are routed as a lane serpentine (down one lane, up the next), or
 * greedily nearest end first and compacted by a bounded 2-opt when that saves
 * a lot of pen travel.
 */

import { labelComponents } from "./strokePlanImage";

const TILT_RAD = (12 * Math.PI) / 180;
const COS = Math.cos(TILT_RAD);
const SIN = Math.sin(TILT_RAD);
/** Lanes are this much narrower than the brush so integer rounding never opens a seam. */
const LANE_SLACK_PX = 2;
/** Regions with less target than this share one pooled group, swept last. */
const POOL_AREA_FACTOR = 0.25;
const UPHILL_PENALTY = 0.08;
const TWO_OPT_WINDOW = 25;
const TWO_OPT_PASSES = 12;
/** The serpentine is kept while its pen travel stays within this factor of the greedy route's. */
const SERPENTINE_TRAVEL_SLACK = 1.25;

export function fillBrushPx(width: number, height: number): number {
  return Math.round(Math.min(56, Math.max(20, 0.08 * Math.min(width, height))));
}

interface Span {
  uMin: number;
  uMax: number;
  v0: number;
  v1: number;
  /** Lane index inside its group. */
  lane: number;
}

interface Sweep {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Lane index inside its group. */
  lane: number;
  /** Position along the lane (v of the sweep's top end), to order sweeps that share a lane. */
  v: number;
}

const toXY = (u: number, v: number): [number, number] => [Math.round(u * COS - v * SIN), Math.round(u * SIN + v * COS)];

/** Lane spans of one group's pixels (pixel indices into a `width` wide raster). */
function laneSpans(pixels: Int32Array, from: number, to: number, width: number, bw: number): Span[] {
  const laneW = Math.max(4, bw - LANE_SLACK_PX);
  let uLo = Infinity;
  let vLo = Infinity;
  let vHi = -Infinity;
  for (let k = from; k < to; k++) {
    const p = pixels[k]!;
    const x = (p % width) + 0.5;
    const y = Math.floor(p / width) + 0.5;
    const u = x * COS + y * SIN;
    const v = -x * SIN + y * COS;
    if (u < uLo) uLo = u;
    if (v < vLo) vLo = v;
    if (v > vHi) vHi = v;
  }
  let lanes = 0;
  const bins = Math.floor(vHi - vLo) + 1;
  const laneOf = new Int32Array(to - from);
  const binOf = new Int32Array(to - from);
  const us = new Float64Array(to - from);
  for (let k = from; k < to; k++) {
    const p = pixels[k]!;
    const x = (p % width) + 0.5;
    const y = Math.floor(p / width) + 0.5;
    const u = x * COS + y * SIN;
    const lane = Math.floor((u - uLo) / laneW);
    laneOf[k - from] = lane;
    binOf[k - from] = Math.floor(-x * SIN + y * COS - vLo);
    us[k - from] = u;
    if (lane + 1 > lanes) lanes = lane + 1;
  }
  const filled = new Uint8Array(lanes * bins);
  const binUMin = new Float64Array(lanes * bins).fill(Infinity);
  const binUMax = new Float64Array(lanes * bins).fill(-Infinity);
  for (let k = 0; k < to - from; k++) {
    const cell = laneOf[k]! * bins + binOf[k]!;
    filled[cell] = 1;
    if (us[k]! < binUMin[cell]!) binUMin[cell] = us[k]!;
    if (us[k]! > binUMax[cell]!) binUMax[cell] = us[k]!;
  }
  const spans: Span[] = [];
  const splitGap = 0.75 * bw;
  for (let lane = 0; lane < lanes; lane++) {
    let span: Span | null = null;
    let lastBin = -Infinity;
    for (let b = 0; b < bins; b++) {
      const cell = lane * bins + b;
      if (!filled[cell]) continue;
      if (span && b - lastBin - 1 > splitGap) {
        spans.push(span);
        span = null;
      }
      if (!span) span = { uMin: binUMin[cell]!, uMax: binUMax[cell]!, v0: vLo + b, v1: vLo + b + 1, lane };
      span.uMin = Math.min(span.uMin, binUMin[cell]!);
      span.uMax = Math.max(span.uMax, binUMax[cell]!);
      span.v1 = vLo + b + 1;
      lastBin = b;
    }
    if (span) spans.push(span);
  }
  return mergeShortSpans(spans, bw, laneW);
}

/**
 * Merge short sweeps into a neighbour when the union still fits one brush
 * (VI 171..201): a small blob that straddles a lane boundary becomes one dab
 * instead of two. The union box is swept along its own centre, so coverage holds.
 */
function mergeShortSpans(spans: Span[], bw: number, laneW: number): Span[] {
  const out = spans.slice();
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < out.length && !changed; i++) {
      const a = out[i]!;
      if (a.v1 - a.v0 > 0.65 * bw) continue;
      let pick = -1;
      let pickArea = Infinity;
      for (let j = 0; j < out.length; j++) {
        if (j === i) continue;
        const b = out[j]!;
        const uMin = Math.min(a.uMin, b.uMin);
        const uMax = Math.max(a.uMax, b.uMax);
        const v0 = Math.min(a.v0, b.v0);
        const v1 = Math.max(a.v1, b.v1);
        const gap = Math.max(0, b.v0 - a.v1, a.v0 - b.v1);
        const endGap = Math.min(Math.abs(b.v0 - a.v1), Math.abs(a.v0 - b.v1), Math.abs(a.v0 - b.v0), Math.abs(a.v1 - b.v1));
        const laneGap = Math.abs((a.uMin + a.uMax) / 2 - (b.uMin + b.uMax) / 2);
        if (uMax - uMin > laneW || v1 - v0 > 1.5 * bw || gap > 0.75 * bw || Math.hypot(endGap, laneGap) > bw) continue;
        const area = (uMax - uMin) * (v1 - v0);
        if (area < pickArea) {
          pickArea = area;
          pick = j;
        }
      }
      if (pick < 0) continue;
      const b = out[pick]!;
      out[Math.min(i, pick)] = { uMin: Math.min(a.uMin, b.uMin), uMax: Math.max(a.uMax, b.uMax), v0: Math.min(a.v0, b.v0), v1: Math.max(a.v1, b.v1), lane: Math.min(a.lane, b.lane) };
      out.splice(Math.max(i, pick), 1);
      changed = true;
    }
  }
  return out;
}

function toSweep(span: Span): Sweep {
  const u = (span.uMin + span.uMax) / 2;
  const [ax, ay] = toXY(u, span.v0);
  const [bx, by] = toXY(u, span.v1);
  return { ax, ay, bx, by, lane: span.lane, v: span.v0 };
}

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

const flipped = (s: Sweep): Sweep => ({ ...s, ax: s.bx, ay: s.by, bx: s.ax, by: s.ay });

/** Pen travel from `tip` through the route, sweeps excluded. */
function travel(order: readonly Sweep[], tip: [number, number]): number {
  let total = 0;
  let [x, y] = tip;
  for (const s of order) {
    total += dist(x, y, s.ax, s.ay);
    x = s.bx;
    y = s.by;
  }
  return total;
}

/**
 * Serpentine: lanes in order from the outer lane nearer the pen, down one
 * lane and up the next, every sweep of a lane in turn. The brush wipes the
 * shape from one side to the other, which is what a person filling it does.
 */
function serpentine(sweeps: readonly Sweep[], tip: [number, number]): Sweep[] {
  const lanes = new Map<number, Sweep[]>();
  for (const s of sweeps) {
    const list = lanes.get(s.lane);
    if (list) list.push(s);
    else lanes.set(s.lane, [s]);
  }
  const keys = [...lanes.keys()].sort((a, b) => a - b);
  for (const key of keys) lanes.get(key)!.sort((a, b) => a.v - b.v);
  let best: Sweep[] = [];
  let bestCost = Infinity;
  for (const ascending of [true, false]) {
    for (const down of [true, false]) {
      const order: Sweep[] = [];
      (ascending ? keys : keys.slice().reverse()).forEach((key, i) => {
        const lane = lanes.get(key)!;
        const goingDown = down === (i % 2 === 0);
        order.push(...(goingDown ? lane : lane.slice().reverse().map(flipped)));
      });
      const cost = travel(order, tip);
      if (cost < bestCost) {
        bestCost = cost;
        best = order;
      }
    }
  }
  return best;
}

/**
 * Greedy route from `tip` (nearest end first, reversing as needed, uphill
 * hops penalised), then a bounded 2-opt that only shortens travel (VI 11..168).
 */
function greedyTwoOpt(sweeps: readonly Sweep[], tip: [number, number]): Sweep[] {
  const left = sweeps.slice();
  const order: Sweep[] = [];
  let [tx, ty] = tip;
  while (left.length > 0) {
    let pick = 0;
    let flip = false;
    let best = Infinity;
    for (let i = 0; i < left.length; i++) {
      const s = left[i]!;
      const fwd = dist(s.ax, s.ay, tx, ty) + UPHILL_PENALTY * Math.max(ty - s.ay, 0);
      const rev = dist(s.bx, s.by, tx, ty) + UPHILL_PENALTY * Math.max(ty - s.by, 0);
      if (fwd < best) {
        best = fwd;
        pick = i;
        flip = false;
      }
      if (rev < best) {
        best = rev;
        pick = i;
        flip = true;
      }
    }
    const s = left.splice(pick, 1)[0]!;
    const oriented = flip ? flipped(s) : s;
    order.push(oriented);
    tx = oriented.bx;
    ty = oriented.by;
  }
  const hop = (from: Sweep | [number, number], to: Sweep) => (Array.isArray(from) ? dist(from[0], from[1], to.ax, to.ay) : dist(from.bx, from.by, to.ax, to.ay));
  for (let pass = 0; pass < TWO_OPT_PASSES; pass++) {
    let improved = false;
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < Math.min(order.length, i + TWO_OPT_WINDOW); j++) {
        const before: Sweep | [number, number] = i === 0 ? tip : order[i - 1]!;
        const after = order[j + 1];
        const oldCost = hop(before, order[i]!) + (after ? hop(order[j]!, after) : 0);
        const newCost = hop(before, flipped(order[j]!)) + (after ? hop(flipped(order[i]!), after) : 0);
        if (newCost + 1e-9 < oldCost) {
          order.splice(i, j - i + 1, ...order.slice(i, j + 1).reverse().map(flipped));
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return order;
}

/**
 * Route one group's sweeps. The serpentine reads best; the greedy route
 * wins only when the serpentine would spend much more travel, which happens
 * when one region holds parts far apart along the same lanes.
 */
function routeSweeps(sweeps: readonly Sweep[], tip: [number, number]): Sweep[] {
  const snake = serpentine(sweeps, tip);
  const greedy = greedyTwoOpt(sweeps, tip);
  return travel(snake, tip) <= SERPENTINE_TRAVEL_SLACK * travel(greedy, tip) ? snake : greedy;
}

export interface FillPlanInput {
  width: number;
  height: number;
  /** Not paper: the regions that order the pass. */
  visible: Uint8Array;
  /** Pixels the fill brush must cover (visible minus what the outline already shows). */
  target: Uint8Array;
  bw: number;
  /** Where the pencil is when the fill pass starts (the outline's last point). */
  start: [number, number];
}

/**
 * Fill strokes: straight two point sweeps. Regions of the visible picture
 * are swept largest first (the subject), then top first; regions with too
 * little target to deserve their own serpentine share a pooled group last.
 */
export function planFillStrokes(input: FillPlanInput): number[][] {
  const { width, height, visible, target, bw } = input;
  const comps = labelComponents(visible, width, height, false);
  const targetArea = new Int32Array(comps.count + 1);
  for (let i = 0; i < target.length; i++) if (target[i] && comps.labels[i]) targetArea[comps.labels[i]!]!++;
  const poolBelow = POOL_AREA_FACTOR * bw * bw;
  const big: number[] = [];
  for (let id = 1; id <= comps.count; id++) if (targetArea[id]! >= poolBelow) big.push(id);
  big.sort((a, b) => comps.area[b]! - comps.area[a]! || a - b);
  const ordered = big.length > 0 ? [big[0]!, ...big.slice(1).sort((a, b) => comps.minY[a]! - comps.minY[b]! || comps.minX[a]! - comps.minX[b]! || a - b)] : [];
  // Group slot per region: ordered big regions first, then the pool.
  const slot = new Int32Array(comps.count + 1).fill(ordered.length);
  ordered.forEach((id, i) => {
    slot[id] = i;
  });
  const groups = ordered.length + 1;
  const counts = new Int32Array(groups + 1);
  for (let i = 0; i < target.length; i++) if (target[i] && comps.labels[i]) counts[slot[comps.labels[i]!]! + 1]!++;
  for (let g = 0; g < groups; g++) counts[g + 1]! += counts[g]!;
  const pixels = new Int32Array(counts[groups]!);
  const fillAt = counts.slice();
  for (let i = 0; i < target.length; i++) if (target[i] && comps.labels[i]) pixels[fillAt[slot[comps.labels[i]!]!]!++] = i;

  const strokes: number[][] = [];
  let tip = input.start;
  for (let g = 0; g < groups; g++) {
    if (counts[g + 1]! <= counts[g]!) continue;
    const sweeps = laneSpans(pixels, counts[g]!, counts[g + 1]!, width, bw).map(toSweep);
    for (const s of routeSweeps(sweeps, tip)) {
      strokes.push([s.ax, s.ay, s.bx, s.by]);
      tip = [s.bx, s.by];
    }
  }
  return strokes;
}
