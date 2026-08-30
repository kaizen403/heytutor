import {
  isConceptLessonQuestion,
} from "../../src/llm/reasoningEffort";
import { givenValuesPromptAddon } from "../../src/llm/givenValueIntro";
import {
  CONCEPT_LESSON_RUNTIME_ADDON,
  FAST_MODE_TEACHING_ADDON,
  LESSON_DEPTH_ADDONS,
  TUTOR_CONTINUATION_PROMPT,
  TUTOR_SYSTEM_PROMPT,
} from "../../src/llm/systemPrompt";

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

assert(
  /8-12 steps/.test(CONCEPT_LESSON_RUNTIME_ADDON),
  "concept lessons must ask for a full beginner loop",
);
assert(
  /diagram-setup/.test(FAST_MODE_TEACHING_ADDON) && /8-12 steps/.test(FAST_MODE_TEACHING_ADDON),
  "fast mode must not shrink diagram-setup teaching to 5-8 wrap-up steps",
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
assert(
  /Every step must \[WRITE\]/.test(CONCEPT_LESSON_RUNTIME_ADDON),
  "concept lessons must write a board line in every step",
);

const teachingPrompts = [
  TUTOR_SYSTEM_PROMPT,
  TUTOR_CONTINUATION_PROMPT,
  CONCEPT_LESSON_RUNTIME_ADDON,
  FAST_MODE_TEACHING_ADDON,
  LESSON_DEPTH_ADDONS.concise,
  LESSON_DEPTH_ADDONS.thorough,
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
