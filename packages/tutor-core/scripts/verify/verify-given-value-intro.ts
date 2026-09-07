import { WORK_ZONE, measureTextWidth, workRowFontSize } from "@heytutor/drawing";
import {
  buildGivenValueSegments,
  collectQuestionGivens,
  givenValuesPromptAddon,
} from "../../src/llm/givenValueIntro";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const mirrorQuestion =
  "Concave mirror, f = 15 cm, object at 20 cm. Locate the image and draw the ray diagram.";
const mirrorPlan = {
  givens: [
    { id: "f", symbol: "f", value: 15, unit: "cm", provenance: "given", sourceText: "f = 15 cm" },
    { id: "u", symbol: "u", value: 20, unit: "cm", provenance: "given", sourceText: "object at 20 cm" },
  ],
  unknowns: [{ id: "v", symbol: "v", unit: "cm" }],
};
const mirrorGivens = collectQuestionGivens(mirrorQuestion, mirrorPlan);
assert(mirrorGivens.some((given) => given.board === "f = 15 cm"), "mirror focal length was not listed as given");
assert(mirrorGivens.some((given) => given.board === "u = 20 cm"), "object distance was not listed as given");
assert(!mirrorGivens.some((given) => /^v\s*=/i.test(given.board)), "the asked image distance must not be listed as given");
const mirrorSegments = buildGivenValueSegments(mirrorQuestion, mirrorPlan, {
  maxWidth: WORK_ZONE.fullWidthTextWidth,
});
assert(
  mirrorSegments.length === 1,
  "two short givens must still open as one board line when the board is free",
);
assert(mirrorSegments[0]?.command?.type === "WRITE", "given values must be written in the work area");
assert(
  mirrorSegments[0]?.command?.text === "Given: f = 15 cm, u = 20 cm",
  `unexpected given board text: ${mirrorSegments[0]?.command?.text}`,
);
assert(/^Given\.\.\. f equals 15 centimeters/.test(mirrorSegments[0]?.narration ?? ""), "given values must be spoken");
assert(mirrorSegments[0]?.narration.includes("u equals 20 centimeters"), "every given value must be spoken");
assert(
  (mirrorSegments[0]?.narration ?? "").includes("Given..."),
  "the opener must breathe after Given before the first value",
);

const currentQuestion = "A circuit has i = 2 A and v = 10 V. Find the resistance.";
const currentGivens = collectQuestionGivens(currentQuestion);
assert(currentGivens.some((given) => given.board === "i = 2 A"), "current i was not taken from the question");
assert(currentGivens.some((given) => given.board === "v = 10 V"), "voltage v was not taken from the question");

const calculusQuestion = "If dy/dx = 2x and y = 0 at x = 0, find y at x = 2.";
const calculusGivens = collectQuestionGivens(calculusQuestion);
assert(calculusGivens.some((given) => given.board === "dy/dx = 2x"), "the given derivative was not listed");

const particleQuestion =
  "A particle moves on the line s = t^3 - 6t^2 + 9t, with s in metres and t in seconds. Find its velocity at t = 2.";
const particleSegments = buildGivenValueSegments(particleQuestion);
assert(
  /^Given\.\.\. s equals t cubed, minus 6 t squared, plus 9 t\.$/.test(particleSegments[0]?.narration ?? ""),
  `particle given speech should breathe and name terms: ${particleSegments[0]?.narration}`,
);

const equationQuestion = "Solve 2x + 3 = 7.";
const equationSegments = buildGivenValueSegments(equationQuestion);
assert(equationSegments[0]?.command?.text === "Given: 2x + 3 = 7", "the stated equation must open the board");

const conceptual = collectQuestionGivens("Explain the photoelectric effect.");
assert(conceptual.length === 0, "a concept question with no values must not invent givens");
assert(buildGivenValueSegments("Explain the photoelectric effect.").length === 0, "concept questions must skip the given opener");

assert(givenValuesPromptAddon(true).includes("already wrote the given"), "teaching must be told not to rewrite givens");
assert(
  givenValuesPromptAddon(true).includes("general formula"),
  "teaching must be told to write the general formula before substitution",
);
assert(givenValuesPromptAddon(false) === "", "empty given addon leaked into a concept lesson");
assert(
  /\[EMPHASIZE:last\] to box/.test(givenValuesPromptAddon(true)),
  "the given-values addon must say EMPHASIZE boxes a work line",
);
assert(
  !/EMPHASIZE[^\n.]*underline/i.test(givenValuesPromptAddon(true)),
  "the given-values addon must not claim EMPHASIZE underlines",
);

const derivedOnly = collectQuestionGivens(mirrorQuestion, {
  givens: [{ id: "v", symbol: "v", value: 60, unit: "cm", provenance: "derived" }],
  unknowns: [{ id: "v", symbol: "v" }],
});
assert(!derivedOnly.some((given) => given.symbol === "v"), "derived results must not be presented as givens");

// ---------------------------------------------------------------------------
// Ungrounded planner givens. Recorded from a real turn (Langfuse
// af3bc388, 3 Sep 2026): asked "Me the first law of physics with an example
// problem", the planner returned a complete friction problem — F = 10 N,
// m = 2 kg, mu = 0.2, g = 9.8 — every row marked provenance "given" with a
// confident sourceText. All four reached the board as "Given: F = 10 N,
// m = 2 kg" before a word was spoken, so the student was handed numbers they
// had never mentioned. The old guard let them through because it fell back to
// a substring test on the symbol, and "m" is inside "the first law of physics".

const inventedQuestion = "Me the first law of physics with an example problem";
const inventedPlan = {
  givens: [
    { id: "m", symbol: "m", value: 2, unit: "kg", provenance: "given", sourceText: "mass of the block" },
    { id: "F", symbol: "F", value: 10, unit: "N", provenance: "given", sourceText: "applied horizontal force" },
    { id: "mu", symbol: "μ", value: 0.2, unit: "dimensionless", provenance: "given", sourceText: "coefficient of kinetic friction" },
    { id: "g", symbol: "g", value: 9.8, unit: "m/s^2", provenance: "given", sourceText: "standard gravitational acceleration" },
  ],
  unknowns: [{ id: "a", symbol: "a", unit: "m/s^2" }],
};
const invented = collectQuestionGivens(inventedQuestion, inventedPlan);
assert(
  invented.length === 0,
  `a question stating no numbers can have no givens, got: ${invented.map((g) => g.board).join(", ")}`,
);
assert(
  buildGivenValueSegments(inventedQuestion, inventedPlan).length === 0,
  "an invented given list must not open the lesson",
);

// The same trap one letter at a time: a symbol that happens to appear inside a
// word of the question is not the question stating that value.
const substringTrap = collectQuestionGivens("What is momentum in physics", {
  givens: [{ id: "m", symbol: "m", value: 7, unit: "kg", provenance: "given", sourceText: "mass" }],
});
assert(substringTrap.length === 0, "a symbol found inside a word is not a stated given");

// An assumed constant is not a given even in a question that does state values.
const withConstant = collectQuestionGivens("A 2 kg block is pushed. Find the acceleration.", {
  givens: [
    { id: "m", symbol: "m", value: 2, unit: "kg", provenance: "given", sourceText: "2 kg block" },
    { id: "g", symbol: "g", value: 9.8, unit: "m/s^2", provenance: "given", sourceText: "gravity" },
  ],
});
assert(withConstant.some((g) => g.board === "m = 2 kg"), "a value the question states must survive");
assert(
  !withConstant.some((g) => g.symbol === "g"),
  "9.8 is nowhere in the question, so it is an assumption, not a given",
);

// Unit normalisation must not read as invention: "20 cm" in the question and
// 0.2 m in the plan are one stated fact.
const rescaled = collectQuestionGivens("An object sits at 20 cm from the lens. Find the image.", {
  givens: [{ id: "u", symbol: "u", value: 0.2, unit: "m", provenance: "given", sourceText: "20 cm" }],
});
assert(
  rescaled.some((g) => g.symbol === "u"),
  "a stated value normalised to SI must still count as given",
);

// A concept lesson opens on the idea, not on a list of numbers.
for (const conceptual of [
  "Explain Newton's first law of motion with an example",
  "What is the photoelectric effect?",
  "Describe how a transformer works",
]) {
  assert(
    collectQuestionGivens(conceptual, {
      givens: [{ id: "m", symbol: "m", value: 2, unit: "kg", provenance: "given", sourceText: "mass" }],
    }).length === 0,
    `a concept lesson must not open with a Given list: ${conceptual}`,
  );
}

// The concept skip must hold on its own, not merely because the numbers are
// absent: an explain-request that *does* name a value still opens on the idea.
// Without this case the value check alone carries every concept assertion above
// and the skip could be deleted unnoticed.
const conceptWithNumber = collectQuestionGivens(
  "Explain Newton's second law using a 2 kg block as an example",
  { givens: [{ id: "m", symbol: "m", value: 2, unit: "kg", provenance: "given", sourceText: "2 kg block" }] },
);
assert(
  conceptWithNumber.length === 0,
  `an explain request opens on the idea, not a Given list, got: ${conceptWithNumber.map((g) => g.board).join(", ")}`,
);

// The ordinary path still works: a stated problem keeps its givens.
assert(
  collectQuestionGivens(
    "Three 12 ohm resistors in series. Find the equivalent resistance.",
    { givens: [{ id: "R", symbol: "R", value: 12, unit: "Ω", provenance: "given", sourceText: "12 ohm" }] },
  ).some((g) => g.board === "R = 12 Ω"),
  "a value written in the question must still reach the board",
);

// ---------------------------------------------------------------------------
// The given list must FIT the work column.
//
// Recorded from a live turn on 4 Sep 2026: "Light enters glass at 45 deg with
// n = 1.5" produced the single line
//   "Given: θ_i = 45 deg, n_glass = 1.5 dimensionless, n = 1.5"
// which is 861px wide against a 300px column, so it was drawn straight across
// the board and through the ray diagram. Nothing downstream reflows ink — the
// layout clamps the rect it registers, not the strokes — so the list has to
// arrive already fitted.

const refractionQuestion =
  "Light enters glass at 45 deg with n = 1.5. Find the angle of refraction and draw both rays.";
const refractionPlan = {
  givens: [
    { id: "theta_i", symbol: "θ_i", value: 45, unit: "deg", provenance: "given", sourceText: "45 deg" },
    { id: "n_glass", symbol: "n_glass", value: 1.5, unit: "dimensionless", provenance: "given", sourceText: "n = 1.5" },
    { id: "n", symbol: "n", value: 1.5, unit: "dimensionless", provenance: "given", sourceText: "n = 1.5" },
  ],
  unknowns: [{ id: "theta_r", symbol: "θ_r" }],
};

const refractionSegments = buildGivenValueSegments(refractionQuestion, refractionPlan, {
  maxWidth: WORK_ZONE.maxTextWidth,
});
assert(refractionSegments.length > 0, "a question stating values must open with them");
for (const segment of refractionSegments) {
  const text = segment.command?.text ?? "";
  // Measured at the size the narrow column is actually written at, which is
  // the size the row was grouped against.
  const width = measureTextWidth(text, workRowFontSize(WORK_ZONE.maxTextWidth));
  assert(
    width <= WORK_ZONE.maxTextWidth,
    `a given row must fit the work column (${WORK_ZONE.maxTextWidth}px), got ${Math.round(width)}px: "${text}"`,
  );
  assert(
    (segment.narration ?? "").trim().length > 0,
    `every given row must be spoken as it is written, "${text}" was silent`,
  );
}
assert(
  refractionSegments[0]?.command?.text?.startsWith("Given: "),
  "only the first row carries the lead",
);
assert(
  !refractionSegments.slice(1).some((s) => (s.command?.text ?? "").includes("Given:")),
  "continuation rows must not repeat the lead",
);
assert(
  refractionSegments[0]?.narration?.startsWith("Given..."),
  "only the first row speaks the opener",
);

const refractionBoard = refractionSegments.map((s) => s.command?.text ?? "").join(" | ");
assert(
  !/dimensionless/i.test(refractionBoard),
  `a unitless quantity must not print its "unit": ${refractionBoard}`,
);
// n_glass = 1.5 and n = 1.5 are one refractive index, not two.
assert(
  refractionSegments.filter((s) => (s.command?.text ?? "").includes("1.5")).length === 1,
  `the same quantity must be listed once: ${refractionBoard}`,
);
assert(/θ/.test(refractionBoard), "the angle symbol must survive to the board");

// A long list wraps rather than overflowing.
const manyGivens = buildGivenValueSegments(
  "A block: m = 2 kg, u = 5 m/s, a = 3 m/s^2, t = 4 s, F = 10 N. Find the distance.",
  null,
  { maxWidth: WORK_ZONE.maxTextWidth },
);
assert(manyGivens.length >= 2, "a list too long for one row must wrap onto more rows");
for (const segment of manyGivens) {
  const width = measureTextWidth(
    segment.command?.text ?? "",
    workRowFontSize(WORK_ZONE.maxTextWidth),
  );
  assert(
    width <= WORK_ZONE.maxTextWidth,
    `every wrapped row must fit: ${Math.round(width)}px for "${segment.command?.text}"`,
  );
}

// The full-width column is a different size, and the list is grouped against
// that one instead — the same two values that need two narrow rows share one.
const wideGivens = buildGivenValueSegments(
  "A block: m = 2 kg, u = 5 m/s, a = 3 m/s^2, t = 4 s, F = 10 N. Find the distance.",
  null,
  { maxWidth: WORK_ZONE.fullWidthTextWidth },
);
assert(
  wideGivens.length < manyGivens.length,
  "with no figure the given list must use the width it has instead of wrapping as if a figure were there",
);
for (const segment of wideGivens) {
  const width = measureTextWidth(
    segment.command?.text ?? "",
    workRowFontSize(WORK_ZONE.fullWidthTextWidth),
  );
  assert(
    width <= WORK_ZONE.fullWidthTextWidth,
    `every full-width row must fit: ${Math.round(width)}px for "${segment.command?.text}"`,
  );
}

console.log("given value intro verification passed");
