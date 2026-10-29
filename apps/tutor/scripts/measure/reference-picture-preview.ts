/**
 * Preview a reference picture stroke plan so a person can judge the look.
 *
 *   npx tsx scripts/measure/reference-picture-preview.ts <image> [<image> ...]
 *
 * For each image writes `.context/reference-picture/stroke/<name>/`:
 * `plan.json`, `picture.png`, `ink-mask.png`, `overlay-outline.png` and
 * `overlay-fill.png` (strokes coloured by order, red to violet, a dot at each
 * start, grey dashes for pen travel), six reveal frames (`frame-1-paper` ..
 * `frame-6-fill-100`) and `frames.png`, the six on one sheet. Frames replay
 * the shipped plan: the outline reveals the picture through the decoded
 * `inkMask` under the outline brush, the fill reveals it under the fill brush,
 * nothing is flushed, so a gap in coverage shows as paper.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { ReferencePicturePlan } from "@heytutor/drawing";
import { buildStrokePlan } from "../../lib/reference-picture/strokePlan";
import { stampPolyline } from "../../lib/reference-picture/strokePlanImage";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const OUT_ROOT = path.join(REPO_ROOT, ".context/reference-picture/stroke");
/** Graphite board colour around the card, so the frame reads like the board. */
const BOARD_RGB = [0x1f, 0x1d, 0x1b] as const;
const BOARD_MARGIN = 16;

async function decodeRgb(png: Buffer): Promise<{ data: Uint8Array; width: number; height: number }> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

async function decodeMask(dataUrl: string, width: number, height: number): Promise<Uint8Array> {
  const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== width || info.height !== height) throw new Error(`inkMask is ${info.width}x${info.height}, plan is ${width}x${height}`);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3]! >= 128 ? 1 : 0;
  return mask;
}

function hexRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Stamp a pass's strokes up to `fraction` of its length; returns the pen tip there. */
function stampPass(cover: Uint8Array, plan: ReferencePicturePlan, pass: "outline" | "fill", fraction: number): [number, number] | null {
  const { strokes, brushPx } = plan[pass];
  const total = strokes.reduce((sum, s) => sum + strokeLength(s), 0);
  let budget = fraction * total;
  let tip: [number, number] | null = null;
  for (const stroke of strokes) {
    if (budget <= 0) break;
    const len = strokeLength(stroke);
    stampPolyline(cover, plan.width, plan.height, stroke, brushPx / 2, budget);
    tip = pointAt(stroke, Math.min(len, budget));
    budget -= len;
  }
  return tip;
}

function strokeLength(stroke: readonly number[]): number {
  let total = 0;
  for (let i = 2; i + 1 < stroke.length; i += 2) total += Math.hypot(stroke[i]! - stroke[i - 2]!, stroke[i + 1]! - stroke[i - 1]!);
  return total;
}

function pointAt(stroke: readonly number[], at: number): [number, number] {
  let left = at;
  for (let i = 2; i + 1 < stroke.length; i += 2) {
    const len = Math.hypot(stroke[i]! - stroke[i - 2]!, stroke[i + 1]! - stroke[i - 1]!);
    if (left <= len && len > 0) {
      const t = left / len;
      return [stroke[i - 2]! + (stroke[i]! - stroke[i - 2]!) * t, stroke[i - 1]! + (stroke[i + 1]! - stroke[i - 1]!) * t];
    }
    left -= len;
  }
  return [stroke[stroke.length - 2]!, stroke[stroke.length - 1]!];
}

/** One frame: board margin, paper card, revealed pixels, pen tip. */
async function frame(plan: ReferencePicturePlan, picture: Uint8Array, ink: Uint8Array, outlineFraction: number, fillFraction: number): Promise<Buffer> {
  const { width, height } = plan;
  const outlineCover = new Uint8Array(width * height);
  const fillCover = new Uint8Array(width * height);
  let tip = stampPass(outlineCover, plan, "outline", outlineFraction);
  if (fillFraction > 0) tip = stampPass(fillCover, plan, "fill", fillFraction) ?? tip;
  const paper = hexRgb(plan.paper);
  const W = width + 2 * BOARD_MARGIN;
  const H = height + 2 * BOARD_MARGIN;
  const out = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) out.set(BOARD_RGB, i * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const o = ((y + BOARD_MARGIN) * W + x + BOARD_MARGIN) * 3;
      const shown = fillCover[i] || (outlineCover[i] && ink[i]);
      out.set(shown ? picture.subarray(i * 3, i * 3 + 3) : paper, o);
    }
  }
  let img = sharp(out, { raw: { width: W, height: H, channels: 3 } });
  if (tip && (outlineFraction < 1 || (fillFraction > 0 && fillFraction < 1))) {
    const [tx, ty] = [tip[0] + BOARD_MARGIN, tip[1] + BOARD_MARGIN];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><circle cx="${tx}" cy="${ty}" r="6" fill="#ff7a1a" stroke="#000" stroke-width="1.5"/></svg>`;
    img = sharp(await img.png().toBuffer()).composite([{ input: Buffer.from(svg) }]);
  }
  return img.png().toBuffer();
}

/** Strokes over the faded picture, coloured by order. */
async function overlay(plan: ReferencePicturePlan, picturePng: Buffer, pass: "outline" | "fill"): Promise<Buffer> {
  const { width, height } = plan;
  const { strokes, brushPx } = plan[pass];
  const parts: string[] = [];
  const hue = (i: number) => Math.round((300 * i) / Math.max(1, strokes.length - 1));
  strokes.forEach((stroke, i) => {
    if (i > 0) {
      const prev = strokes[i - 1]!;
      parts.push(`<line x1="${prev[prev.length - 2]}" y1="${prev[prev.length - 1]}" x2="${stroke[0]}" y2="${stroke[1]}" stroke="#888" stroke-width="0.8" stroke-dasharray="3 3"/>`);
    }
    const points = [];
    for (let k = 0; k + 1 < stroke.length; k += 2) points.push(`${stroke[k]},${stroke[k + 1]}`);
    if (pass === "fill") parts.push(`<polyline points="${points.join(" ")}" fill="none" stroke="hsl(${hue(i)},90%,45%)" stroke-opacity="0.13" stroke-width="${brushPx}" stroke-linecap="round"/>`);
    parts.push(`<polyline points="${points.join(" ")}" fill="none" stroke="hsl(${hue(i)},90%,42%)" stroke-width="${pass === "fill" ? 2 : 1.4}" stroke-linejoin="round"/>`);
    parts.push(`<circle cx="${stroke[0]}" cy="${stroke[1]}" r="${pass === "fill" ? 3.5 : 2.2}" fill="hsl(${hue(i)},90%,35%)"/>`);
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join("")}</svg>`;
  const faded = await sharp(picturePng).composite([{ input: { create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0.7 } } } }]).png().toBuffer();
  return sharp(faded).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
}

async function sheet(frames: Buffer[], width: number, height: number): Promise<Buffer> {
  const W = width + 2 * BOARD_MARGIN;
  const H = height + 2 * BOARD_MARGIN;
  return sharp({ create: { width: W * 3, height: H * 2, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite(frames.map((input, i) => ({ input, left: (i % 3) * W, top: Math.floor(i / 3) * H })))
    .png()
    .toBuffer();
}

async function preview(file: string): Promise<void> {
  const name = path.basename(file).replace(/\.[^.]+$/, "");
  const dir = path.join(OUT_ROOT, name);
  mkdirSync(dir, { recursive: true });
  const { plan, picturePng, stats } = await buildStrokePlan(readFileSync(file));
  writeFileSync(path.join(dir, "plan.json"), JSON.stringify(plan));
  writeFileSync(path.join(dir, "picture.png"), picturePng);
  writeFileSync(path.join(dir, "ink-mask.png"), Buffer.from(plan.inkMask.slice(plan.inkMask.indexOf(",") + 1), "base64"));
  writeFileSync(path.join(dir, "overlay-outline.png"), await overlay(plan, picturePng, "outline"));
  writeFileSync(path.join(dir, "overlay-fill.png"), await overlay(plan, picturePng, "fill"));
  const picture = await decodeRgb(picturePng);
  const ink = await decodeMask(plan.inkMask, plan.width, plan.height);
  const steps: Array<[string, number, number]> = [
    ["frame-1-paper", 0, 0],
    ["frame-2-outline-33", 1 / 3, 0],
    ["frame-3-outline-66", 2 / 3, 0],
    ["frame-4-outline-100", 1, 0],
    ["frame-5-fill-50", 1, 0.5],
    ["frame-6-fill-100", 1, 1],
  ];
  const frames: Buffer[] = [];
  for (const [label, o, f] of steps) {
    const png = await frame(plan, picture.data, ink, o, f);
    writeFileSync(path.join(dir, `${label}.png`), png);
    frames.push(png);
  }
  writeFileSync(path.join(dir, "frames.png"), await sheet(frames, plan.width, plan.height));
  const points = (pass: "outline" | "fill") => plan[pass].strokes.reduce((sum, s) => sum + s.length / 2, 0);
  console.log(
    JSON.stringify({
      name,
      size: `${plan.width}x${plan.height}`,
      paper: plan.paper,
      ...stats,
      outlineCoverage: Number(stats.outlineCoverage.toFixed(5)),
      fillCoverage: Number(stats.fillCoverage.toFixed(5)),
      outlinePoints: points("outline"),
      outlineLengthPx: plan.outline.lengthPx,
      fillBrushPx: plan.fill.brushPx,
      fillLengthPx: plan.fill.lengthPx,
      inkMaskBytes: plan.inkMask.length,
      picturePngBytes: picturePng.length,
      dir: path.relative(REPO_ROOT, dir),
    }),
  );
}

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: npx tsx scripts/measure/reference-picture-preview.ts <image> [<image> ...]");
    process.exit(2);
  }
  for (const file of files) await preview(path.resolve(file));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
