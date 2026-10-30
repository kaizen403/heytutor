/**
 * Gate: the reference picture stroke plan on synthetic pictures drawn here
 * with sharp (no network, no paid calls).
 *
 *   npx tsx scripts/verify/verify-reference-picture-stroke-plan.ts [<image> ...]
 *
 * Each picture must give a plan the board's parser accepts, fitted inside
 * 760x600, with the right paper colour, a clean 1 bit ink mask, both passes
 * covering at least 99% of what they must reveal, stroke caps and the size
 * budget held, integer coordinates, honest pass lengths, and the same bytes
 * on a second run. Coverage is recomputed here from the decoded mask and
 * picture, not taken from the builder's stats, and two mutations (half the
 * strokes dropped) must fail that recomputation, so the check cannot pass
 * vacuously. Extra image paths get the same checks, minus the paper colour.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  parsePictureCommandParams,
  parseReferencePicturePlan,
  polylineLength,
  referencePictureCommands,
  type ReferencePicturePlan,
} from "@heytutor/drawing";
import { buildStrokePlan, FILL_STROKE_CAP, OUTLINE_STROKE_CAP, PLAN_BYTES_BUDGET } from "../../lib/reference-picture/strokePlan";

const MIN_COVERAGE = 0.99;
const SLOW_MS = 3_000;
const PAPER_LIKE = 28;

interface Case {
  name: string;
  input: () => Promise<Buffer>;
  /** Expected paper colour and per channel tolerance. */
  paper?: { rgb: [number, number, number]; tolerance: number };
  /** Lower bound on the visible (not paper) share of the picture. */
  minVisible?: number;
  /** The outline must find line work. */
  expectInk?: boolean;
  /** The fill pass must have strokes (or must have none). */
  expectFill?: boolean;
}

const svg = (width: number, height: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`);
const render = (width: number, height: number, body: string) => sharp(svg(width, height, body)).png().toBuffer();

const LABEL = 'font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#111"';
const CASES: Case[] = [
  {
    name: "labelled circle diagram",
    input: () =>
      render(
        960,
        640,
        `<rect width="960" height="640" fill="#fff"/>
         <circle cx="430" cy="330" r="220" fill="#cfe8f7" stroke="#123" stroke-width="5"/>
         <circle cx="470" cy="300" r="70" fill="#8a5cc2" stroke="#222" stroke-width="4"/>
         <line x1="520" y1="270" x2="760" y2="150" stroke="#111" stroke-width="2"/>
         <text x="770" y="158" ${LABEL}>Nucleus</text>
         <line x1="640" y1="400" x2="760" y2="470" stroke="#111" stroke-width="2"/>
         <text x="770" y="478" ${LABEL}>Cell membrane</text>
         <line x1="300" y1="420" x2="120" y2="560" stroke="#111" stroke-width="2"/>
         <text x="20" y="595" ${LABEL}>Cytoplasm</text>`,
      ),
    paper: { rgb: [255, 255, 255], tolerance: 0 },
    expectInk: true,
    expectFill: true,
  },
  {
    name: "coloured shapes on white",
    input: () =>
      render(
        640,
        480,
        `<rect width="640" height="480" fill="#fff"/>
         <rect x="60" y="80" width="260" height="200" rx="30" fill="#f28c28"/>
         <circle cx="450" cy="300" r="120" fill="#2a7de1"/>`,
      ),
    paper: { rgb: [255, 255, 255], tolerance: 0 },
    expectFill: true,
  },
  {
    name: "full bleed gradient",
    input: () =>
      render(
        1000,
        800,
        `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d7263d"/><stop offset="0.5" stop-color="#1b998b"/><stop offset="1" stop-color="#2e294e"/></linearGradient></defs>
         <rect width="1000" height="800" fill="url(#g)"/>
         <polygon points="500,120 560,320 770,320 600,440 660,650 500,520 340,650 400,440 230,320 440,320" fill="#ffd23f" stroke="#222" stroke-width="6"/>`,
      ),
    minVisible: 0.9,
    expectFill: true,
  },
  {
    name: "peach paper with bold line figure",
    input: () =>
      render(
        800,
        800,
        `<rect width="800" height="800" fill="#ffd5ba"/>
         <circle cx="400" cy="330" r="190" fill="#ff5a2a" stroke="#3d1608" stroke-width="5"/>
         <path d="M250 420 C180 460 160 520 140 600" fill="none" stroke="#3d1608" stroke-width="22" stroke-linecap="round"/>
         <path d="M550 420 C620 460 640 520 660 600" fill="none" stroke="#3d1608" stroke-width="22" stroke-linecap="round"/>`,
      ),
    paper: { rgb: [0xff, 0xd5, 0xba], tolerance: 1 },
    expectInk: true,
    expectFill: true,
  },
  {
    name: "transparent background",
    input: () =>
      render(
        600,
        600,
        `<circle cx="300" cy="300" r="200" fill="#3fa34d" stroke="#14361a" stroke-width="8"/>
         <circle cx="300" cy="300" r="60" fill="none" stroke="#14361a" stroke-width="4"/>`,
      ),
    paper: { rgb: [255, 255, 255], tolerance: 0 },
    expectInk: true,
    expectFill: true,
  },
  {
    name: "jpeg photo of a sketch",
    input: async () =>
      sharp(
        svg(
          900,
          700,
          `<rect width="900" height="700" fill="#fbfaf6"/>
           <ellipse cx="450" cy="350" rx="300" ry="200" fill="#e9c46a" stroke="#264653" stroke-width="6"/>
           <path d="M200 350 Q450 120 700 350" fill="none" stroke="#264653" stroke-width="4"/>`,
        ),
      )
        .jpeg({ quality: 80 })
        .toBuffer(),
    paper: { rgb: [0xfb, 0xfa, 0xf6], tolerance: 3 },
    expectInk: true,
    expectFill: true,
  },
  {
    name: "photo like texture (caps and size budget)",
    input: () =>
      render(
        1200,
        900,
        `<filter id="t"><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="4" seed="7"/><feColorMatrix type="matrix" values="1.6 0 0 0 -0.3  0 1.6 0 0 -0.3  0 0 1.6 0 -0.3  0 0 0 0 1"/></filter>
         <rect width="1200" height="900" filter="url(#t)"/>`,
      ),
    expectInk: true,
    expectFill: true,
  },
  {
    name: "small line art upscaled, nothing to fill",
    input: () =>
      render(
        200,
        150,
        `<rect width="200" height="150" fill="#fff"/>
         <path d="M20 120 L100 20 L180 120 Z" fill="none" stroke="#000" stroke-width="2"/>
         <line x1="60" y1="70" x2="140" y2="70" stroke="#000" stroke-width="2"/>`,
      ),
    paper: { rgb: [255, 255, 255], tolerance: 0 },
    expectInk: true,
    expectFill: false,
  },
];

async function decodeRgb(png: Buffer): Promise<{ rgb: Uint8Array; width: number; height: number }> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgb: new Uint8Array(data), width: info.width, height: info.height };
}

/** Decoded ink mask; fails on any pixel that is neither opaque white nor fully transparent. */
async function decodeInkMask(plan: ReferencePicturePlan): Promise<{ mask: Uint8Array; problems: string[] }> {
  const png = Buffer.from(plan.inkMask.slice("data:image/png;base64,".length), "base64");
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const problems: string[] = [];
  if (info.width !== plan.width || info.height !== plan.height) problems.push(`inkMask is ${info.width}x${info.height}, plan is ${plan.width}x${plan.height}`);
  const mask = new Uint8Array(info.width * info.height);
  let mixed = 0;
  for (let i = 0; i < mask.length; i++) {
    const a = data[i * 4 + 3]!;
    if (a === 255 && data[i * 4] === 255 && data[i * 4 + 1] === 255 && data[i * 4 + 2] === 255) mask[i] = 1;
    else if (a !== 0) mixed++;
  }
  if (mixed > 0) problems.push(`inkMask has ${mixed} pixels that are neither opaque white nor transparent`);
  return { mask, problems };
}

/**
 * Independent coverage: for each pixel of `target`, is its centre within
 * `radius` of any segment? Segments are bucketed on a coarse grid so the
 * check stays fast; the distance test is the plain point to segment one.
 */
function independentCoverage(target: Uint8Array, width: number, height: number, strokes: number[][], radius: number): number {
  const cell = Math.max(8, Math.ceil(radius * 2));
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const buckets: number[][][] = Array.from({ length: cols * rows }, () => []);
  for (const s of strokes) {
    for (let i = 0; i + 3 < s.length; i += 2) {
      const seg = [s[i]!, s[i + 1]!, s[i + 2]!, s[i + 3]!];
      const c0 = Math.max(0, Math.floor((Math.min(seg[0]!, seg[2]!) - radius) / cell));
      const c1 = Math.min(cols - 1, Math.floor((Math.max(seg[0]!, seg[2]!) + radius) / cell));
      const r0 = Math.max(0, Math.floor((Math.min(seg[1]!, seg[3]!) - radius) / cell));
      const r1 = Math.min(rows - 1, Math.floor((Math.max(seg[1]!, seg[3]!) + radius) / cell));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) buckets[r * cols + c]!.push(seg);
    }
  }
  let total = 0;
  let covered = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!target[y * width + x]) continue;
      total++;
      const px = x + 0.5;
      const py = y + 0.5;
      const hit = buckets[Math.floor(y / cell) * cols + Math.floor(x / cell)]!.some(([ax, ay, bx, by]) => {
        const dx = bx! - ax!;
        const dy = by! - ay!;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax!) * dx + (py - ay!) * dy) / len2)) : 0;
        return Math.hypot(px - ax! - t * dx, py - ay! - t * dy) <= radius;
      });
      if (hit) covered++;
    }
  }
  return total === 0 ? 1 : covered / total;
}

/** Mutation: drop the longest strokes until half the pass length is gone. */
function halve(strokes: number[][]): number[][] {
  const lengths = strokes.map((s) => polylineLength(s));
  const total = lengths.reduce((a, b) => a + b, 0);
  const order = strokes.map((_, i) => i).sort((a, b) => lengths[b]! - lengths[a]!);
  const drop = new Set<number>();
  let removed = 0;
  for (const i of order) {
    if (removed >= total / 2) break;
    drop.add(i);
    removed += lengths[i]!;
  }
  return strokes.filter((_, i) => !drop.has(i));
}

async function check(name: string, input: Buffer, expect: Omit<Case, "name" | "input">): Promise<string[]> {
  const failures: string[] = [];
  const fail = (message: string) => failures.push(`${name}: ${message}`);
  const first = await buildStrokePlan(input);
  const second = await buildStrokePlan(input);
  const { plan, stats } = first;
  const json = JSON.stringify(plan);

  if (json !== JSON.stringify(second.plan)) fail("plan JSON differs between two runs");
  if (!first.picturePng.equals(second.picturePng)) fail("picture PNG differs between two runs");
  const parsed = parseReferencePicturePlan(JSON.parse(json));
  if (!parsed) fail("parseReferencePicturePlan rejected the plan");

  const fitted = plan.width <= 760 && plan.height <= 600 && (plan.width === 760 || plan.height === 600);
  if (!fitted) fail(`plan size ${plan.width}x${plan.height} is not a fit inside 760x600`);
  const picture = await decodeRgb(first.picturePng);
  if (picture.width !== plan.width || picture.height !== plan.height) fail(`picture is ${picture.width}x${picture.height}, plan is ${plan.width}x${plan.height}`);

  const { mask, problems } = await decodeInkMask(plan);
  problems.forEach(fail);
  const maskCount = mask.reduce((sum, v) => sum + v, 0);
  if (maskCount !== stats.inkPixels) fail(`inkMask holds ${maskCount} pixels, stats say ${stats.inkPixels}`);
  if (expect.expectInk && maskCount === 0) fail("no line work found");

  const paper = [1, 3, 5].map((i) => parseInt(plan.paper.slice(i, i + 2), 16)) as [number, number, number];
  if (expect.paper && paper.some((v, c) => Math.abs(v - expect.paper!.rgb[c]!) > expect.paper!.tolerance)) fail(`paper ${plan.paper}, expected about rgb(${expect.paper.rgb.join(",")})`);

  // The fill must reveal every pixel the outline does not and the card cannot stand in for.
  const n = plan.width * plan.height;
  const fillTarget = new Uint8Array(n);
  let paperLike = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(picture.rgb[i * 3]! - paper[0]) + Math.abs(picture.rgb[i * 3 + 1]! - paper[1]) + Math.abs(picture.rgb[i * 3 + 2]! - paper[2]);
    if (d < PAPER_LIKE) paperLike++;
    else if (!mask[i]) fillTarget[i] = 1;
  }
  if (expect.minVisible !== undefined && 1 - paperLike / n < expect.minVisible) fail(`only ${((1 - paperLike / n) * 100).toFixed(1)}% of a full bleed picture reads as not paper`);

  const outlineCoverage = independentCoverage(mask, plan.width, plan.height, plan.outline.strokes, plan.outline.brushPx / 2);
  const fillCoverage = independentCoverage(fillTarget, plan.width, plan.height, plan.fill.strokes, plan.fill.brushPx / 2);
  if (outlineCoverage < MIN_COVERAGE || stats.outlineCoverage < MIN_COVERAGE) fail(`outline coverage ${outlineCoverage.toFixed(4)} (stats ${stats.outlineCoverage.toFixed(4)})`);
  if (fillCoverage < MIN_COVERAGE || stats.fillCoverage < MIN_COVERAGE) fail(`fill coverage ${fillCoverage.toFixed(4)} (stats ${stats.fillCoverage.toFixed(4)})`);
  if (expect.expectFill === true && plan.fill.strokes.length === 0) fail("no fill strokes for a coloured picture");
  if (expect.expectFill === false && plan.fill.strokes.length > 0) fail(`${plan.fill.strokes.length} fill strokes for line art on paper`);

  // Mutations: the recomputation must notice half the strokes going missing.
  if (plan.outline.strokes.length >= 2 && independentCoverage(mask, plan.width, plan.height, halve(plan.outline.strokes), plan.outline.brushPx / 2) >= MIN_COVERAGE) fail("outline mutation (half the strokes) still passes coverage");
  if (plan.fill.strokes.length >= 2 && independentCoverage(fillTarget, plan.width, plan.height, halve(plan.fill.strokes), plan.fill.brushPx / 2) >= MIN_COVERAGE) fail("fill mutation (half the strokes) still passes coverage");

  if (plan.outline.strokes.length > OUTLINE_STROKE_CAP) fail(`${plan.outline.strokes.length} outline strokes > ${OUTLINE_STROKE_CAP}`);
  if (plan.fill.strokes.length > FILL_STROKE_CAP) fail(`${plan.fill.strokes.length} fill strokes > ${FILL_STROKE_CAP}`);
  for (const pass of ["outline", "fill"] as const) {
    const { strokes, brushPx, lengthPx } = plan[pass];
    const slack = pass === "fill" ? brushPx : 0;
    const bad = strokes.find((s) => s.some((v, i) => !Number.isInteger(v) || v < -slack || v > (i % 2 === 0 ? plan.width : plan.height) + slack));
    if (bad) fail(`${pass} stroke with a non integer or out of range coordinate: ${bad.slice(0, 8).join(",")}`);
    const sum = Math.round(strokes.reduce((total, s) => total + polylineLength(s), 0));
    if (sum !== lengthPx) fail(`${pass}.lengthPx ${lengthPx}, strokes sum to ${sum}`);
  }
  if (stats.planBytes !== Buffer.byteLength(json)) fail(`stats.planBytes ${stats.planBytes}, JSON is ${Buffer.byteLength(json)}`);
  if (stats.planBytes > PLAN_BYTES_BUDGET) fail(`plan is ${stats.planBytes} bytes > ${PLAN_BYTES_BUDGET}`);
  if (stats.ms > SLOW_MS) fail(`took ${stats.ms} ms`);

  // The record built from this plan must give board commands the board parser accepts.
  const commands = referencePictureCommands({ id: "rp_000000000000000000000000", plan: { width: plan.width, height: plan.height, outlineLengthPx: plan.outline.lengthPx, fillLengthPx: plan.fill.lengthPx } });
  if (!commands.every((c) => parsePictureCommandParams(c.params))) fail("referencePictureCommands gave params parsePictureCommandParams rejects");

  console.log(
    `${failures.length ? "FAIL" : "ok  "} ${name}: ${plan.width}x${plan.height} paper ${plan.paper}, ink ${stats.inkPixels}px, outline ${stats.outlineStrokes} strokes (cover ${outlineCoverage.toFixed(4)}), fill ${stats.fillStrokes} strokes bw ${plan.fill.brushPx} (cover ${fillCoverage.toFixed(4)}), ${stats.planBytes} B, ${stats.ms} ms`,
  );
  return failures;
}

async function main(): Promise<void> {
  const failures: string[] = [];
  for (const c of CASES) failures.push(...(await check(c.name, await c.input(), c)));
  for (const file of process.argv.slice(2)) failures.push(...(await check(path.basename(file), readFileSync(file), {})));
  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`\nverify-reference-picture-stroke-plan: ${CASES.length + process.argv.length - 2} pictures ok`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
