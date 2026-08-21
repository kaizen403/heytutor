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
const mirrorSegments = buildGivenValueSegments(mirrorQuestion, mirrorPlan);
assert(mirrorSegments.length === 1, "given values must open as one spoken board line");
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

const derivedOnly = collectQuestionGivens(mirrorQuestion, {
  givens: [{ id: "v", symbol: "v", value: 60, unit: "cm", provenance: "derived" }],
  unknowns: [{ id: "v", symbol: "v" }],
});
assert(!derivedOnly.some((given) => given.symbol === "v"), "derived results must not be presented as givens");

console.log("given value intro verification passed");
