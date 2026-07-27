import { textToStrokePaths, measureTextWidth, normalizeStrokeText } from "@heytutor/drawing";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

let passed = 0;
async function check(label: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed++;
  console.log(`  ✓ ${label}`);
}

async function strokeCount(text: string): Promise<number> {
  const glyphs = await textToStrokePaths(text, 0, 0, 40);
  return glyphs.reduce((n, g) => n + g.strokes.length, 0);
}

console.log("Phase A — Written math notation (board must draw every symbol)\n");

// Every operator / relation / set symbol must render as real ink, never a blank gap.
const MATH_SYMBOLS = [
  "∫", "∮", "∑", "∏", "√", "∞", "∂", "∇",
  "→", "←", "↔", "⇒", "⇐", "⇌", "∝", "∴", "∵",
  "±", "∓", "×", "÷", "·", "≤", "≥", "≈", "≠", "≡",
  "∈", "∉", "⊂", "⊆", "⊃", "⊇", "∪", "∩", "∅", "∠", "⊥", "∥", "∀", "∃",
  "°", "′", "″",
];

for (const sym of MATH_SYMBOLS) {
  await check(`${sym} renders ink (no blank glyph)`, async () => {
    assert((await strokeCount(sym)) >= 1, `${sym} rendered as a blank gap`);
  });
}

// Greek variables that used to fall back to Latin must still render.
for (const sym of ["π", "θ", "Δ", "Ω", "μ", "λ", "ρ", "σ", "α", "β", "ω", "φ"]) {
  await check(`${sym} greek renders ink`, async () => {
    assert((await strokeCount(sym)) >= 1, `${sym} rendered as a blank gap`);
  });
}

// A representative calculus line must have ink for its integral and radical.
await check("∫ x^2 dx line has integral ink", async () => {
  assert((await strokeCount("∫ x^2 dx = x^3/3 + C")) >= 4, "integral line under-rendered");
});

await check("√ radical line has ink", async () => {
  assert((await strokeCount("v = √(u^2 + 2as)")) >= 4, "radical line under-rendered");
});

await check("LaTeX integral braces normalize to paren script groups", () => {
  assert(
    normalizeStrokeText("∫_{-2}^{2}(4-x^2)dx") === "∫_(-2)^(2)(4-x^2)dx",
    "LaTeX integral limits were not rewritten",
  );
  assert(
    normalizeStrokeText("\\int_{-2}^{2} x dx") === "∫_(-2)^(2) x dx",
    "\\int command was not rewritten",
  );
  assert(
    normalizeStrokeText("∫{-2}{2}(4-x^2)dx") === "∫_(-2)^(2)(4-x^2)dx",
    "bare brace limits were not rewritten",
  );
});

await check("definite integral does not draw literal braces", async () => {
  for (const sample of [
    "A = ∫_{-2}^{2}(4 - x^2) dx",
    "A = ∫{-2}{2}(4 - x^2) dx",
    "A = ∫ { -2 } { 2 } (4 - x^2) dx",
  ]) {
    const glyphs = await textToStrokePaths(sample, 0, 0, 32);
    assert(!glyphs.some((glyph) => glyph.char === "{" || glyph.char === "}"), `literal braces leaked for ${sample}`);
    const integral = glyphs.find((glyph) => glyph.char === "∫");
    assert(integral, `integral glyph missing for ${sample}`);
    const upperTwos = glyphs.filter((glyph) => glyph.char === "2" && glyph.y < (integral?.y ?? 0));
    const lowerMinus = glyphs.find((glyph) => glyph.char === "-" && glyph.y > (integral?.y ?? 0));
    assert(upperTwos.length >= 1, `upper limit missing for ${sample}`);
    assert(lowerMinus, `lower limit missing for ${sample}`);
    assert(
      Math.abs((lowerMinus?.x ?? 0) - (upperTwos[0]?.x ?? 99)) < 8,
      `limits not stacked for ${sample}`,
    );
  }
});

// measureTextWidth must account for synthetic math glyphs (nonzero advance),
// otherwise layout/centering would collapse symbols on top of neighbours.
await check("measureTextWidth counts math glyph advance", () => {
  const withSym = measureTextWidth("a ∫ b", 32);
  const withoutSym = measureTextWidth("a  b", 32);
  assert(withSym > withoutSym, "∫ contributed no width to measurement");
});

console.log(`\n───────────────────────────────────`);
console.log(`All ${passed} written-notation checks passed ✓`);
