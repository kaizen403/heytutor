/**
 * Regenerate fixtures/regression/label-ink-golden-v1.json from a checkout of
 * the drawing package whose `measureTextInkBounds` is the accepted answer.
 *
 * The fixture pins handwritten ink boxes to the measure as it stood before
 * the arithmetic fast path (origin/main 9218d38c), so a later edit to a helper
 * shared by the fast path and its printed reference cannot move both and
 * still pass `verify-label-ink-cache`. Regenerate only on purpose, when the
 * written ink itself is meant to change.
 *
 * Run: pnpm exec tsx scripts/fixtures/generate-label-ink-golden.ts <drawing-src-handwriting-dir>
 *   e.g. /path/to/origin-main-checkout/packages/drawing/src/handwriting
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { encodeInkDouble, LABEL_INK_GOLDEN_SCHEMA, type LabelInkGoldenRecord } from "../lib/labelInkGolden";

const sourceDir = process.argv[2];
if (!sourceDir) throw new Error("usage: generate-label-ink-golden.ts <drawing/src/handwriting dir>");
const handwritingPath = resolve(sourceDir, "handwriting.ts");
const { measureTextInkBounds } = await import(pathToFileURL(handwritingPath).href) as {
  measureTextInkBounds: (text: string, x: number, y: number, fontSize: number) =>
    { x: number; y: number; width: number; height: number } | null;
};

// Every glyph the font draws, every synthetic Greek, maths, fraction and
// script character the module special-cases, and two it cannot draw.
const glyphs = Object.keys(JSON.parse(readFileSync(resolve(sourceDir, "caveat-glyphData.json"), "utf8")) as object);
const tableHead = readFileSync(handwritingPath, "utf8").split("\n").slice(0, 80).join("\n");
const special = [...tableHead.matchAll(/"([^"\\])"/gu)].map((match) => match[1]!);
const characters = [...new Set([...glyphs, ...special, "☃", "€"])].sort();

const texts = [
  "", " ", "A_p", "x^(2)", "x^10", "v_0", "v_0t", "E_final", "θ=30°", "R=35.3 m", "H=5.1 m", "F_net=ma",
  "∫_0^1", "∫_(-2)^(3) f", "∑_(i=1)^n", "∏_k", "{x}", "H₂O", "CO₂", "x²+y²", "½mv²", "Fe^(3+)", "SO_4^(2-)",
  "λ/2", "Δx", "ω_0", "μ_s N", "√(2gh)", "a ≤ b", "→", "x\u0000y", "N", "mg", "T_1", "r_1 =", "12 cm",
];

// The positions the arithmetic route is most likely to get wrong: exact
// hundredth half steps, values a hair either side of them, negative zero,
// magnitudes past the exact-integer bound and past toFixed's exponent switch.
const halfSteps = [400.125, 412.005, 288.995, 0.005, -0.005, 0.015, 1159.995, 600.375, 300.625, 1.115];
const nearSteps = halfSteps.map((value, index) => value + (index % 2 === 0 ? 1e-9 : -1e-9));
const extremes = [0, -0, -1e-9, 1e-9, 1e15, -1e15, 2 ** 50 / 100, 1e21, -1e21, 1.5e300, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
const sizes = [24, 18, 14.88, 20, 32];

const calls: Array<[string, number, number, number]> = [];
for (const [index, character] of characters.entries()) {
  calls.push([character, 600, 300, 24]);
  calls.push([character, halfSteps[index % halfSteps.length]!, halfSteps[(index + 3) % halfSteps.length]!, sizes[index % sizes.length]!]);
  calls.push([`a${character}_${character}^2`, nearSteps[index % nearSteps.length]!, 300.5, 24]);
}
for (const text of texts) {
  for (const value of extremes) calls.push([text, value, 300, 24], [text, 600, value, 24], [text, 600.375, 300.625, value]);
  for (const [index, x] of [...halfSteps, ...nearSteps].entries()) calls.push([text, x, nearSteps[(index + 1) % nearSteps.length]!, sizes[index % sizes.length]!]);
}
let seed = 0x1abe1;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let index = 0; index < 1200; index++) {
  const text = texts[Math.floor(random() * texts.length)]!;
  const step = (value: number) => Math.round(value * 200) / 200 + (random() < 0.5 ? 0 : (random() - 0.5) * 1e-9);
  calls.push([text, step(400 + random() * 760), step(40 + random() * 620), sizes[index % sizes.length]!]);
}

const records: LabelInkGoldenRecord[] = calls.map(([text, x, y, fontSize]) => {
  const args = [text, encodeInkDouble(x), encodeInkDouble(y), encodeInkDouble(fontSize)] as LabelInkGoldenRecord["args"];
  try {
    const ink = measureTextInkBounds(text, x, y, fontSize);
    return { args, ink: ink ? [ink.x, ink.y, ink.width, ink.height].map(encodeInkDouble) as LabelInkGoldenRecord["ink"] : null };
  } catch (error) {
    return { args, throws: error instanceof Error ? error.message : String(error) };
  }
});

const out = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/regression/label-ink-golden-v1.json");
writeFileSync(out, `${JSON.stringify({
  schemaVersion: LABEL_INK_GOLDEN_SCHEMA,
  source: "@heytutor/drawing measureTextInkBounds at origin/main 9218d38c (printed path route)",
  characters: characters.length,
  records,
}, null, 0).replace(/\{"args"/g, "\n{\"args\"")}\n`);
console.log(`label-ink golden: ${records.length} records, ${characters.length} characters -> ${out}`);
