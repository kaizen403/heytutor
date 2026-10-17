import { requestBoardTitle } from "../../lib/boards/boardsClient";
import {
  boardNeedsGeneratedTitle,
  deriveBoardTitleFromQuestion,
  finalizeBoardTitle,
  isMetaOrInvalidBoardTitle,
} from "../../lib/boards/boardTitle";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const fbdQuestion =
  "Solve: a 5 kg box is pushed with 20 N on a surface with μ = 0.3. Find acceleration and draw the free-body diagram.";

assert(
  deriveBoardTitleFromQuestion(fbdQuestion) === "5 kg box free-body diagram",
  "FBD question should derive a concrete diagram title",
);

assert(
  isMetaOrInvalidBoardTitle("Wants A Topic Name For The Math Concept Covered By The Quest"),
  "meta LLM title should be rejected",
);

assert(
  finalizeBoardTitle(
    fbdQuestion,
    "Wants A Topic Name For The Math Concept Covered By The Quest",
  ) === "5 kg box free-body diagram",
  "bad LLM title should fall back to derived title",
);

assert(
  finalizeBoardTitle(fbdQuestion, "5 kg box free-body diagram") === "5 kg box free-body diagram",
  "good LLM title should be kept",
);

assert(
  !isMetaOrInvalidBoardTitle("Free-body diagram with friction"),
  "valid descriptive title should pass validation",
);

const refractionQuestion =
  "Light enters glass at 45 degrees with n = 1.5. Find the angle of refraction and draw both rays.";
const refractionTitle = deriveBoardTitleFromQuestion(refractionQuestion);
assert(
  refractionTitle !== "Fractions" && /light enters glass/i.test(refractionTitle),
  `refraction must not match the fractions title rule: ${refractionTitle}`,
);

assert(
  boardNeedsGeneratedTitle({ isDraft: true, title: "new board", persistedTurnCount: 0 }),
  "a draft board must be named from the first question",
);
assert(
  boardNeedsGeneratedTitle({
    isDraft: false,
    title: "Voltage divider midpoint voltage",
    persistedTurnCount: 0,
  }),
  "an empty board still carrying an abandoned title must be renamed from the question that actually runs",
);
assert(
  !boardNeedsGeneratedTitle({
    isDraft: false,
    title: "Voltage divider midpoint voltage",
    persistedTurnCount: 1,
  }),
  "a later doubt on a saved lesson must not rename the board",
);
assert(
  boardNeedsGeneratedTitle({ isDraft: false, title: "new board", persistedTurnCount: 1 }),
  "a saved lesson still titled new board must be named",
);

const ionicRadius =
  "Arrange the isoelectronic ions Na+, Mg2+ and Al3+ in order of ionic radius. State the radius convention and the nuclear-charge order.";
assert(
  deriveBoardTitleFromQuestion(ionicRadius) !== "Circle geometry",
  "an ionic radius is not circle geometry",
);
assert(
  deriveBoardTitleFromQuestion("Find the area of a circle with radius 4 cm.") === "Circle geometry",
  "a circle radius stays circle geometry",
);

const ionisation =
  "Explain the exceptions in the first ionisation enthalpy: beryllium versus boron, and nitrogen versus oxygen. The trend is not monotonic.";
assert(
  deriveBoardTitleFromQuestion(ionisation) !== "Photosynthesis",
  "oxygen the element is not photosynthesis",
);
assert(
  deriveBoardTitleFromQuestion("Explain photosynthesis in a green plant.") === "Photosynthesis",
  "a plant photosynthesis question stays photosynthesis",
);

const zeroOrder =
  "A zero-order reaction has [A]0 = 0.50 mol/L and k = 0.10 mol/L/s. Find [A] at t = 2.0 s.";
const zeroTitle = deriveBoardTitleFromQuestion(zeroOrder);
assert(
  zeroTitle.includes("0.50"),
  `a decimal in the stem must survive the title: ${zeroTitle}`,
);

// Formulas, symbols and acronyms keep the case the student wrote, first word included.
for (const [question, expected] of [
  ["NaCl dissolves in water. Why?", "NaCl dissolves in water"],
  ["Arrange Na+, Mg2+ and Al3+ by size", "Arrange Na+, Mg2+ and Al3+ by size"],
  ["Why does Ca react with cold water", "Why does Ca react with cold water"],
  ["Does H2O have a dipole moment", "Does H2O have a dipole moment"],
  ["pH of 0.01 M HCl", "pH of 0.01 M HCl"],
  ["Find V across the 4 ohm resistor", "V across the 4 ohm resistor"],
  ["Distance between points A and B on a line", "Distance between points A and B on a line"],
  ["Compare As+ and Sb+ in size", "Compare As+ and Sb+ in size"],
  ["Why is He2+ an alpha particle", "Why is He2+ an alpha particle"],
] as const) {
  const title = deriveBoardTitleFromQuestion(question);
  assert(title === expected, `formula casing: "${question}" became "${title}", wanted "${expected}"`);
}

// Ordinary words are sentence cased, including Title Case and all caps input.
for (const [question, expected] of [
  ["Motion In One Dimension Explained", "Motion in one dimension explained"],
  ["WHAT IS OHM'S LAW?", "Ohm's law"],
  ["Explain Newton's Second Law", "Newton's second law"],
  ["DNA AND RNA STRUCTURE", "DNA and RNA structure"],
  ["WHY IS AC USED INSTEAD OF DC", "Why is AC used instead of DC"],
] as const) {
  const title = deriveBoardTitleFromQuestion(question);
  assert(title === expected, `sentence casing: "${question}" became "${title}", wanted "${expected}"`);
}

for (const [question, expected] of [
  ["Explain Newton's first law", "Newton's first law"],
  ["Explain Newton's third law", "Newton's third law"],
  ["Explain Newton's law of gravitation", "Newton's law of gravitation"],
  ["Explain Newton's method for finding roots", "Newton's method for finding roots"],
  ["Explain force measured in newtons", "Force measured in newtons"],
  ["Explain the second law of thermodynamics", "Second law of thermodynamics"],
  ["Explain Newton’s 2nd law", "Newton's second law"],
  [
    "Why does a wall push back when I push it? Explain Newton's third law with a simple person-and-wall force diagram.",
    "Why does a wall push back when I push it",
  ],
  ["Explain F = ma", "Newton's second law"],
] as const) {
  assert(finalizeBoardTitle(question) === expected, `Newton titles must preserve the requested topic: ${question}`);
}

// Stripping a question prefix must not leave an ordinary all-caps title shouting.
for (const question of ["WHAT IS THERMODYNAMICS?", "THERMODYNAMICS", "EXPLAIN THERMODYNAMICS"]) {
  const title = deriveBoardTitleFromQuestion(question);
  assert(title === "Thermodynamics", `single-word sentence casing: "${question}" became "${title}"`);
}
assert(
  finalizeBoardTitle("Explain thermodynamics", "THERMODYNAMICS") === "Thermodynamics",
  "a one-word LLM title should be sentence cased too",
);

// Single-word acronyms, formulas and symbols keep their written case.
for (const written of ["CO", "NO", "DNA", "SHM", "AC", "IUPAC", "H2O", "HCHO", "HCOOH", "Na+", "Ca", "M", "M+"]) {
  const title = deriveBoardTitleFromQuestion(`WHAT IS ${written}?`);
  assert(title === written, `single-word notation: "${written}" became "${title}"`);
}

// Short formulas in multiword prose must not turn into different symbols/words.
assert(
  deriveBoardTitleFromQuestion("CO AND NO") === "CO and NO",
  "short formulas retain their case in a multiword all-caps question",
);
assert(
  finalizeBoardTitle("Compare the compounds", "CO AND NO") === "CO and NO",
  "short formulas retain their case in a generated multiword title",
);

for (const formula of ["HCHO", "HCOOH"]) {
  assert(finalizeBoardTitle("Explain the compound", formula) === formula, "formula LLM title: " + formula);
}
assert(
  deriveBoardTitleFromQuestion("WHY IS CO IN NO?") === "Why is CO in NO",
  "short grammatical words remain prose beside short formulas",
);
assert(
  deriveBoardTitleFromQuestion("CO OR NO") === "CO or NO",
  "a conjunction remains prose between short formulas",
);
assert(
  deriveBoardTitleFromQuestion("HCHO REACTIONS") === "HCHO reactions",
  "all-caps prose should sentence case words while retaining formula notation",
);
assert(
  deriveBoardTitleFromQuestion("WHAT IS PHYSICS?") === "PHYSICS",
  "an ambiguous valid element-symbol sequence retains written case",
);
assert(
  deriveBoardTitleFromQuestion("WHAT IS PRESSURE?") === "Pressure",
  "an ordinary all-caps word with invalid atom symbols is sentence cased",
);

// A sentence still ends after a number; only a decimal point is protected.
const afterNumber = deriveBoardTitleFromQuestion("A sample has pH 5. Explain its acidity.");
assert(afterNumber === "Sample has pH 5", `a period after a number must end the sentence: ${afterNumber}`);
const decimal = deriveBoardTitleFromQuestion("A ball moves at 2.5 m/s. Find its momentum.");
assert(decimal === "Ball moves at 2.5 m/s", `a decimal point must not end the sentence: ${decimal}`);

// A literal expression is not evidence that the question solves an equation.
async function verifyExpressionTitles(): Promise<void> {
  const cases = [
    ["Integrate (2x + 3)/(x^2 + 3x + 2) and explain how to spot the substitution.", "Integrate"],
    ["Differentiate 2x + 3 with respect to x.", "Differentiate"],
    ["Simplify (2x + 3)^2.", "Simplify"],
  ] as const;
  const failures: string[] = [];
  const check = (ok: unknown, message: string) => { if (!ok) failures.push(message); };
  const originalFetch = globalThis.fetch;
  let requests = 0;
  try {
    // The actual dashboard client must use the same honest title if its
    // admitted board-name route is unavailable; this never dispatches network.
    globalThis.fetch = async (url, init) => {
      assert(String(url).endsWith("/api/board-name"), "only the actual board-name consumer may request a title");
      assert(cases.some(([question]) => JSON.parse(String(init?.body)).question === question), "the naming request keeps the complete original question");
      requests++;
      return new Response(null, { status: 503 });
    };
    for (const [question, prefix] of cases) {
      const title = finalizeBoardTitle(question);
      check(title.startsWith(prefix) && title !== "Linear equation", `finalizer must preserve the actual task: ${question} -> ${title}`);
      const clientTitle = await requestBoardTitle(question);
      check(clientTitle.startsWith(prefix) && clientTitle === title, `real naming client fallback must preserve the actual task: ${question} -> ${clientTitle}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert(requests === cases.length, "each recorded/control question reaches the actual naming client");
  for (const question of ["Solve the linear equation 2x + 3 = 7.", "Show how to isolate x in 2x + 3 = 7."]) {
    check(finalizeBoardTitle(question) === "Linear equation", `explicit equation wording keeps its existing title: ${question}`);
  }
  check(finalizeBoardTitle("Solve 2x + 3 = 7.") === "2x + 3 = 7", "an ordinary equation keeps its complete source expression instead of requiring a guessed category");
  assert(failures.length === 0, `${failures.length}/9 expression-title checks failed:\n${failures.join("\n")}`);
  console.log("verify-board-title: all existing checks and 9 expression-title checks passed; actual finalizer and naming-client fallback");
}
void verifyExpressionTitles().catch(error => { console.error(error); process.exitCode = 1; });
