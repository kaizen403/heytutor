/**
 * The lesson's first spoken beat.
 *
 * Every lesson used to begin in the middle of itself: on a numbered problem
 * the first words a student heard were "Given... u equals twenty meters per
 * second", and on an explain question they were the first line of a
 * definition. The introduction, when it came at all, came second. These
 * assertions hold the shape of the line that now leads instead, and the two
 * places it could silently stop leading: a wording change that makes the model
 * open a second time, and a voice change that makes it sound like the body.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LESSON_OPENING_PROMPT_ADDON,
  buildLessonOpeningSegment,
  lessonOpeningLine,
  type LessonOpeningKind,
} from "../../src/llm/lessonOpening";
import { givenValuesPromptAddon } from "../../src/llm/givenValueIntro";
import { isConceptLessonQuestion } from "../../src/llm/reasoningEffort";
import { dsaOpeningPromptAddon } from "../../src/code/codeLessonTeaching";
import { TUTOR_SYSTEM_PROMPT } from "../../src/llm/systemPrompt";
import {
  TUTOR_OPENING_VOICE_SETTINGS,
  TUTOR_VOICE_SETTINGS,
  TUTOR_VOICE_STYLE_RANGE,
  voiceSettingsForDelivery,
  voiceSettingsKey,
} from "../../src/tts/voiceSettings";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function open(question: string, kind: LessonOpeningKind, hasBoardOpening = true): string {
  return lessonOpeningLine({ question, kind, hasBoardOpening });
}

const GENERIC = /let's work through this one|take this one from the (?:beginning|top)/;

// ---------------------------------------------------------------- the line

const numbered = open(
  "A car starts at 20 m/s and accelerates at 3 m/s^2 for 4 s. Find the distance travelled.",
  "problem",
);
assert(!GENERIC.test(numbered), `a stated ask must be named, got: ${numbered}`);
assert(
  numbered.includes("the distance travelled"),
  `the opening must name what the question asks for, got: ${numbered}`,
);
assert(
  !/\b20\b|\b3\b|meters per second/.test(numbered),
  `the opening must not read the given values back, got: ${numbered}`,
);

// The setup states values before it states the question, so the ask is the
// last one in the stem. Reading the first match opened a lesson on a fragment
// of the setup instead.
const lateAsk = open(
  "To find the distance d over which a signal can be seen in fog, an engineer uses dimensional analysis and finds d proportional to S^(1/n). Find n.",
  "problem",
);
assert(
  lateAsk.includes("the value of n"),
  `the last ask in the stem owns the opening, got: ${lateAsk}`,
);

// A decimal point is not the end of a sentence. Splitting on a bare "." cut
// "convert 4.2 ly into metres" down to "4" and sent the question generic.
const decimal = open(
  "A star is 4.2 light years from Earth. Convert 4.2 ly into metres.",
  "problem",
);
assert(!GENERIC.test(decimal), `a decimal in the ask must not break it, got: ${decimal}`);

// "asks how far does it travel" is not English.
const inverted = open("A block slides down a slope. How far does it travel in 3 seconds?", "problem");
assert(
  inverted.includes("asks, how far"),
  `an inverted question must be quoted with a comma, got: ${inverted}`,
);

const proof = open("Show that the sum of the first n odd numbers is n squared.", "problem");
assert(
  proof.includes("asks you to show that"),
  `a proof asks you to do something, got: ${proof}`,
);

const concept = open("Explain the photoelectric effect", "concept", false);
assert(
  concept.includes("about the photoelectric effect"),
  `an explain question must be named, got: ${concept}`,
);

const openQuestion = open("Why does ice float on water?", "concept", false);
assert(
  openQuestion.includes("why does ice float on water"),
  `an open question is quoted, not rephrased, got: ${openQuestion}`,
);

// A syllabus stem wraps its topic in boilerplate and then instructs the tutor.
// Both halves have to come off or the line runs past its own length limit and
// every drawing question in the bank opens on the same six generic words.
const drawing = open(
  "Draw the standard setup for Superposition of two simple harmonic motions along a straight line and label the named quantities. Sketch the wave.",
  "concept",
  false,
);
assert(!GENERIC.test(drawing), `a drawing stem must name its figure, got: ${drawing}`);
assert(
  drawing.includes("superposition of two simple harmonic motions"),
  `the topic survives the boilerplate, got: ${drawing}`,
);
assert(!/label the named|sketch the wave/i.test(drawing), `instructions to the tutor are not the topic: ${drawing}`);

// The code path speaks its ask a beat later, on the title row it writes in
// ink. Saying it here too is the same sentence twice.
const code = open("Given an array, return indices of two numbers adding to target.", "code");
assert(code.includes("from the top"), `a code lesson opens on the problem, got: ${code}`);

// ------------------------------------------------------------- every line

const shapes: Array<[string, LessonOpeningKind, boolean]> = [
  ["A ball is thrown up at 25 m/s. How high does it go?", "problem", true],
  ["Two resistors of 4 ohm and 6 ohm are in parallel across 12 V. Determine the current.", "problem", true],
  ["Simplify the expression", "problem", false],
  ["What is a derivative?", "concept", false],
  ["the basics of vectors", "concept", false],
  ["Draw a ray diagram for a concave mirror", "concept", false],
  ["Two Sum", "code", true],
];
for (const [question, kind, hasBoardOpening] of shapes) {
  const line = open(question, kind, hasBoardOpening);
  assert(line.length > 0, `no opening for: ${question}`);
  assert(/^(?:okay|right|alright)\.\.\./.test(line), `unexpected lead in: ${line}`);
  assert(line === line.toLowerCase(), `the tutor speaks lowercase, got: ${line}`);
  // The board and the voice both forbid a dash as punctuation, and this line
  // is assembled from question text that may contain one.
  assert(!/[–—]/.test(line), `dash punctuation in: ${line}`);
  assert((line.match(/let's/g) ?? []).length <= 1, `"let's" twice in: ${line}`);
  assert(line.trim().endsWith("."), `the opening must end on a full stop: ${line}`);
  assert(line.length <= 180, `opening too long to be an opening: ${line}`);
}

// The same question opens the same way every time, so a replayed lesson and a
// live one are the same lesson.
assert(
  open("What is entropy?", "concept", false) === open("What is entropy?", "concept", false),
  "the opening must be deterministic for one question",
);
// And two questions do not have to sound identical.
const leads = new Set(
  ["What is entropy?", "What is a derivative?", "What is momentum?", "What is torque?", "What is flux?"].map(
    (q) => open(q, "concept", false).split(" ")[0],
  ),
);
assert(leads.size > 1, "every question opened on the same lead word");

assert(open("", "problem") === "", "an empty question has no opening");
assert(buildLessonOpeningSegment({ question: "", kind: "problem", hasBoardOpening: false }) === null,
  "an empty question must not produce a segment");

// ------------------------------------------------------------- the segment

const segment = buildLessonOpeningSegment({
  question: "Find the current through the 4 ohm resistor.",
  kind: "problem",
  hasBoardOpening: true,
});
assert(segment !== null, "a real question must produce an opening segment");
assert(segment.command === null, "the opening beat writes nothing");
assert(segment.commands === undefined, "the opening beat writes nothing");
assert(segment.delivery === "opening", "the opening beat must ask for the opening voice");
assert(segment.narration.length > 0, "the opening beat must be spoken");

// --------------------------------------------------------------- the voice

assert(
  voiceSettingsKey(TUTOR_OPENING_VOICE_SETTINGS) !== voiceSettingsKey(TUTOR_VOICE_SETTINGS),
  "the opening voice is the teaching voice, so nothing about the start sounds different",
);
assert(
  (TUTOR_OPENING_VOICE_SETTINGS.style ?? 0) > (TUTOR_VOICE_SETTINGS.style ?? 0),
  "the opening must carry more expression than the body of the lesson",
);
assert(
  TUTOR_OPENING_VOICE_SETTINGS.stability < TUTOR_VOICE_SETTINGS.stability,
  "stability is variability inverted, so the opening must sit below the teaching voice",
);
assert(
  (TUTOR_OPENING_VOICE_SETTINGS.style ?? 0) <= TUTOR_VOICE_STYLE_RANGE.max &&
    (TUTOR_OPENING_VOICE_SETTINGS.style ?? 0) >= TUTOR_VOICE_STYLE_RANGE.min,
  "the opening style must stay inside the documented working range",
);
assert(
  TUTOR_OPENING_VOICE_SETTINGS.similarity_boost === TUTOR_VOICE_SETTINGS.similarity_boost,
  "the opening must hold the same timbre, or the tutor changes voice mid-turn",
);
assert(
  voiceSettingsForDelivery("opening") === TUTOR_OPENING_VOICE_SETTINGS,
  "an opening segment must resolve to the opening dials",
);
assert(
  voiceSettingsForDelivery(undefined) === TUTOR_VOICE_SETTINGS,
  "everything else teaches",
);
// Cache identity. Both TTS paths match generated audio by spoken text, and the
// lookahead reaches an opening line before the runner does: keyed on text
// alone, the flat copy is the one that plays.
assert(
  voiceSettingsKey(undefined) !== voiceSettingsKey(TUTOR_OPENING_VOICE_SETTINGS),
  "an opening must not share a cache key with the same sentence spoken plainly",
);

// -------------------------------------------------------- no double opening

assert(
  /already spoken one opening line/.test(LESSON_OPENING_PROMPT_ADDON),
  "the model must be told the lesson has already been opened",
);
for (const [name, addon] of [
  ["given values", givenValuesPromptAddon(true)],
  ["dsa opening", dsaOpeningPromptAddon(true)],
  ["system prompt", TUTOR_SYSTEM_PROMPT],
]) {
  assert(
    !/\bopen\s+(?:by|instead)\b/i.test(addon),
    `${name} still tells the model to open the lesson, which the runtime now does`,
  );
  assert(
    !/what the question asks you to find/i.test(addon),
    `${name} still asks the model to restate the ask the opening line just spoke`,
  );
}

// ------------------------------------------------------- the real question bank
//
// The shapes above are chosen examples, and a parser can be tuned until every
// chosen example passes while the bank it will actually meet goes generic.
// This reads the syllabus probes and holds the rate down. The thresholds have
// headroom over the measured rate, so this fails on a regression rather than
// on a rewording.

const repoRoot = resolve(process.cwd(), "../..");
const probesDir = resolve(repoRoot, "data/syllabus-probes");
const counts = { problem: 0, concept: 0 };
const generic = { problem: 0, concept: 0 };
let empty = 0;

for (const file of readdirSync(probesDir).filter((name) => name.endsWith(".json"))) {
  const parsed = JSON.parse(readFileSync(resolve(probesDir, file), "utf8")) as {
    questions?: Array<{ question?: string }>;
  };
  for (const entry of parsed.questions ?? []) {
    const question = entry.question;
    if (!question) continue;
    const kind = isConceptLessonQuestion(question) ? "concept" : "problem";
    const line = open(question, kind, kind === "problem");
    counts[kind] += 1;
    if (!line) empty += 1;
    if (GENERIC.test(line)) generic[kind] += 1;
  }
}

assert(counts.problem + counts.concept > 500, "the syllabus probe bank did not load");
assert(empty === 0, `${empty} questions in the bank produced no opening at all`);

const problemRate = generic.problem / Math.max(counts.problem, 1);
const conceptRate = generic.concept / Math.max(counts.concept, 1);
assert(
  problemRate < 0.4,
  `${Math.round(problemRate * 100)}% of numbered problems open generically (measured 23%)`,
);
assert(
  conceptRate < 0.2,
  `${Math.round(conceptRate * 100)}% of explain questions open generically (measured 9%)`,
);

console.log(
  `verify-lesson-opening: all checks passed (${counts.problem + counts.concept} bank questions, ` +
    `${Math.round(problemRate * 100)}% / ${Math.round(conceptRate * 100)}% generic)`,
);
