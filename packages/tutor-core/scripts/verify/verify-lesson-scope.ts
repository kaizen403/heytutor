/**
 * Lesson length must follow the question.
 *
 * The regression this guards: every question, a one-line substitution and a
 * three-part integration problem alike, got the same short lesson and stopped
 * at the bottom of the first board page.
 */
import { BOARD_ROWS_PER_PAGE } from "../../src/llm/systemPrompt";
import {
  classifyLessonScope,
  lessonScopePromptAddon,
  resolveLessonBudget,
  type LessonScope,
} from "../../src/llm/lessonScope";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const RANK: Record<LessonScope, number> = {
  compact: 0,
  standard: 1,
  extended: 2,
  deep: 3,
};

// --- maths questions the old unit-driven classifier could not see -----------
const atLeastExtended: [string, string][] = [
  ["Evaluate the integral of x sin x dx from 0 to pi.", "integration by parts"],
  ["Prove that the square root of 2 is irrational.", "a proof"],
  ["Show that the sum of the first n odd numbers is n^2.", "a show-that proof"],
  ["Solve the differential equation dy/dx = 2xy.", "a differential equation"],
  ["Find the area bounded by y = x^2 and y = 2x.", "area between curves"],
  ["Solve 2x + 3y = 12 and 3x - y = 5.", "simultaneous equations"],
  ["Find the maxima and minima of f(x) = x^3 - 3x + 1.", "a stationary-point question"],
  ["Explain what a derivative is.", "a concept lesson"],
];
for (const [question, why] of atLeastExtended) {
  const scope = classifyLessonScope(question);
  assert(
    RANK[scope] >= RANK.extended,
    `${why} classified as "${scope}"; it needs more than one board page: ${question}`,
  );
}

// --- multi-part work is the longest band ------------------------------------
const deepQuestions = [
  "(a) Solve x^2 - 5x + 6 = 0. (b) Sketch the curve. (c) Hence find the area between the curve and the x-axis.",
  "Prove the binomial theorem for positive integer n, then expand (1 + 2x)^5 and hence find the coefficient of x^3.",
];
for (const question of deepQuestions) {
  assert(
    classifyLessonScope(question) === "deep",
    `a multi-part maths question must be deep: ${question}`,
  );
}

// --- a genuine one-liner still stays short ----------------------------------
assert(
  RANK[classifyLessonScope("What is 12 times 8?")] <= RANK.standard,
  "a trivial arithmetic question must not be inflated into a multi-page lesson",
);

// --- familiarity shifts the band, it does not replace it --------------------
const proof = "Prove that the square root of 2 is irrational.";
const revising = resolveLessonBudget(proof, "revision");
const normal = resolveLessonBudget(proof, "normal");
const harder = resolveLessonBudget(proof, "new");
assert(
  RANK[revising.scope] < RANK[normal.scope] && RANK[normal.scope] < RANK[harder.scope],
  "familiarity must move the classified band in both directions",
);
assert(
  revising.minSteps >= 12,
  `Revision collapsed a proof to ${revising.minSteps} steps; it may trim rungs of scaffolding, not the derivation`,
);

const trivial = "What is 12 times 8?";
assert(
  resolveLessonBudget(trivial, "new").maxSteps <=
    resolveLessonBudget(proof, "normal").maxSteps,
  "a one-liner at New must not outrun a proof at Normal",
);

// --- every band is longer than the old fixed 6-10 step lesson ---------------
for (const scope of ["compact", "standard", "extended", "deep"] as const) {
  const budget = resolveLessonBudget(
    scope === "compact" ? trivial : proof,
    scope === "deep" ? "new" : "normal",
  );
  assert(budget.minSteps < budget.maxSteps, `${scope} band is empty`);
}
assert(
  resolveLessonBudget(trivial, "revision").minSteps >= 8,
  "even the shortest lesson must keep the whole ladder",
);

// --- the prompt block says the board may turn the page ----------------------
const addon = lessonScopePromptAddon(resolveLessonBudget(proof, "normal"));
assert(
  /LESSON LENGTH FOR THIS QUESTION/.test(addon),
  "the budget block must be findable by the gates that assert prompts defer to it",
);
assert(
  /overrides every earlier step count/i.test(addon),
  "the budget block must outrank fast mode and the familiarity addon",
);
assert(
  /turns to a fresh page/.test(addon) && /Never compress a derivation/.test(addon),
  "the budget block must license a second board page",
);
assert(
  new RegExp(`${BOARD_ROWS_PER_PAGE} rows fit on a page`).test(addon),
  "the budget block must state the real work-column capacity",
);
assert(
  /\d+-\d+ steps/.test(addon),
  "the budget block must carry a concrete step range",
);

console.log("verify-lesson-scope: ok");
