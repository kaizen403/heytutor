import { WORK_ZONE, measureTextWidth, workRowFontSize } from "@heytutor/drawing";
import {
  boardNumber,
  buildGivenValueSegments,
  collectQuestionGivens,
  givenValuesPromptAddon,
} from "../../src/llm/givenValueIntro";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const mirrorQuestion =
  "Concave mirror, f = 15 cm, u = 20 cm. Locate the image and draw the ray diagram.";
const mirrorPlan = {
  givens: [
    { id: "f", symbol: "f", value: 15, unit: "cm", provenance: "given", sourceText: "f = 15 cm" },
    { id: "u", symbol: "u", value: 20, unit: "cm", provenance: "given", sourceText: "object at 20 cm" },
  ],
  unknowns: [{ id: "v", symbol: "v", unit: "cm" }],
};
const mirrorGivens = collectQuestionGivens(mirrorQuestion, mirrorPlan);
// A plus the question wrote stays on the number, and an unsigned count stays
// unsigned. Equal numbers in a shared source belong to separate givens.
assert(boardNumber(1, "1", ["valence(Na)"]) === "1", "valence stays an unsigned count");
assert(boardNumber(1, "+1", ["ox(Na,NaCl)"]) === "+1", "an oxidation state stated as +1 must keep the sign");
for (const sourceText of [
  "sodium has valence 1 and oxidation state +1",
  "sodium has oxidation state +1 and valence 1",
]) {
  assert(boardNumber(1, sourceText, ["valence(Na)", "valence_Na"]) === "1", `${sourceText}: valence remains unsigned`);
  assert(boardNumber(1, sourceText, ["ox(Na,NaCl)", "ox_Na"]) === "+1", `${sourceText}: oxidation state retains its own plus`);
  assert(boardNumber(1, sourceText, ["oxidation state", "q"]) === "+1", `${sourceText}: a source label identifies the given's own occurrence`);
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
assert(calculusGivens.every((given) => given.board !== "dy/dx = 2x"), "an expression is not a value: it stays for the teaching to write");

const particleQuestion =
  "A particle moves on the line s = t^3 - 6t^2 + 9t, with s in metres and t in seconds. Find its velocity at t = 2.";
assert(buildGivenValueSegments(particleQuestion).length === 0, "an expression opens no Given row");

const equationQuestion = "Solve 2x + 3 = 7.";
const equationSegments = buildGivenValueSegments(equationQuestion);
assert(equationSegments.length === 0, "an equation is not a symbol equal to a value");

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
const withConstant = collectQuestionGivens("A block with m = 2 kg is pushed. Find the acceleration.", {
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

// The plan's normalised 0.2 m is the question's 20 cm, but it is not what the
// question wrote: rows are the question's own words.
const rescaled = collectQuestionGivens("An object sits at 20 cm from the lens. Find the image.", {
  givens: [{ id: "u", symbol: "u", value: 0.2, unit: "m", provenance: "given", sourceText: "20 cm" }],
});
assert(
  !rescaled.some((g) => g.symbol === "u"),
  "a value normalised to SI is not the question's own statement",
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
  "Explain Newton's second law using m = 2 kg as an example",
  { givens: [{ id: "m", symbol: "m", value: 2, unit: "kg", provenance: "given", sourceText: "m = 2 kg" }] },
);
assert(
  conceptWithNumber.length === 0,
  `an explain request opens on the idea, not a Given list, got: ${conceptWithNumber.map((g) => g.board).join(", ")}`,
);

// A row claims the question stated this. Recorded home suggestion cards, 3 Nov
// 2026 (lane 2 round): a term of an equation, a stem fragment, and plan symbols
// over a vector's components all reached the board. A plan row is now written
// only when the question literally says that symbol equals that value with its
// unit. Losing "m = 2 kg" from "A 2 kg block" is the accepted cost.
const boardRows = (question: string, plan?: { givens: unknown[]; unknowns?: unknown[] }) =>
  collectQuestionGivens(question, plan).map((given) => given.board);
const plain = (symbol: string, value: number, unit = "") => ({ id: symbol, symbol, value, unit, provenance: "given", sourceText: String(value) });
for (const [why, question, plan, expected] of [
  // The recorded cards.
  ["a term of an equation is not a given", "Derive the quadratic formula from ax^2 + bx + c = 0 by completing the square.", { givens: [plain("c", 0)] }, []],
  ["a limit and its stem fragment are not givens", "Derive the area under y = x^2 from x = 0 to x = 2 using integration.", { givens: [plain("b", 2)] }, []],
  ["a tuple's numbers are not a plan's a, b and c", "Vectors (3, 4) and (1, -2) are given. Find their dot product and the angle between them.", { givens: [plain("a", 3), plain("b", 4), plain("c", 1)] }, []],
  // An unnamed number is never a plan symbol's value.
  ["an unnamed mass", "A 2 kg mass moves at 3 m/s. Find its momentum.", { givens: [plain("m", 2, "kg"), plain("v", 3, "m/s")] }, []],
  ["a plain count", "An AP has first term 3 and common difference 5. Find the sum.", { givens: [plain("a", 3), plain("d", 5)] }, []],
  ["a rescaled value", "A 20 cm rod. Find its mass.", { givens: [plain("L", 0.2, "m")] }, []],
  ["a percent", "A reaction is 50% complete. Find the time.", { givens: [plain("x", 0.5)] }, []],
  ["a count with its noun", "A 40-turn coil is used. Find the flux.", { givens: [plain("N", 40)] }, []],
  ["a bare exponent", "Find the middle term in the expansion of (x + y)^6.", { givens: [plain("n", 6)] }, []],
  ["part of a mixed time", "The trip takes 3 min 58 s. Find the speed.", { givens: [plain("t_min", 3, "min")] }, []],
  ["a coordinate", "Join A(1, 2) to B(4, 8). Find the slope.", { givens: [plain("x_A", 1)] }, []],
  // The symbol must be this symbol.
  ["a number held by another symbol is not this one", "The circle has r = 4 and passes through the origin. Find its area.", { givens: [plain("q", 4)] }, ["r = 4"]],
  ["M is not m", "Here M = 3 kg, at rest.", { givens: [plain("m", 3, "kg")] }, []],
  ["R_2 is not R_1", "Here R_2 = 10 Ω, at rest.", { givens: [plain("R_1", 10, "Ω")] }, []],
  ["R is not R_1", "Here R = 10 Ω, at rest.", { givens: [plain("R_1", 10, "Ω")] }, []],
  ["y at a point is not y", "Here y(0) = 4 holds.", { givens: [plain("y", 4)] }, []],
  ["a label is not the symbol", "The speed = 3 m/s here.", { givens: [{ ...plain("v", 3, "m/s"), label: "speed" }] }, []],
  ["an id is not a symbol", "A ball moves with g2 = 2 m/s, then stops.", { givens: [{ id: "g2", symbol: "gravity_component_long", value: 2, unit: "m/s", provenance: "given" }] }, []],
  ["no symbol, no row", "Here v = 2 m/s, then it stops.", { givens: [{ id: "v", value: 2, unit: "m/s", provenance: "given" }] }, []],
  // The value must be the whole value.
  ["a sum on the right", "Take x = 3 + y, then plot.", { givens: [plain("x", 3)] }, []],
  ["a glued difference on the right", "Take x = 3-y, then plot.", { givens: [plain("x", 3)] }, []],
  ["a difference on the right", "Take x = 3 - y, then plot.", { givens: [plain("x", 3)] }, []],
  ["a factor on the right", "Take x = 3(y + 1), then plot.", { givens: [plain("x", 3)] }, []],
  ["a product on the right", "Take x = 3 y, then plot.", { givens: [plain("x", 3)] }, []],
  ["a function on the right", "Take x = 3 sin y, then plot.", { givens: [plain("x", 3)] }, []],
  ["a chain", "Take x = 3 = y, then plot.", { givens: [plain("x", 3)] }, []],
  ["a bound after it", "Take x = 3 < y, then plot.", { givens: [plain("x", 3)] }, []],
  ["a glued coefficient", "Take x = 3i, then plot.", { givens: [plain("x", 3)] }, []],
  ["an ordinal", "Take n = 12th, then plot.", { givens: [plain("n", 12)] }, []],
  ["a sign is part of the value", "A body sits at x = -3 m.", { givens: [plain("x", 3, "m")] }, []],
  ["a Unicode minus too", "A body sits at x = −3 m.", { givens: [plain("x", 3, "m")] }, []],
  ["an en dash too", "A charge has q = –3 C.", { givens: [plain("q", 3, "C")] }, []],
  // The unit must be this unit.
  ["speed is not acceleration", "A car has a = 3 m/s.", { givens: [plain("a", 3, "m/s²")] }, []],
  ["minutes are not seconds", "Wait with t = 5 min.", { givens: [plain("t", 5, "s")] }, []],
  ["degrees are not metres", "The value h = 60°.", { givens: [plain("h", 60, "m")] }, []],
  ["millimolar is not molar", "A solution has c = 5 mM.", { givens: [plain("c", 5, "M")] }, []],
  ["kmph is not m/s", "A car has v = 72 kmph.", { givens: [plain("v", 72, "m/s")] }, []],
  ["a torque is not a force", "A torque has F = 10 N m.", { givens: [plain("F", 10, "N")] }, []],
  ["a unit the plan left off", "Here n = 2 kg, at rest.", { givens: [plain("n", 2)] }, []],
  ["a unit the question left off", "Here x = 3, at rest.", { givens: [plain("x", 3, "m")] }, []],
  ["a different size", "A rod has L = 20 cm.", { givens: [plain("L", 2, "cm")] }, []],
  ["the same length in metres", "A rod has L = 20 cm.", { givens: [plain("L", 0.2, "m")] }, []],
  // Rows read from the question.
  ["a function's argument is not a given", "If sin x = 1/2, plot x.", undefined, []],
  ["a product's last symbol is not a given", "Take m a = 10, then plot.", undefined, []],
  ["a coefficient's symbol is not a given", "Take 3 x = 12, then plot.", undefined, []],
  ["more function spellings", "Take cosec x = 2, then plot.", undefined, []],
  ["a squared function", "Take sin² x = 1, then plot.", undefined, []],
  ["a based logarithm", "Take log2 x = 3, then plot.", undefined, []],
  ["a glued factor", "Take 2π r = 10, then plot.", undefined, []],
  ["limits with and", "Integrate between x = 0 and x = 2.", undefined, []],
  ["limits with and, different symbols", "Integrate between x = 0 and y = 2.", undefined, []],
  ["limits with units", "Move between x = 0 m and y = 2 m, then stop.", undefined, []],
  ["a limit with a plain value", "Integrate y from x = 0 to x = 2.", undefined, []],
  ["what is to be proved is not given", "Prove that x = 2.", undefined, []],
  ["a term with a plain value on its right", "Plot ax^2 + bx + c = 0, with a = 1.", undefined, ["a = 1"]],
  ["prose after a value keeps it off the board", "If x = 3 is the root, draw it.", undefined, []],
  ["Hindi after a value is prose", "अगर x = 3 है तो ग्राफ बनाओ", undefined, []],
  ["one Hindi word after a value is prose", "अगर x = 3 है, तो ग्राफ बनाओ", undefined, []],
  ["answer options are not given", "Which is correct? (A) v = 5 m/s (B) v = 7 m/s.", { givens: [plain("v", 7, "m/s")] }, []],
  ["named options are not given", "Pick one. Options: T1 = 5, T2 = 6.", undefined, []],
  ["a value in an option is not given", "Which holds? (A) x = 5, (B) x = 7.", undefined, []],
  // Right rows stay: the question's own words.
  ["a stated value with its unit", "Concave mirror, f = 15 cm, object at 20 cm. Locate the image.", { givens: [plain("f", 15, "cm"), plain("u", 20, "cm")] }, ["f = 15 cm"]],
  ["a unit written another way", "Here a = 2 m/s^2, R = 12 ohm. Find the time.", { givens: [plain("a", 2, "m/s²"), plain("R", 12, "Ω")] }, ["a = 2 m/s²", "R = 12 Ω"]],
  ["a caret and a superscript", "Here A = 4 m^2, at rest.", { givens: [plain("A", 4, "m²")] }, ["A = 4 m²"]],
  ["a glued unit", "Here L = 20cm, V = 9V. Find the current.", { givens: [plain("L", 20, "cm"), plain("V", 9, "V")] }, ["L = 20 cm", "V = 9 V"]],
  ["a question's own symbol for its value", "Take g = 10 m/s^2. Find the time.", { givens: [plain("g", 10, "m/s²")] }, ["g = 10 m/s²"]],
  ["an aside in brackets", "A ball falls (g = 10 m/s^2) here.", { givens: [plain("g", 10, "m/s²")] }, ["g = 10 m/s²"]],
  ["named values inside brackets", "Take (a = 3, b = 4) here.", { givens: [plain("a", 3), plain("b", 4)] }, ["a = 3", "b = 4"]],
  ["degrees in words", "Here A = 30 degrees, at rest.", { givens: [plain("A", 30, "°")] }, ["A = 30 °"]],
  ["moles in words", "Here n = 2 moles, at rest.", { givens: [plain("n", 2, "mol")] }, ["n = 2 mol"]],
  ["a glued Celsius", "Heat with T = 40°C, then stop.", { givens: [plain("T", 40, "°C")] }, ["T = 40 °C"]],
  ["a glued molarity", "Take c = 0.1M, then stop.", { givens: [plain("c", 0.1, "M")] }, ["c = 0.1 M"]],
  ["a unit in words", "Here L = 2 metre, at rest.", { givens: [plain("L", 2, "m")] }, ["L = 2 m"]],
  ["a spaced compound unit", "A torque has M_t = 10 N m, then stops.", { givens: [plain("M_t", 10, "N m")] }, ["M_t = 10 N m"]],
  ["a part label is not options", "(a) Let m = 2 kg rest. Find its weight.", { givens: [plain("m", 2, "kg")] }, ["m = 2 kg"]],
  ["a symbol and its unit", "Given a = 2 kg, plot it.", undefined, ["a = 2 kg"]],
  ["a percent and a degree", "Here e = 50%, A = 30°, then stop.", undefined, ["e = 50%", "A = 30°"]],
  ["millimolar from the question", "A solution has c = 5 mM.", undefined, ["c = 5 mM"]],
  ["kmph from the question", "A car has v = 72 kmph.", undefined, ["v = 72 kmph"]],
  // Expressions are not values, however true: this is the accepted cost.
  ["a bare equation", "Solve 2x + 3 = 7.", undefined, []],
  ["a math name", "Given y = sin x. Plot it.", undefined, []],
  ["an expression with products", "Given y = ax^2 + bx + c and a = 2. Plot it.", undefined, ["a = 2"]],
  ["a letters only equation", "Write it as AX = B.", undefined, []],
  ["a chemical formula", "Draw CH2 = CH-CH2+ now.", undefined, []],
  ["a value with a place in words", "If y = 0 at x = 0, plot it.", undefined, ["x = 0"]],
] as const) {
  const rows = boardRows(question, plan as { givens: unknown[] } | undefined);
  assert(JSON.stringify(rows) === JSON.stringify(expected), `${why}: ${JSON.stringify(rows)}`);
}

// The check only removes: a refused row never makes room for another, so these
// rows cannot be new. Nine plan rows fill the list and hide the question's own.
const crowded = Array.from({ length: 9 }, (_, index) => plain(`p${index}`, 100 + index));
assert(
  JSON.stringify(boardRows("Plot the point (100, 101, 102, 103, 104, 105, 106, 107, 108) with z = 5.", { givens: crowded })) === "[]",
  "a row past the list's old limit stays off when the rows before it are refused",
);
assert(
  JSON.stringify(boardRows("Solve 2x + 3 = 7, with (3, 4) noted.", { givens: [plain("q", 3)] })) === "[]",
  "a refused plan row does not bring back the equation it used to hide",
);

// The ordinary path still works: a stated problem keeps its givens.
assert(
  collectQuestionGivens(
    "Three resistors, R = 12 ohm each, in series. Find the equivalent resistance.",
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
  "Light enters glass with θ_i = 45 deg and n_glass = 1.5. Find the angle of refraction and draw both rays.";
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
assert(matrixIntro.length === 0, "a matrix is not a plain value");
assert(!matrixIntro.some((given) => given.board === "A = [[1" || given.spoken === "A equals [[1"), "matrix intro must never assert a truncated supplied value");
const tupleIntro = collectQuestionGivens("r=(1,2,3), m=2 kg; F=(3+4) N. Find the magnitude.");
assert(!tupleIntro.some((given) => given.symbol === "r"), "a vector is not a plain value");
assert(tupleIntro.some((given) => given.board === "m = 2 kg"), "a scalar beside a vector still reads whole");
assert(!tupleIntro.some((given) => given.symbol === "F"), "an expression with a unit is not a plain value");
const nestedIntro = collectQuestionGivens("A=[[1,2],[3,4]], r=([1,2],{3,4}) and t=5 s. Find t.");
assert(JSON.stringify(nestedIntro.map((given) => given.board)) === JSON.stringify(["t = 5 s"]), "nested brackets are read whole and refused, and the scalar after them survives");
const longMatrix = `A=[${Array.from({ length: 6 }, () => "[1,1,1,1,1,1]").join(",")}]. Show A.`;
assert(!collectQuestionGivens(longMatrix).some((given) => given.symbol === "A"), "an oversized intro value must be omitted rather than asserted as a clipped source matrix");
assert(collectQuestionGivens("A=[[1,2],[3,4]. Show A.").length === 0, "unbalanced source values must not become supplied intro facts");
// A written plus survives any decimal spelling; addition is not a sign.
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
  const written = `q = ${boardNumber(value, sourceText, ["q"])}`;
  assert(written === board, `"${sourceText}" should give "${board}", got ${written}`);
}
assert(boardNumber(2, "a +2 C charge", ["q"]) === "+2", "an article before a signed charge keeps the written plus");
const signedCharge = collectQuestionGivens("A particle has q = +2 C. Find the force.", {
  givens: [{ id: "q", symbol: "q", value: 2, unit: "C", provenance: "given", sourceText: "q = +2 C" }],
});
assert(signedCharge.some((given) => given.board === "q = +2 C"), "a written plus and unit stay on the row");

console.log("given value intro verification passed");
