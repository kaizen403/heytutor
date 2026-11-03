/**
 * Reference picture stroke plan: turns one accepted picture into the
 * `reference-picture-plan/v1` the board replays under the pencil (spec in
 * `.context/reference-picture/algorithm-spec.md`, a port of the whiteboard
 * reveal of geeklee/srt-whiteboard-animation and
 * letuandat131/whiteboard-animation-vi).
 *
 * 1. Fit the picture inside 760x600 and composite it over its own paper
 *    colour (the corner median). Paper is the paper like area connected to
 *    the border; the board lays it as a flat card.
 * 2. Ink map: an adaptive threshold of the smoothed, contrast equalised grey
 *    image, confirmed at coarser scales and cleaned of specks. It ships as
 *    the plan's `inkMask`; the outline pass reveals the picture only there.
 * 3. Outline strokes trace the ink cell by cell (grid path).
 * 4. Fill strokes sweep the rest of the visible picture in tilted lanes.
 *
 * Pure: the same bytes and options always give the same plan, so a stored
 * plan can be rebuilt and compared. No randomness, no network.
 */

import sharp from "sharp";
import { REFERENCE_PICTURE_PLAN_VERSION, polylineLength, type ReferencePicturePlan } from "@heytutor/drawing";
import { planFillStrokes, fillBrushPx } from "./strokePlanFill";
import { capStrokes, outlineBrushPx, planOutlineStrokes, OUTLINE_CELL_EDGE } from "./strokePlanOutline";
import {
  adaptiveInk,
  bilateral,
  borderConnected,
  boxDownscale,
  coverageOf,
  dilate,
  labelComponents,
  stampPolyline,
  toGray,
} from "./strokePlanImage";

export const STROKE_PLAN_MAX_WIDTH = 760;
export const STROKE_PLAN_MAX_HEIGHT = 600;
/** SR `match_bg_threshold`: summed RGB distance under which a pixel reads as paper. */
const PAPER_LIKE = 28;
const ADAPTIVE_BLOCK = 15;
const ADAPTIVE_C = 10;
/** Coarse confirmation scales (downscale factor, C): a line must also show at half and third size. */
const SUPPORT_SCALES: ReadonlyArray<readonly [number, number]> = [
  [2, 5],
  [3, 4],
];
/** A dark pixel (grey at most this, and this much darker than the paper) may be line work however thick its edge reads. */
const DARK_GRAY = 80;
const DARK_CONTRAST = 100;
/** Dark strokes up to about 3% of the short side (19 px at 600) count as line work. */
const DARK_STROKE_FRACTION = 0.015;
/**
 * A fill target component that fits inside one outline dab is a crumb beside
 * a line; one that touches paper and never gets further than HALO_REACH px
 * from the ink is a line's antialiased edge (an upscaled picture has soft
 * ones). Both join the ink and draw with the line. A strip of colour between
 * two close lines does not touch paper, so it stays for the fill pass.
 */
const HALO_REACH = 2;
/** Outline strokes up to this long whose ink other strokes already reveal are dropped: each one costs a pen lift. */
const PRUNE_MAX_LENGTH = 24;
export const OUTLINE_STROKE_CAP = 500;
/** Plan JSON budget, inkMask included. Real diagrams measure 12 to 28 KB; dense noise about 55 KB. */
export const PLAN_BYTES_BUDGET = 120_000;
/** Outline cell edges tried in turn; only a plan over budget moves to a coarser grid. */
const OUTLINE_CELL_EDGES = [OUTLINE_CELL_EDGE, 12, 16] as const;
export const FILL_STROKE_CAP = 400;
const FILL_BRUSH_MAX = 92;
/** Downloaded pictures are bounded long before they reach us; this only stops a decompression bomb. */
const INPUT_PIXEL_LIMIT = 40_000_000;

export interface StrokePlanStats {
  /** Pixels in the shipped ink mask. */
  inkPixels: number;
  outlineStrokes: number;
  fillStrokes: number;
  /** Ink mask pixels within `outline.brushPx / 2` of an outline stroke. */
  outlineCoverage: number;
  /** Fill target pixels (visible, not ink) within `fill.brushPx / 2` of a fill stroke. */
  fillCoverage: number;
  /** Plan JSON length, inkMask included. */
  planBytes: number;
  ms: number;
  /** Longest synchronous stretch between yields: what the build can hold the event loop for. */
  longestSliceMs: number;
}

export interface StrokePlanResult {
  plan: ReferencePicturePlan;
  /** The picture at plan size, composited over the paper colour. */
  picturePng: Buffer;
  stats: StrokePlanStats;
}

/** Masks a plan is built from, for measurement and debugging scripts. */
export interface StrokePlanMasks {
  width: number;
  height: number;
  /** Composited RGB, 3 bytes per pixel. */
  rgb: Uint8Array;
  paper: Uint8Array;
  ink: Uint8Array;
  fillTarget: Uint8Array;
}

/**
 * The plan runs inside the one production process that also relays the
 * WebSocket TTS stream, so the build hands the event loop back between its
 * heavy stages instead of holding it for the whole picture (about 200 ms).
 */
class Breather {
  private sliceStart = performance.now();
  longest = 0;
  async breathe(): Promise<void> {
    this.longest = Math.max(this.longest, performance.now() - this.sliceStart);
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.sliceStart = performance.now();
  }
  /** After an await on work that ran off the thread (sharp), the clock restarts. */
  resume(): void { this.sliceStart = performance.now(); }
}

const hex = (rgb: readonly number[]) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[Math.floor((values.length - 1) / 2)]!;
}

/**
 * Paper colour: the per channel median of the four corner squares (SR
 * 1073..1089). A picture whose corners are mostly transparent sits on white.
 */
function paperColour(rgba: Uint8Array, width: number, height: number): [number, number, number] {
  const margin = Math.min(Math.max(3, Math.floor(Math.min(width, height) / 50)), width, height);
  const channels: [number[], number[], number[]] = [[], [], []];
  let transparent = 0;
  let total = 0;
  for (const [x0, y0] of [
    [0, 0],
    [width - margin, 0],
    [0, height - margin],
    [width - margin, height - margin],
  ] as const) {
    for (let y = y0; y < y0 + margin; y++) {
      for (let x = x0; x < x0 + margin; x++) {
        const p = (y * width + x) * 4;
        total++;
        if (rgba[p + 3]! < 128) {
          transparent++;
          continue;
        }
        for (let c = 0; c < 3; c++) channels[c]!.push(rgba[p + c]!);
      }
    }
  }
  if (transparent * 2 > total || channels[0].length === 0) return [255, 255, 255];
  return [median(channels[0]), median(channels[1]), median(channels[2])];
}

/**
 * Dark strokes no thicker than `2 * radius + 1`: dark pixels a square of that
 * size cannot sit inside (a morphological opening removes them). The
 * adaptive threshold only marks the edges of a thick dark line; these fill
 * it in, so a bold outline draws solid instead of hollow. Bigger dark areas
 * stay colour for the fill pass, and so do their thin fringes (a thin part
 * touching a thick one is the tail of a dark area, not a line).
 */
function thinDark(gray: Uint8Array, paperGray: number, width: number, height: number): Uint8Array {
  const dark = new Uint8Array(width * height);
  for (let i = 0; i < dark.length; i++) dark[i] = gray[i]! <= DARK_GRAY && paperGray - gray[i]! >= DARK_CONTRAST ? 1 : 0;
  const radius = Math.max(3, Math.round(DARK_STROKE_FRACTION * Math.min(width, height)));
  const light = new Uint8Array(dark.length);
  for (let i = 0; i < dark.length; i++) light[i] = dark[i] ? 0 : 1;
  const eroded = dilate(light, width, height, radius);
  for (let i = 0; i < eroded.length; i++) eroded[i] = eroded[i] ? 0 : 1;
  const opened = dilate(eroded, width, height, radius);
  for (let i = 0; i < dark.length; i++) dark[i] = dark[i]! && !opened[i] ? 1 : 0;
  const thick = dilate(opened, width, height, 1);
  const parts = labelComponents(dark, width, height, true);
  const fringe = new Uint8Array(parts.count + 1);
  for (let i = 0; i < dark.length; i++) if (dark[i] && thick[i]) fringe[parts.labels[i]!] = 1;
  for (let i = 0; i < dark.length; i++) if (dark[i] && fringe[parts.labels[i]!]) dark[i] = 0;
  return dark;
}

/** Detailed line map (VI `v181d_plan.py` 17..47) plus thin dark strokes, minus paper pixels, specks removed. */
function inkMap(claheGray: Uint8Array, thin: Uint8Array, paper: Uint8Array, width: number, height: number): Uint8Array {
  const g = bilateral(claheGray, width, height, 5, 12, 2);
  const ink = adaptiveInk(g, width, height, ADAPTIVE_BLOCK, ADAPTIVE_C);
  const support = new Uint8Array(width * height);
  for (const [factor, c] of SUPPORT_SCALES) {
    const small = boxDownscale(g, width, height, factor);
    const coarse = adaptiveInk(small.data, small.width, small.height, ADAPTIVE_BLOCK, c);
    const up = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const row = Math.min(small.height - 1, Math.floor(y / factor)) * small.width;
      for (let x = 0; x < width; x++) up[y * width + x] = coarse[row + Math.min(small.width - 1, Math.floor(x / factor))]!;
    }
    const grown = dilate(up, width, height, 1);
    for (let i = 0; i < support.length; i++) support[i] ||= grown[i]!;
  }
  for (let i = 0; i < ink.length; i++) ink[i] = ((ink[i]! && support[i]!) || thin[i]!) && !paper[i] ? 1 : 0;
  // Keep a component if it has some area or some reach (VI 43..45), scaled to the plan height.
  const s = height / 720;
  const minArea = Math.max(2, Math.round(4 * s * s));
  const minSpan = Math.max(3, Math.round(8 * s));
  const comps = labelComponents(ink, width, height, true);
  const keep = new Uint8Array(comps.count + 1);
  for (let id = 1; id <= comps.count; id++) {
    keep[id] = comps.area[id]! >= minArea || Math.max(comps.maxX[id]! - comps.minX[id]!, comps.maxY[id]! - comps.minY[id]!) + 1 >= minSpan ? 1 : 0;
  }
  for (let i = 0; i < ink.length; i++) if (ink[i] && !keep[comps.labels[i]!]) ink[i] = 0;
  return ink;
}

/** White opaque on ink, transparent elsewhere, as a 1 bit palette PNG. */
async function encodeInkMask(mask: Uint8Array, width: number, height: number): Promise<Buffer> {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < mask.length; i++) if (mask[i]) rgba.writeUInt32BE(0xffffffff, i * 4);
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png({ palette: true, colours: 2, dither: 0, compressionLevel: 9, effort: 10 }).toBuffer();
}

function coverage(strokes: readonly number[][], brushPx: number, target: Uint8Array, width: number, height: number): { fraction: number; cover: Uint8Array } {
  const cover = new Uint8Array(width * height);
  for (const stroke of strokes) stampPolyline(cover, width, height, stroke, brushPx / 2);
  return { fraction: coverageOf(target, cover).fraction, cover };
}

/**
 * Drop short strokes whose ink pixels other strokes already reveal, shortest
 * first. The grid walk leaves such crumbs where a line is two cells wide.
 */
function pruneCoveredStrokes(strokes: number[][], ink: Uint8Array, width: number, height: number, radius: number): number[][] {
  const scratch = new Uint8Array(width * height);
  const count = new Uint16Array(width * height);
  const pixels = strokes.map((stroke) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i + 1 < stroke.length; i += 2) {
      x0 = Math.min(x0, stroke[i]!);
      x1 = Math.max(x1, stroke[i]!);
      y0 = Math.min(y0, stroke[i + 1]!);
      y1 = Math.max(y1, stroke[i + 1]!);
    }
    stampPolyline(scratch, width, height, stroke, radius);
    const hit: number[] = [];
    for (let y = Math.max(0, Math.floor(y0 - radius)); y <= Math.min(height - 1, Math.ceil(y1 + radius)); y++) {
      for (let x = Math.max(0, Math.floor(x0 - radius)); x <= Math.min(width - 1, Math.ceil(x1 + radius)); x++) {
        const i = y * width + x;
        if (!scratch[i]) continue;
        scratch[i] = 0;
        if (ink[i]) {
          hit.push(i);
          count[i]!++;
        }
      }
    }
    return hit;
  });
  const lengths = strokes.map((stroke) => polylineLength(stroke));
  const drop = new Uint8Array(strokes.length);
  const candidates = strokes.map((_, i) => i).filter((i) => lengths[i]! <= PRUNE_MAX_LENGTH);
  candidates.sort((a, b) => lengths[a]! - lengths[b]! || a - b);
  for (const i of candidates) {
    if (!pixels[i]!.every((p) => count[p]! >= 2)) continue;
    drop[i] = 1;
    for (const p of pixels[i]!) count[p]!--;
  }
  return strokes.filter((_, i) => !drop[i]);
}

/** Outline strokes, crumbs pruned, plus a dot for every cell whose ink the walk still missed. */
function outlinePass(ink: Uint8Array, width: number, height: number, edge: number): { strokes: number[][]; brushPx: number; coverage: number } {
  const brushPx = outlineBrushPx(edge);
  let strokes = capStrokes(pruneCoveredStrokes(planOutlineStrokes(ink, width, height, edge), ink, width, height, brushPx / 2), OUTLINE_STROKE_CAP);
  let result = coverage(strokes, brushPx, ink, width, height);
  if (result.fraction < 1) {
    const missed = new Uint8Array(width * height);
    for (let i = 0; i < ink.length; i++) missed[i] = ink[i] && !result.cover[i] ? 1 : 0;
    const extra = planOutlineStrokes(missed, width, height, edge);
    if (extra.length > 0) {
      strokes = capStrokes([...strokes, ...extra], OUTLINE_STROKE_CAP);
      result = coverage(strokes, brushPx, ink, width, height);
    }
  }
  return { strokes, brushPx, coverage: result.fraction };
}

function fillPass(masks: StrokePlanMasks, start: [number, number]): { strokes: number[][]; brushPx: number; coverage: number } {
  const { width, height } = masks;
  const visible = invert(masks.paper);
  let brushPx = fillBrushPx(width, height);
  let strokes = planFillStrokes({ width, height, visible, target: masks.fillTarget, bw: brushPx, start });
  while (strokes.length > FILL_STROKE_CAP && brushPx < FILL_BRUSH_MAX) {
    brushPx = Math.min(FILL_BRUSH_MAX, Math.round(brushPx * 1.15));
    strokes = planFillStrokes({ width, height, visible, target: masks.fillTarget, bw: brushPx, start });
  }
  return { strokes, brushPx, coverage: coverage(strokes, brushPx, masks.fillTarget, width, height).fraction };
}

function invert(mask: Uint8Array): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] ? 0 : 1;
  return out;
}

/** Decode, fit and composite; returns the plan size RGB, the paper colour and the paper mask. */
async function preparePicture(input: Buffer, maxWidth: number, maxHeight: number): Promise<{ width: number; height: number; rgb: Uint8Array; alpha: Uint8Array; paper: [number, number, number] }> {
  const { data, info } = await sharp(input, { limitInputPixels: INPUT_PIXEL_LIMIT })
    .rotate()
    .ensureAlpha()
    .resize({ width: maxWidth, height: maxHeight, fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const rgba = new Uint8Array(data.buffer, data.byteOffset, data.length);
  const paper = paperColour(rgba, width, height);
  const rgb = new Uint8Array(width * height * 3);
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3]!;
    alpha[i] = a;
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.round((rgba[i * 4 + c]! * a + paper[c]! * (255 - a)) / 255);
  }
  return { width, height, rgb, alpha, paper };
}

/** Everything but the strokes: the composited picture and its paper, ink and fill target masks. */
export async function strokePlanMasks(input: Buffer, options?: { maxWidth?: number; maxHeight?: number; breather?: Breather }): Promise<StrokePlanMasks & { paperColour: [number, number, number] }> {
  const breather = options?.breather ?? new Breather();
  const { width, height, rgb, alpha, paper: paperRgb } = await preparePicture(input, options?.maxWidth ?? STROKE_PLAN_MAX_WIDTH, options?.maxHeight ?? STROKE_PLAN_MAX_HEIGHT);
  breather.resume();
  const n = width * height;
  const paperLike = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.abs(rgb[i * 3]! - paperRgb[0]) + Math.abs(rgb[i * 3 + 1]! - paperRgb[1]) + Math.abs(rgb[i * 3 + 2]! - paperRgb[2]);
    paperLike[i] = d < PAPER_LIKE ? 1 : 0;
  }
  // Only paper reachable from the border counts, so white highlights inside the subject stay; a see through hole is paper wherever it is.
  const paper = borderConnected(paperLike, width, height);
  for (let i = 0; i < n; i++) if (alpha[i]! < 128 && paperLike[i]) paper[i] = 1;

  const rawGray = toGray(rgb, width, height);
  await breather.breathe();
  const gray = bilateral(rawGray, width, height, 7, 12, 3);
  await breather.breathe();
  const clahe = await sharp(Buffer.from(gray), { raw: { width, height, channels: 1 } })
    .clahe({ width: Math.ceil(width / 8), height: Math.ceil(height / 8), maxSlope: 2 })
    .extractChannel(0)
    .raw()
    .toBuffer();
  breather.resume();
  const paperGray = toGray(Uint8Array.from(paperRgb), 1, 1)[0]!;
  const thin = thinDark(rawGray, paperGray, width, height);
  await breather.breathe();
  const ink = dilate(inkMap(new Uint8Array(clahe.buffer, clahe.byteOffset, n), thin, paper, width, height), width, height, 1);
  await breather.breathe();
  // The fill pass reveals what the outline did not. Paper like pixels inside
  // the subject (a white highlight, the inside of a ring) already match the
  // card within PAPER_LIKE, so sweeping them would only spend time.
  const fillTarget = new Uint8Array(n);
  for (let i = 0; i < n; i++) fillTarget[i] = !paper[i] && !ink[i] && !paperLike[i] ? 1 : 0;
  const specks = labelComponents(fillTarget, width, height, false);
  const nearInk = dilate(ink, width, height, HALO_REACH);
  const haloSpan = outlineBrushPx(OUTLINE_CELL_EDGE);
  const reachesOut = new Uint8Array(specks.count + 1);
  const touchesPaper = new Uint8Array(specks.count + 1);
  for (let i = 0; i < n; i++) {
    const id = specks.labels[i]!;
    if (!id) continue;
    if (!nearInk[i]) reachesOut[id] = 1;
    const x = i % width;
    if ((x > 0 && paperLike[i - 1]) || (x < width - 1 && paperLike[i + 1]) || (i >= width && paperLike[i - width]) || (i < n - width && paperLike[i + width])) touchesPaper[id] = 1;
  }
  for (let i = 0; i < n; i++) {
    const id = specks.labels[i]!;
    if (id && (Math.max(specks.maxX[id]! - specks.minX[id]!, specks.maxY[id]! - specks.minY[id]!) + 1 <= haloSpan || (touchesPaper[id] && !reachesOut[id]))) {
      fillTarget[i] = 0;
      ink[i] = 1;
    }
  }
  return { width, height, rgb, paper, ink, fillTarget, paperColour: paperRgb };
}

/** Build the stroke plan for one picture (PNG, JPEG, WebP, GIF; SVG arrives rasterised). */
export async function buildStrokePlan(input: Buffer, options?: { maxWidth?: number; maxHeight?: number }): Promise<StrokePlanResult> {
  const started = performance.now();
  const breather = new Breather();
  const masks = await strokePlanMasks(input, { ...options, breather });
  const { width, height } = masks;
  await breather.breathe();
  const [maskPng, picturePng] = await Promise.all([
    encodeInkMask(masks.ink, width, height),
    sharp(Buffer.from(masks.rgb), { raw: { width, height, channels: 3 } }).png().toBuffer(),
  ]);
  breather.resume();
  const inkMask = `data:image/png;base64,${maskPng.toString("base64")}`;
  const lengthOf = (strokes: number[][]) => Math.round(strokes.reduce((sum, stroke) => sum + polylineLength(stroke), 0));
  let built: { plan: ReferencePicturePlan; json: string; outline: ReturnType<typeof outlinePass>; fill: ReturnType<typeof fillPass> } | null = null;
  // A coarser grid only if a picture full of texture would break the size budget.
  for (const edge of OUTLINE_CELL_EDGES) {
    const outline = outlinePass(masks.ink, width, height, edge);
    await breather.breathe();
    const last = outline.strokes.at(-1);
    const fill = fillPass(masks, last ? [last[last.length - 2]!, last[last.length - 1]!] : [0, 0]);
    const plan: ReferencePicturePlan = {
      version: REFERENCE_PICTURE_PLAN_VERSION,
      width,
      height,
      paper: hex(masks.paperColour),
      inkMask,
      outline: { brushPx: outline.brushPx, strokes: outline.strokes, lengthPx: lengthOf(outline.strokes) },
      fill: { brushPx: fill.brushPx, strokes: fill.strokes, lengthPx: lengthOf(fill.strokes) },
    };
    built = { plan, json: JSON.stringify(plan), outline, fill };
    await breather.breathe();
    if (Buffer.byteLength(built.json) <= PLAN_BYTES_BUDGET) break;
  }
  const { plan, json, outline, fill } = built!;
  let inkPixels = 0;
  for (const v of masks.ink) inkPixels += v;
  return {
    plan,
    picturePng,
    stats: {
      inkPixels,
      outlineStrokes: outline.strokes.length,
      fillStrokes: fill.strokes.length,
      outlineCoverage: outline.coverage,
      fillCoverage: fill.coverage,
      planBytes: Buffer.byteLength(json),
      ms: Math.round(performance.now() - started),
      longestSliceMs: Math.round(breather.longest),
    },
  };
}
