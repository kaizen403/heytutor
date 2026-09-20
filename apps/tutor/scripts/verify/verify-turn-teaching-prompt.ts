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
import {
  CONCEPT_LESSON_RUNTIME_ADDON,
  LESSON_OPENING_PROMPT_ADDON,
  TUTOR_SYSTEM_PROMPT,
  getMockCodeLessonPlan,
} from "@heytutor/tutor-core";
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
  // The pen follows the voice only when the row's tokens are in the voice.
  // Measured over 364 lessons: 6301 rows, every token spoken in 13.9% of them,
  // "=" unmatched in 2822 of 4267 rows because the step said "is".
  [
    "the row is spoken token for token",
    "a row whose tokens are not in the sentence has no word to sync to, so the pen fell back to a spread across the sentence and finished a second before the voice",
  ],
  [
    "say every = as equals, never is",
    "the matcher accepts equals; 45% of rows with = were spoken as \"is\" and the pen never found the relation",
  ],
  [
    "say a subscript by its letter alone",
    "\"v sub s\" never matches the row V_s, so a subscripted symbol was the token most often left unmatched",
  ],
  [
    "the words that name the row come last in the step",
    "29% of rows had their first matched token past 35% of the sentence because the reason came after the row; the runtime then dragged the cue to the sentence start",
  ],
  // FOCUS placement: 1277 tags, 26% carried several ids, 98.7% sat at the end of
  // the step, and the label was inside the runtime's clause anchor in 28%.
  [
    "one [FOCUS:one_id] per named part, placed inside the sentence directly after the label",
    "an end-of-step tag fires after the whole sentence, a median 3.3 s after the name was spoken",
  ],
  [
    "never two ids in one tag",
    "a combined tag is one gesture for several parts, so every label released at once and the marker traced them all inside one 900 ms budget",
  ],
  [
    "each part gets its own tag right after its name",
    "\"several at once with [FOCUS:id_a,id_b]\" told the model to do the thing the previous rule forbids",
  ],
  [
    "a tag never directly follows another tag",
    "11% of FOCUS tags were glued behind a WRITE with an empty window, and the runtime had no words to place them on",
  ],
];

// Wording that taught the failure. Each of these was the sentence the model
// obeyed, so its return is a regression whatever else the prompt says.
const RETIRED_WORDING: [needle: string, why: string][] = [
  ["[FOCUS:id_a,id_b]", "the combined tag form was offered as an optional form and used in 26% of tags"],
  ["several at once", "the tour rule told the model to combine ids that the placement rule tells it to separate"],
  ["immediately after the spoken name", "said the placement without forbidding the end of the step, and 98.7% of tags landed there"],
  ["in the same breath as [WRITE]", "described the cue without saying the row is spoken token for token"],
  ["in that same step", "the same-step wording let the tag drift to the end of the step"],
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
for (const [needle, why] of RETIRED_WORDING) {
  assert(!TUTOR_SYSTEM_PROMPT.includes(needle), `the teaching contract says "${needle}" again: ${why}`);
}

// The example is the rule the model actually copies. Its own steps once
// carried a combined end-of-step FOCUS and a FOCUS glued behind a WRITE, and
// the lessons reproduced both shapes at 26% and 11%. So the example is held to
// the placement rules by structure, not by wording.
const exampleStart = TUTOR_SYSTEM_PROMPT.indexOf("example structure:");
assert(exampleStart > 0, "the teaching contract must end with an example");
const exampleSteps = [...TUTOR_SYSTEM_PROMPT.slice(exampleStart).matchAll(/\[STEP\]([\s\S]*?)\[\/STEP\]/g)]
  .map((match) => match[1].trim());
assert(exampleSteps.length >= 8, `the example must be a whole lesson, got ${exampleSteps.length} steps`);
const TAG = /\[(WRITE|FOCUS|EMPHASIZE|ANNOTATE|PAUSE):([^\]]*)\]/g;
let exampleFocusTags = 0;
for (const step of exampleSteps) {
  assert(
    !/\]\s*\[(?:WRITE|FOCUS|EMPHASIZE|ANNOTATE|PAUSE):/.test(step),
    `two tags sit side by side in the example step "${step.slice(0, 60)}": a tag needs the words it belongs to in front of it`,
  );
  const tags = [...step.matchAll(TAG)];
  for (const tag of tags) {
    const [, type, body] = tag;
    const after = step.slice((tag.index ?? 0) + tag[0].length).replace(TAG, "").trim();
    if (type === "FOCUS") {
      exampleFocusTags += 1;
      assert(
        !body.split("|")[0].includes(","),
        `the example carries a combined FOCUS "${body}": one tag per named part`,
      );
      assert(
        after.length > 0,
        `the example puts [FOCUS:${body}] at the end of its step; it belongs inside the sentence right after the label`,
      );
      // Inside the sentence means the tag closes on the name, not on the full
      // stop: the word before it is the last spoken word of the label phrase.
      const before = step.slice(0, tag.index).replace(TAG, "").trim();
      assert(
        /[A-Za-z]$/.test(before),
        `the example puts [FOCUS:${body}] after "${before.slice(-20)}", which is not a spoken name`,
      );
    }
    if (type === "WRITE") {
      assert(
        after.length === 0,
        `the example keeps talking after [WRITE:${body.split(",")[0]}]: the row's words come last and the step ends on the tag`,
      );
      const spoken = step.replace(TAG, "").toLowerCase();
      // The unknown row "v = ?" is the one = with no spoken form: the sentence
      // says what we want, and "?" is never read aloud.
      const row = body.split(",")[0];
      if (row.includes("=") && !/=\s*\?\s*$/.test(row)) {
        assert(
          /\bequals\b/.test(spoken),
          `the example row "${body.split(",")[0]}" carries = and its step never says equals`,
        );
      }
    }
  }
}
assert(exampleFocusTags >= 3, `the example must show FOCUS placement more than once, got ${exampleFocusTags}`);

// A DSA lesson's frame tag moves the figure. Measured over the code rounds the
// tag sat at the start of the step in 51% of lessons and at the end in most of
// the rest, so the picture changed a whole step away from the sentence that
// named it. The rule now names the sentence the tag follows.
const codeLesson = buildTurnTeachingPrompt({
  question: "Two sum: given nums and target, return the indices of the two numbers that add to target.",
  diagramPromptAddon: "FIGURE ADDON MARKER",
  turnPlan: null,
  solverProjection: null,
  codeLesson: getMockCodeLessonPlan("two sum"),
  codeLessonFrames: [
    { id: "frame_1", caption: "start with both pointers at the ends", narrationIntent: "set up" },
    { id: "frame_2", caption: "the sum is too small, so move the left pointer", narrationIntent: "first move" },
  ],
  isDsa: true,
  familiarity: "normal",
  fastMode: true,
});
assert(
  codeLesson.systemPrompt.includes("after the first sentence that names the frame"),
  "the code lesson contract must place the frame tag after the first sentence that names the frame",
);
assert(
  !codeLesson.systemPrompt.includes("at the end of the step"),
  "the code lesson contract must not send the frame tag to the end of the step",
);

// A concept lesson whose subject is a relation has to derive it. Mayer's
// relation, Carnot efficiency and equipartition were each stated and then
// exemplified, so the derivation the question asked for never appeared.
assert(
  CONCEPT_LESSON_RUNTIME_ADDON.includes("deriving it is the lesson"),
  "the concept lesson addon must require the named relation to be derived, not just quoted",
);
assert(
  CONCEPT_LESSON_RUNTIME_ADDON.includes("Do not invent measurements"),
  "a concept lesson must not invent numbers the question did not ask for",
);

// The turn's first spoken beat leads everything the runtime writes. Ordering
// is the whole point of it: a lesson whose opening line arrives after the
// "Given: ..." rows has still started in the middle of itself.
for (const built of [unchecked, verified]) {
  const opening = built.openingSegment;
  assert(opening !== null, "a numbered turn must carry an opening beat");
  assert(opening.delivery === "opening", "the opening beat must ask for the opening voice");
  assert(opening.command === null && opening.commands === undefined, "the opening beat writes nothing");
  assert(
    !built.givenSegments.some((segment) => segment.delivery === "opening"),
    "the opening beat must stay out of the numbered work rows",
  );
  assert(
    built.runtimeAddon.startsWith(LESSON_OPENING_PROMPT_ADDON),
    "the model must be told first that the lesson has already been opened",
  );
  assert(
    built.systemPrompt.includes(LESSON_OPENING_PROMPT_ADDON),
    "the opening addon must reach the model",
  );
}

// Nothing in the assembled prompt may tell the model to do the opening the
// runtime has already done. Two instructions in one prompt saying opposite
// things is how the answer ended up greeting twice.
for (const built of [unchecked, verified]) {
  assert(
    !/what the question asks you to find/i.test(built.systemPrompt),
    "the assembled prompt still asks the model to restate the ask the opening line spoke",
  );
}

console.log(
  `verify-turn-teaching-prompt: the lesson opens once, assumed givens are labelled, unchecked plans lose their authority, ${CONTRACT_RULES.length} contract rules hold, ${RETIRED_WORDING.length} retired sentences stay out, and the example places every tag on its words`,
);
