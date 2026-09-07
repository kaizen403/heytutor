import {
  isConceptLessonQuestion,
} from "../../src/llm/reasoningEffort";
import { givenValuesPromptAddon } from "../../src/llm/givenValueIntro";
import { WORK_ZONE } from "@heytutor/drawing";
import {
  BOARD_ROWS_PER_PAGE,
  boardRowY,
  CONCEPT_LESSON_RUNTIME_ADDON,
  FAST_MODE_TEACHING_ADDON,
  FAMILIARITY_ADDONS,
  TUTOR_CONTINUATION_PROMPT,
  TUTOR_SYSTEM_PROMPT,
} from "../../src/llm/systemPrompt";

const BOARD_ROW_PITCH = WORK_ZONE.lineHeight;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  isConceptLessonQuestion(
    "Draw a labelled diagram for Kirchhoff's laws and their applications. Show the circuit symbols and labelled terminals.",
  ),
  "a diagram-setup stem is a concept lesson, not a two-line wrap-up",
);
assert(
  isConceptLessonQuestion("Explain Kirchhoff's junction rule."),
  "an explain stem is a concept lesson",
);
assert(
  !isConceptLessonQuestion("Find the current in the 4 Ω resistor."),
  "a numbered solve is not a concept lesson",
);
// Dictation drops the leading verb, so a concept request can arrive with no
// ask verb at all. It was taught as a numbered problem and the planner then
// invented givens to solve.
for (const stem of [
  "Me the first law of physics with an example problem",
  "the first law of physics with an example problem",
  "newton's second law with an example",
  "photosynthesis",
]) {
  assert(isConceptLessonQuestion(stem), `a verb-less concept request was missed: ${stem}`);
}
for (const stem of [
  "Find the current in the 4 Ω resistor.",
  "Solve x^2 - 5x + 6 = 0.",
  "A ball is thrown up at 20 m/s. Find the maximum height.",
  "Three 12 ohm resistors in series and in parallel. Find both equivalent resistances.",
]) {
  assert(!isConceptLessonQuestion(stem), `a numbered problem was read as a concept lesson: ${stem}`);
}

assert(
  /full beginner|complete beginner/i.test(CONCEPT_LESSON_RUNTIME_ADDON) &&
    /LESSON LENGTH/.test(CONCEPT_LESSON_RUNTIME_ADDON),
  "concept lessons must ask for a full beginner loop sized by the lesson budget",
);
assert(
  /diagram-setup/.test(FAST_MODE_TEACHING_ADDON) &&
    /not a shorter lesson/i.test(FAST_MODE_TEACHING_ADDON) &&
    /Do not reduce the step count/i.test(FAST_MODE_TEACHING_ADDON),
  "fast mode must pick a faster model, never a shorter lesson",
);
// Step counts live in exactly one place. A second number anywhere in the
// teaching prompts is what let fast mode quietly win over the depth setting.
for (const [name, prompt] of [
  ["TUTOR_SYSTEM_PROMPT", TUTOR_SYSTEM_PROMPT],
  ["CONCEPT_LESSON_RUNTIME_ADDON", CONCEPT_LESSON_RUNTIME_ADDON],
  ["FAST_MODE_TEACHING_ADDON", FAST_MODE_TEACHING_ADDON],
  ["FAMILIARITY_ADDONS.revision", FAMILIARITY_ADDONS.revision],
  ["FAMILIARITY_ADDONS.new", FAMILIARITY_ADDONS.new],
] as const) {
  assert(
    !/\d+\s*-\s*\d+\s+steps/i.test(prompt),
    `${name} hard-codes a step range; only the LESSON LENGTH block may set one`,
  );
}
assert(
  /LESSON LENGTH block/.test(TUTOR_SYSTEM_PROMPT) &&
    /that step range is authoritative/.test(TUTOR_SYSTEM_PROMPT),
  "the teaching prompt must defer step count to the runtime lesson budget",
);
assert(
  /diagram-setup request, teach a full beginner lesson/.test(TUTOR_SYSTEM_PROMPT),
  "the teaching prompt must lengthen simple diagram-setup questions",
);
assert(
  /never emit a speech-only step/.test(TUTOR_SYSTEM_PROMPT),
  "the teaching prompt must keep the marker moving",
);
assert(
  /fill the left work column/.test(TUTOR_SYSTEM_PROMPT),
  "explain lessons must write a notebook, not a couple of equations",
);
// The one-page ceiling: the prompt once listed a fixed set of y values ending
// at the last row of page one, so every lesson was written to stop there. The
// numbers are derived now, so assert against the geometry, not a literal.
const lastRowOnPage = boardRowY(BOARD_ROWS_PER_PAGE - 1);
assert(
  new RegExp(`past ${lastRowOnPage}\\b`).test(TUTOR_SYSTEM_PROMPT) &&
    /fresh page/.test(TUTOR_SYSTEM_PROMPT),
  `the teaching prompt must allow work past row ${lastRowOnPage} onto another board page`,
);
assert(
  new RegExp(`y = ${boardRowY(0)} for the first line`).test(TUTOR_SYSTEM_PROMPT) &&
    TUTOR_SYSTEM_PROMPT.includes(`${boardRowY(0)}, ${boardRowY(1)}, ${boardRowY(2)}`),
  "the row list in the teaching prompt has drifted from the real row pitch",
);
assert(
  !/,90,(?:205|265|325|385|445|565|625|685)\]/.test(TUTOR_SYSTEM_PROMPT),
  "the worked example still quotes rows from the retired 54px pitch",
);
assert(
  /never shorten a lesson so the work fits on one board page/i.test(TUTOR_SYSTEM_PROMPT),
  "the teaching prompt must forbid trimming a lesson to fit one page",
);
assert(
  new RegExp(`keep stepping y by ${BOARD_ROW_PITCH}\\b`).test(TUTOR_CONTINUATION_PROMPT) &&
    new RegExp(`past ${lastRowOnPage}\\b`).test(TUTOR_CONTINUATION_PROMPT),
  "a continued lesson must keep flowing down the column instead of restarting the page",
);
assert(
  /Every step must \[WRITE\]/.test(CONCEPT_LESSON_RUNTIME_ADDON),
  "concept lessons must write a board line in every step",
);

const teachingPrompts = [
  TUTOR_SYSTEM_PROMPT,
  TUTOR_CONTINUATION_PROMPT,
  CONCEPT_LESSON_RUNTIME_ADDON,
  FAST_MODE_TEACHING_ADDON,
  FAMILIARITY_ADDONS.revision,
  FAMILIARITY_ADDONS.new,
  givenValuesPromptAddon(true),
];
for (const prompt of teachingPrompts) {
  assert(
    !/EMPHASIZE[^\n.]*underline/i.test(prompt) && !/underline[^\n.]*EMPHASIZE/i.test(prompt),
    "EMPHASIZE must be described as boxing a row, not underlining it",
  );
}
assert(
  /\[EMPHASIZE:last\] boxes/.test(TUTOR_SYSTEM_PROMPT),
  "the teaching prompt must say EMPHASIZE boxes a work row",
);
assert(
  /\[EMPHASIZE:last\] to box/.test(TUTOR_CONTINUATION_PROMPT),
  "continuation must say EMPHASIZE boxes a work row",
);

console.log("verify-reasoning-effort: ok");
