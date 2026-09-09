/**
 * The teaching prompt is the product.
 *
 * Every rule here was written because a measured lecture went wrong without it:
 * a tutor narrated a double slit rig during a capillary rise lesson, told a
 * student that Earth's magnetic field is one tesla because the planner invented
 * the number, and read a collision plan that created kinetic energy. The prompt
 * assembly is pure, so those rules can be asserted directly rather than waited
 * for in a live run.
 */
import { CONCEPT_LESSON_RUNTIME_ADDON, TUTOR_SYSTEM_PROMPT } from "@heytutor/tutor-core";
import { WORK_ZONE, fitBoardText } from "@heytutor/drawing";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { buildTurnTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const question =
  "A 3.0 kg cart at 4.0 m/s collides with a 1.0 kg cart at rest. The coefficient of restitution is e = 0.50. Find both velocities after the collision.";

const plan = {
  visualRequirement: "preferred",
  givens: [
    { id: "m1", symbol: "m1", value: 3, unit: "kg", provenance: "given", sourceText: "first cart" },
    { id: "u1", symbol: "u1", value: 4, unit: "m/s", provenance: "given", sourceText: "first speed" },
    // Never stated by the question. The planner marks values like this "given"
    // with a confident sourceText, and the lesson then says "the given values".
    // Quoted, not invented: the question need not supply g, and asking the
    // tutor to say "suppose g is 9.81" would be worse than the problem this
    // rule fixes.
    { id: "g", symbol: "g", value: 9.81, unit: "m/s^2", provenance: "given", sourceText: "gravity" },
    // Invented for a worked example the question never asked for. The value is
    // deliberately not a power-of-ten rescaling of any number in the question:
    // `questionStatesValue` treats 0.001 m as stated when the text says 1.0,
    // because 0.5 mm and 0.0005 m are the same given.
    { id: "d", symbol: "d", value: 7.77, unit: "m", provenance: "given", sourceText: "slit separation (typical value)" },
  ],
  unknowns: [{ id: "v1f", symbol: "v1f", unit: "m/s" }],
  derived: [{ id: "v1f", symbol: "v1f", value: 2.5, unit: "m/s" }],
  qualitativeClaims: [],
  lawIds: ["conservation_of_momentum"],
  assumptions: [],
} as unknown as TurnPlanV3;

const unchecked = buildTurnTeachingPrompt({
  question,
  diagramPromptAddon: null,
  turnPlan: plan,
  solverProjection: null,
  codeLesson: null,
  isDsa: false,
  familiarity: "normal",
  fastMode: true,
});

// Read the list itself rather than matching the line prefix, so a symbol that
// should not be there fails its own assertion instead of breaking this one.
const assumedLine = /NOT STATED BY THE QUESTION: ([^.]*)\./.exec(unchecked.systemPrompt);
const assumedList = (assumedLine?.[1] ?? "").split(",").map((entry) => entry.trim());
assert(
  assumedList.includes("d"),
  `a planner given the question never states must be handed over as an assumption, not as a given (got ${JSON.stringify(assumedList)})`,
);
assert(
  !assumedList.includes("g"),
  "a quoted physical constant is not an invented value and must not be framed as one",
);
assert(
  !unchecked.systemPrompt.includes("NOT STATED BY THE QUESTION: m1") &&
    !unchecked.systemPrompt.includes("NOT STATED BY THE QUESTION: u1"),
  "values the question does state must not be demoted to assumptions",
);
assert(
  unchecked.systemPrompt.includes("TURN PLAN V3 (NOT INDEPENDENTLY CHECKED)"),
  "without a solver projection the plan must not be introduced as verified",
);
assert(
  unchecked.systemPrompt.includes("if your own line disagrees with the number below"),
  "an unchecked plan must tell the tutor to trust its own written working",
);

const verified = buildTurnTeachingPrompt({
  question,
  diagramPromptAddon: "FIGURE ADDON MARKER",
  turnPlan: plan,
  solverProjection: { verified: true },
  codeLesson: null,
  isDsa: false,
  familiarity: "new",
  fastMode: true,
});

assert(
  verified.systemPrompt.includes("AUTHORITATIVE TURN PLAN V3"),
  "a solver-verified plan keeps its authority",
);
assert(
  verified.systemPrompt.includes("FIGURE ADDON MARKER"),
  "the committed figure's own prompt addon must reach the tutor",
);
assert(
  !verified.systemPrompt.includes("selected text-only mode"),
  "a turn with a figure must not also carry the text-only instructions",
);
assert(
  unchecked.systemPrompt.includes("selected text-only mode"),
  "a turn with no figure must carry the text-only instructions",
);
assert(
  verified.systemPrompt.includes("SUBJECT FAMILIARITY: NEW"),
  "familiarity must reach the tutor",
);
// The LESSON LENGTH block is the final word on step count, so nothing may sit
// after it and argue.
const lengthIndex = verified.systemPrompt.lastIndexOf("LESSON LENGTH");
assert(lengthIndex > 0, "the lesson length block must be present");
assert(
  verified.systemPrompt.slice(lengthIndex).indexOf("SUBJECT FAMILIARITY") < 0,
  "the lesson length block must come last so no later block re-argues the step count",
);

// Rules that exist because a reviewed round showed the lesson failing without
// them. Each names the failure it prevents.
const CONTRACT_RULES: [needle: string, why: string][] = [
  [
    "the figure can be the wrong figure",
    "without an exit clause the tutor narrates whatever picture it is handed: a double slit rig was taught as a capillary tube, two point charges as Earth's magnetic field",
  ],
  [
    "describe only what is actually drawn",
    "lessons announced terminals, curves and fragments that were never on the board",
  ],
  [
    "trust the board",
    "a plan claiming 62 J after a 24 J collision must not override the tutor's own written working",
  ],
  [
    "a units line on its own is not a check",
    "every lesson picked the units check because it cannot fail",
  ],
  [
    "the last step is the interpretation or the check",
    "twelve of nineteen lessons ended on a recap row instead of stopping",
  ],
  [
    "[EMPHASIZE:last] boxes the row you just wrote",
    "the boxing rule was written so broadly it was followed on one row in twenty",
  ],
  [
    "that topic owns the whole lesson",
    "an \"or sketch the Maxwell speed curve\" clause in a stem displaced the named topic entirely: adiabatic processes, Dalton's law, and the coefficient of performance each got zero steps",
  ],
  [
    "a law has conditions",
    "textbook one-liners were quoted with the qualifier removed, so an adiabat was called isentropic without reversibility",
  ],
  [
    "never [WRITE] a line you have already written",
    "fifty five lessons in one sweep wrote the same row twice, spending a row the derivation needed",
  ],
  [
    "the order inside the step is always [WRITE] first and [EMPHASIZE:last] second",
    "twenty six lessons put the box first, so it landed on the previous row; spelling out that failure in the rule made it more common, so the rule now states only the correct order",
  ],
  [
    "a work row holds about",
    "the prompt said only \"keep each line short enough\", and a hundred rows overflowed a column it never named a size for",
  ],
  [
    "never send two write-less steps in a row",
    "a [FOCUS]-only step writes nothing: sixteen numerical asks spent 41 of 228 steps with the pen down, one of them narrating a figure for nine steps running",
  ],
  [
    "[FOCUS] rides with the work",
    "telling the tutor to write during the figure tour only moved the failure: it wrote a legend (\"M mirror, P pole\", \"O object, I image\") instead of working. the tour is not a beat of its own",
  ],
  [
    "the row is the sentence you just spoke",
    "the voice said \"each resistor takes half the supply\" and the board took the row with \"V_mid relative to ground end\"; the two streams have to carry the same statement",
  ],
  [
    "for a numbered problem every row is mathematics",
    "the row order used to open on \"what the symbols mean and what is asked\", which bought a prose row on every numerical lesson",
  ],
  [
    "in its general symbolic form before any special case",
    "equal resistors let one lesson skip the divider rule entirely and write \"equal R -> V_R1 = V_R2\", so the student got the arithmetic of this question and not the relation",
  ],
];
// That budget has to be the measured one, not a number typed into the prompt.
const budgetMatch = /a work row holds about (\d+) characters while a figure is on the board, and about (\d+)/.exec(
  TUTOR_SYSTEM_PROMPT,
);
assert(budgetMatch, "the row budget must state both column widths");
const narrowBudget = Number(budgetMatch[1]);
const wideBudget = Number(budgetMatch[2]);
assert(
  narrowBudget > 10 && narrowBudget < wideBudget,
  `the narrow column budget (${narrowBudget}) must be positive and smaller than the full-width one (${wideBudget})`,
);
{
  const sample = "x".repeat(narrowBudget);
  const fitted = fitBoardText(sample, { role: "work", maxWidth: WORK_ZONE.maxTextWidth });
  assert(
    fitted.lines.length === 1,
    `the prompt promises ${narrowBudget} characters fit the narrow column, but the renderer wraps that to ${fitted.lines.length} lines`,
  );
}
for (const [needle, why] of CONTRACT_RULES) {
  assert(TUTOR_SYSTEM_PROMPT.includes(needle), `the teaching contract lost the rule "${needle}": ${why}`);
}

// A concept lesson whose subject is a relation has to derive it. Mayer's
// relation, Carnot efficiency and equipartition were each stated and then
// exemplified, so the derivation the question asked for never appeared.
assert(
  CONCEPT_LESSON_RUNTIME_ADDON.includes("deriving it is the lesson"),
  "the concept lesson addon must require the named relation to be derived, not just quoted",
);

console.log(
  `verify-turn-teaching-prompt: assumed givens are labelled, unchecked plans lose their authority, and ${CONTRACT_RULES.length} contract rules hold`,
);
