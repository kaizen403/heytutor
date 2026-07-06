import { textToStrokePaths, measureTextWidth } from "@heytutor/drawing";

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

// measureTextWidth must account for synthetic math glyphs (nonzero advance),
// otherwise layout/centering would collapse symbols on top of neighbours.
await check("measureTextWidth counts math glyph advance", () => {
  const withSym = measureTextWidth("a ∫ b", 32);
  const withoutSym = measureTextWidth("a  b", 32);
  assert(withSym > withoutSym, "∫ contributed no width to measurement");
});

console.log(`\n───────────────────────────────────`);
console.log(`All ${passed} written-notation checks passed ✓`);
