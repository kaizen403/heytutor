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
const oxidationQuestion =
  "In NaCl, sodium has valence 1 and oxidation state +1. Oxidation state is not formal charge.";
const oxidationPlan = {
  givens: [
    { id: "valence_Na", symbol: "valence(Na)", value: 1, unit: "", provenance: "given", sourceText: "1" },
    { id: "ox_Na", symbol: "ox(Na,NaCl)", value: 1, unit: "", provenance: "given", sourceText: "+1" },
  ],
};
const oxidationGivens = collectQuestionGivens(oxidationQuestion, oxidationPlan);
assert(
  oxidationGivens.some((given) => given.board === "valence(Na) = 1"),
  "valence stays an unsigned count",
);
assert(
  oxidationGivens.some((given) => given.board === "ox(Na,NaCl) = +1"),
  "an oxidation state stated as +1 must keep the sign",
);

// Equal numbers in a shared source sentence still belong to separate givens.
for (const sourceText of [
  "sodium has valence 1 and oxidation state +1",
  "sodium has oxidation state +1 and valence 1",
]) {
  const givens = collectQuestionGivens(`${sourceText}. Find the oxidation state.`, {
    givens: [
      { id: "valence_Na", symbol: "valence(Na)", value: 1, unit: "", provenance: "given", sourceText },
      { id: "ox_Na", symbol: "ox(Na,NaCl)", value: 1, unit: "", provenance: "given", sourceText },
    ],
  });
  assert(givens.some((given) => given.board === "valence(Na) = 1"), `${sourceText}: valence remains unsigned`);
  assert(givens.some((given) => given.board === "ox(Na,NaCl) = +1"), `${sourceText}: oxidation state retains its own plus`);
  const labeled = collectQuestionGivens(`${sourceText}. Find the oxidation state.`, {
    givens: [{ id: "q", symbol: "q", label: "oxidation state", value: 1, provenance: "given", sourceText }],
  });
  assert(labeled.some((given) => given.board === "q = +1"), `${sourceText}: a source label identifies the given's own occurrence`);
}

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

assert(givenValuesPromptAddon(true).includes("wrote the given quantities"), "teaching must be told not to rewrite givens");
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

// A row claims the question stated this value as this quantity. Recorded home
// suggestion cards, 3 Nov 2026 (lane 2 round): a term of an equation, a stem
// fragment, and plan symbols over a vector's components all reached the board.
const boardRows = (question: string, plan?: { givens: unknown[]; unknowns?: unknown[] }) =>
  collectQuestionGivens(question, plan).map((given) => given.board);
const plain = (symbol: string, value: number, unit = "") => ({ id: symbol, symbol, value, unit, provenance: "given", sourceText: String(value) });
for (const [why, question, plan, expected] of [
  ["a term of an equation is not a given", "Derive the quadratic formula from ax^2 + bx + c = 0 by completing the square.", { givens: [plain("c", 0)] }, []],
  ["a limit and its stem fragment are not givens", "Derive the area under y = x^2 from x = 0 to x = 2 using integration.", { givens: [plain("b", 2)] }, []],
  ["a tuple's numbers are not a plan's a, b and c", "Vectors (3, 4) and (1, -2) are given. Find their dot product and the angle between them.", { givens: [plain("a", 3), plain("b", 4), plain("c", 1)] }, []],
  ["an exponent is not a given", "Find the middle term in the expansion of (x + y)^6.", { givens: [plain("n", 6)] }, []],
  ["a coefficient is not a given", "Let a = i + 2j and b = 2i - j. Find a + b.", { givens: [plain("a_y", 2), plain("b_x", 2)] }, ["a = i + 2j", "b = 2i - j"]],
  ["a number held by another symbol is not this one", "The circle has r = 4 and passes through the origin. Find its area.", { givens: [plain("q", 4)] }, ["r = 4"]],
  ["a term of an inequality is not a constant", "Show -3x + 6 > 0 on a number line.", { givens: [plain("constant", 6)] }, []],
  ["a number beside a unit of another kind is another quantity", "A 2 kg mass moves at 3 m/s. Find its momentum.", { givens: [plain("t", 2, "s"), plain("m", 2, "kg"), plain("v", 3, "m/s")] }, ["m = 2 kg", "v = 3 m/s"]],
  ["a unitless plan row is not the value with a unit", "A 2 kg mass rests. Find its weight.", { givens: [plain("n", 2)] }, []],
  ["an ordinal is not a given", "Find the 12th term of the sequence.", { givens: [plain("n", 12)] }, []],
  ["an identifier's digit is not a given", "A flask holds SF4 at room temperature. Find the pressure.", { givens: [plain("x", 4)] }, []],
  ["a term with a plain value on its right", "Plot ax^2 + bx + c = 0, with a = 1.", undefined, ["a = 1"]],
  ["a limit with a plain value", "Integrate y from x = 0 to x = 2.", undefined, []],
  ["a coefficient the plan quotes", "A force 3i acts on a body.", { givens: [{ ...plain("a", 3), sourceText: "3i" }] }, []],
  ["prose after a value keeps it off the board", "If x = 3 is the root, draw it.", undefined, []],
  // Right rows stay.
  ["a stated value with its unit", "Concave mirror, f = 15 cm, object at 20 cm. Locate the image.", { givens: [plain("f", 15, "cm"), plain("u", 20, "cm")] }, ["f = 15 cm", "u = 20 cm"]],
  ["a unit written another way", "A wave moves at 2 m/s^2 past a 12 ohm load. Find the time.", { givens: [plain("a", 2, "m/s²"), plain("R", 12, "Ω")] }, ["a = 2 m/s²", "R = 12 Ω"]],
  ["a superscript and a caret", "An area of 4 m^2 is used.", { givens: [plain("A", 4, "m²")] }, ["A = 4 m²"]],
  ["a rescaled unit", "A 20 cm rod. Find its mass.", { givens: [plain("L", 0.2, "m")] }, ["L = 0.2 m"]],
  ["a percent read as a fraction", "A reaction is 50% complete. Find the time.", { givens: [plain("x", 0.5)] }, ["x = 0.5"]],
  ["a count with its noun", "A 40-turn coil is used. Find the flux.", { givens: [plain("N", 40)] }, ["N = 40"]],
  ["a glued unit", "A 20cm rod and a 9V cell. Find the current.", { givens: [plain("L", 20, "cm"), plain("V", 9, "V")] }, ["L = 20 cm", "V = 9 V"]],
  ["a plain count", "An AP has first term 3 and common difference 5. Find the sum.", { givens: [plain("a", 3), plain("d", 5)] }, ["a = 3", "d = 5"]],
  ["a question's own symbol for its value", "Take g = 10 m/s^2. Find the time.", { givens: [plain("g", 10, "m/s²")] }, ["g = 10 m/s²"]],
  ["a bare equation", "Solve 2x + 3 = 7.", undefined, ["2x + 3 = 7"]],
  ["an expression with products", "Given y = ax^2 + bx + c and a = 2. Plot it.", undefined, ["y = ax^2 + bx + c", "a = 2"]],
  ["a value with the place it holds", "If y = 0 at x = 0, plot it.", undefined, ["y = 0 at x = 0", "x = 0"]],
] as const) {
  const rows = boardRows(question, plan as { givens: unknown[] } | undefined);
  assert(JSON.stringify(rows) === JSON.stringify(expected), `${why}: ${JSON.stringify(rows)}`);
}

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

const matrixIntro = collectQuestionGivens("A=[[1,2],[3,4]]. A is a square matrix. Show A and state its type.");
assert(matrixIntro.some((given) => given.symbol === "A" && given.board === "A = [[1,2],[3,4]]"), "matrix commas must preserve the complete source given");
assert(!matrixIntro.some((given) => given.board === "A = [[1" || given.spoken === "A equals [[1"), "matrix intro must never assert a truncated supplied value");
const tupleIntro = collectQuestionGivens("r=(1,2,3), m=2 kg; F=(3+4) N. Find the magnitude.");
assert(tupleIntro.some((given) => given.board === "r = (1,2,3)"), "tuple commas belong inside the supplied vector value");
assert(tupleIntro.some((given) => given.board === "m = 2 kg") && tupleIntro.some((given) => given.board === "F = (3+4) N"), "structured values must preserve adjacent scalar assignments");
const nestedIntro = collectQuestionGivens("A=[[1,2],[3,4]], r=([1,2],{3,4}) and t=5 s. Find t.");
assert(nestedIntro.some((given) => given.board === "A = [[1,2],[3,4]]"), "nested matrix brackets must be read atomically");
assert(nestedIntro.some((given) => given.board === "r = ([1,2],{3,4})"), "nested mixed delimiters must not split provided tuples");
const longMatrix = `A=[${Array.from({ length: 6 }, () => "[1,1,1,1,1,1]").join(",")}]. Show A.`;
assert(!collectQuestionGivens(longMatrix).some((given) => given.symbol === "A"), "an oversized intro value must be omitted rather than asserted as a clipped source matrix");
assert(collectQuestionGivens("A=[[1,2],[3,4]. Show A.").length === 0, "unbalanced source values must not become supplied intro facts");
// A written plus survives any decimal spelling; addition is not a sign.
const TERM_NOT_QUANTITY = new Set<string>(["x +2 C charge", "b = a +2 C charge", "(a) + 2", "1+1", "5 + 2", "5 +2", "x +2", "a+2", "= +2"]);
for (const [sourceText, value, board] of [
  ["+1.0", 1, "q = +1"],
  ["+1.00", 1, "q = +1"],
  ["state +1", 1, "q = +1"],
  ["a +2 C charge", 2, "q = +2"],
  ["A +2 V potential", 2, "q = +2"],
  ["the body has a +2 C charge", 2, "q = +2"],
  ["= +2", 2, "q = +2"],
  ["1", 1, "q = 1"],
  ["5 + 2", 2, "q = 2"],
  ["5 +2", 2, "q = 2"],
  ["x +2", 2, "q = 2"],
  ["a +2", 2, "q = 2"],
  ["a + 2", 2, "q = 2"],
  ["a+2", 2, "q = 2"],
  ["x +2 C charge", 2, "q = 2"],
  ["b = a +2 C charge", 2, "q = 2"],
  ["(a) + 2", 2, "q = 2"],
  ["is +2", 2, "q = +2"],
  ["+2", 0.002, "q = +0.002"],
  ["Calcium has oxidation state +2 and atomic number 20", 20, "q = 20"],
  ["Calcium has oxidation state +2 and atomic number 20", 2, "q = +2"],
  ["+2 and 20", 0.2, "q = 0.2"],
  ["1+1", 1, "q = 1"],
] as const) {
  const stated = `The value is ${sourceText}. Find q.`;
  const givens = collectQuestionGivens(stated, {
    givens: [{ id: "q", symbol: "q", value, unit: "", provenance: "given", sourceText }],
  });
  // A term of an expression ("1+1") or a number with no quantity named ("is = +2")
  // is not a stated quantity: no row for q, and never an invented plus.
  if (TERM_NOT_QUANTITY.has(sourceText)) {
    assert(!givens.some((given) => given.symbol === "q"), `"${sourceText}" is not q's value`);
    continue;
  }
  assert(givens.some((given) => given.board === board), `"${sourceText}" should give "${board}", got ${givens.map((given) => given.board).join(", ") || "nothing"}`);
}
const articleCharge = collectQuestionGivens("A particle has a +2 C charge. Find the force.", {
  givens: [{ id: "q", symbol: "q", value: 2, unit: "C", provenance: "given", sourceText: "a +2 C charge" }],
});
assert(articleCharge.some((given) => given.board === "q = +2 C"), "an article before a signed charge keeps the written plus and unit");

console.log("given value intro verification passed");
