/**
 * The rough-incline lectures spoke one relation as "has magnitude" and boxed
 * nothing. The repair puts "equals" on that row and boxes the closing relation.
 * A lesson that already says equals and already boxes a row is left alone.
 */
import { parseDrawingCommands } from "@heytutor/drawing";
import { gradeLecture } from "../lecture-lab/grade";
import type { LectureRun } from "../lecture-lab/lecturePipeline";
import {
  LectureMarkupBuffer,
  repairLectureMarkup,
} from "../../features/tutor-session/lib/turn/lectureCueRepair";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function lectureRun(rawText: string): LectureRun {
  const blocks = [...rawText.matchAll(/\[STEP\]([\s\S]*?)(?:\[\/STEP\]|$)/g)].map((match) => match[1]);
  const parsedAll = parseDrawingCommands(rawText);
  return {
    probeId: "fixture",
    topicId: "fixture|1|incline",
    unitId: "fixture|1",
    difficulty: "hard",
    question: "Explain how to draw a free-body diagram for a block on a rough incline.",
    familiarity: "new",
    startedAt: "",
    timings: { planMs: 0, teachMs: 0, totalMs: 0 },
    error: null,
    isDsa: false,
    plan: null,
    solver: null,
    diagram: {
      plannerDeclineReason: null, plannerDeclines: [], rejectedOperatorCalls: [],
      candidateRejections: [], rejectionEvidenceTruncation: { candidateRecords: 0, candidateIssues: 0, operatorRecords: 0 },
      committed: true,
      declinedUnreadable: false,
      tier: "qualitative_verified",
      nonMetric: true,
      reason: null,
      archetypeId: null,
      family: null,
      entityIds: [],
      focusableIds: [],
      labels: [],
      annotations: [],
      renderedLabels: ["mg", "N", "f"],
      labelByEntity: {},
      primitiveCount: 10,
      assertionCount: 0,
      candidateErrorCodes: [],
      degradationReason: null,
      svg: null,
    },
    lessonBudget: { scope: "standard", minSteps: 4, maxSteps: 18, boardPages: 1 },
    givenRows: [],
    teaching: {
      rawText,
      usedStepMarkers: blocks.length > 0,
      unresolvedFocusIds: [],
      steps: blocks.map((block, index) => {
        const parsed = parseDrawingCommands(block);
        return {
          index: index + 1,
          speech: parsed.narration.trim(),
          tags: parsed.commands.map((command) =>
            command.text === undefined
              ? { type: command.type, params: command.params }
              : { type: command.type, params: command.params, text: command.text },
          ),
        };
      }),
      writes: parsedAll.commands
        .filter((command) => command.type === "WRITE")
        .map((command) => ({
          text: command.text ?? "",
          x: command.params[0] ?? null,
          y: command.params[1] ?? null,
        })),
      focusIds: [],
      emphasizeTargets: parsedAll.commands
        .filter((command) => command.type === "EMPHASIZE")
        .map((command) => command.text ?? ""),
      annotateTargets: [],
      forbiddenTags: [],
      continuations: 0,
      incomplete: false,
      contentChars: rawText.length,
      reasoningChars: 0,
      ttftMs: null,
    },
    promptChars: 0,
  };
}

const codesOf = (raw: string) => new Set(gradeLecture(lectureRun(raw)).findings.map((finding) => finding.code));

const incline = `[STEP]
the normal force equals m g cosine theta. [WRITE:N = mg cos θ,90,211]
[/STEP]
[STEP]
along the incline, m a x equals m g sine theta minus f. [WRITE:mg sin θ - f = ma_x,90,277]
[/STEP]
[STEP]
if the block slides, kinetic friction has magnitude μ_k times N. if it is stuck, static friction adjusts up to a maximum of μ_s times N. [WRITE:f_k = μ_k N; f_s ≤ μ_s N,90,343]
[/STEP]
[STEP]
substitute, and m a x equals m g sine theta minus mu k N. [WRITE:ma_x = mg sin θ - μ_k N,90,409]
[/STEP]`;

const before = codesOf(incline);
assert(before.has("row_unspoken_cue"), "a relation spoken as magnitude must fail the equals cue");
assert(before.has("no_emphasis"), "four relations and no box must fail emphasis");

const repaired = repairLectureMarkup(incline);
const after = codesOf(repaired);
assert(!after.has("row_unspoken_cue"), `equals repair left ${[...after].join(", ") || "no findings"}`);
assert(!after.has("no_emphasis"), "the closing relation must be boxed");
assert(!after.has("emphasis_before_write"), "the box follows the row it marks");
assert(repaired.includes("kinetic friction equals μ_k times N"), "magnitude must be spoken as equals");
assert(repaired.includes("if it is stuck"), "a condition must stay a condition");
assert(repaired.includes("[WRITE:ma_x = mg sin θ - μ_k N,90,409][EMPHASIZE:last]"),
  "the box sits on the closing relation");

const copula = repairLectureMarkup(
  "[STEP]friction is mu N. [WRITE:f = μN,90,211][/STEP]",
);
assert(copula.includes("friction equals mu N"), "a bare copula in front of a relation is equals");
const article = repairLectureMarkup(
  "[STEP]this is the normal, and N equals m g. [WRITE:N = mg,90,211][/STEP]",
);
assert(article.includes("this is the normal"), "is the stays spoken English");

const already = `[STEP]
N equals m g cosine theta. [WRITE:N = mg cos θ,90,211][EMPHASIZE:last]
[/STEP]
[STEP]
f k equals mu k N. [WRITE:f_k = μ_k N,90,277]
[/STEP]
[STEP]
a x equals g sine theta minus mu k g cosine theta. [WRITE:a_x = g sin θ - μ_k g cos θ,90,343]
[/STEP]`;
assert(repairLectureMarkup(already) === already, "a lesson that already boxes a row must not gain another");

const codeStep = "[STEP]the node has magnitude. [TYPE:walk][/STEP]";
assert(repairLectureMarkup(codeStep) === codeStep, "a code step is not a notebook row");

const buffer = new LectureMarkupBuffer();
let streamed = "";
for (let index = 0; index < incline.length; index += 11) {
  streamed += buffer.push(incline.slice(index, index + 11));
}
streamed += buffer.finish();
assert(buffer.text() === repaired, "the stream saves the same lesson the full repair writes");
assert(
  (streamed.match(/\[EMPHASIZE:last\]/g) ?? []).length === 1,
  "the parser receives one result box",
);

// A row the parser repairs (coordinate-less, or closed by [/WRITE]) is a row,
// not speech: the copula repair must never rewrite the words on the board.
const closedRowStep = "[STEP]The speed comes from distance over time. [WRITE]v = d/t[/WRITE] and so [WRITE]the speed is constant[/WRITE][/STEP]";
const closedRows = parseDrawingCommands(repairLectureMarkup(closedRowStep)).commands
  .filter((command) => command.type === "WRITE").map((command) => command.text);
assert(closedRows.includes("the speed is constant") && !closedRows.some((text) => /equals constant/.test(text ?? "")),
  `the copula repair must not rewrite a repaired row's text: ${JSON.stringify(closedRows)}`);
const bareRowStep = "[STEP]The speed comes from distance over time. [WRITE:v = d/t,90,211] and so [WRITE:the speed is constant][/STEP]";
const bareRows = parseDrawingCommands(repairLectureMarkup(bareRowStep)).commands
  .filter((command) => command.type === "WRITE").map((command) => command.text);
assert(bareRows.includes("the speed is constant"), `nor a coordinate-less row's text: ${JSON.stringify(bareRows)}`);

// A row closed by [/WRITE] is newly a row; it must not widen the spoken
// repair to a step main left alone ("is called" never becomes "equals called").
const closedOnlyStep = "[STEP]Combine the right side. [WRITE](x + b/(2a))^2 = (b^2 - 4ac)/(4a^2)[/WRITE] The numerator is called the discriminant.[/STEP]";
const closedOnlySpoken = parseDrawingCommands(repairLectureMarkup(closedOnlyStep)).narration;
assert(closedOnlySpoken.includes("is called the discriminant") && !/equals called/.test(closedOnlySpoken),
  `a step whose only relation row is tag-closed keeps its words: ${closedOnlySpoken}`);

// Only an "is" that the row's value follows becomes "equals". On the 419
// recorded production outputs since 20 Oct, main rewrote 409 "is", most of them
// descriptions ("the hypotenuse equals always the longest side", "pneumonia
// equals infection", "t equals time in seconds"); this rule keeps 33, each one
// followed by its row's value.
const spokenAfter = (step: string) => parseDrawingCommands(repairLectureMarkup(step)).narration;
for (const [step, spoken] of [
  ["[STEP]half of b over a is b over two a. [WRITE:(1/2)(b/a) = b/(2a),90,211][/STEP]", "half of b over a equals b over two a"],
  ["[STEP]so the required power is m g v. [WRITE:P = mgv,90,211][/STEP]", "the required power equals m g v"],
  ["[STEP]so the frequency is 170 hertz. [WRITE:f = 340 / 2 = 170 Hz,90,211][/STEP]", "the frequency equals 170 hertz"],
] as const) {
  assert(spokenAfter(step).includes(spoken), `an "is" its row's value follows is spoken as equals: ${spokenAfter(step)}`);
}
for (const [step, kept] of [
  ["[STEP][WRITE:c = hypotenuse,90,211] the hypotenuse is always the longest side.[/STEP]", "the hypotenuse is always the longest side"],
  ["[STEP]current flows through a resistor. [WRITE:V = IR,90,211] R is resistance in ohms.[/STEP]", "R is resistance in ohms"],
  ["[STEP]pneumonia is infection of the lung. [WRITE:consolidation = fluid + cells,90,211][/STEP]", "pneumonia is infection of the lung"],
  ["[STEP]s3 is object storage. [WRITE:s3 = object storage,90,211][/STEP]", "s3 is object storage"],
] as const) {
  assert(spokenAfter(step).includes(kept), `a descriptive "is" stays as spoken: ${spokenAfter(step)}`);
}

// The cue repair never edits a row's own text. Without the pre-repair the "is"
// inside a coordinate-less row was rewritten (the board read "friction = μ N").
const rowsAfter = (step: string) => parseDrawingCommands(repairLectureMarkup(step)).commands
  .filter((command) => command.type === "WRITE").map((command) => command.text);
assert(rowsAfter("[STEP]Friction [WRITE:friction is mu N] and [WRITE:f = μN,90,211] here.[/STEP]").includes("friction is μ N"),
  `a coordinate-less row keeps its words: ${JSON.stringify(rowsAfter("[STEP]Friction [WRITE:friction is mu N] and [WRITE:f = μN,90,211] here.[/STEP]"))}`);
// A tag-closed relation row adds no spoken rewrite main would not make.
assert(spokenAfter("[STEP]Friction is mu N [WRITE]f = μN[/WRITE] here.[/STEP]").includes("Friction is mu N"),
  `a tag-closed relation row does not widen the spoken repair: ${spokenAfter("[STEP]Friction is mu N [WRITE]f = μN[/WRITE] here.[/STEP]")}`);
assert(spokenAfter("[STEP]Friction is mu N [WRITE]f = μN[/WRITE] and [WRITE:N = mg,90,211][/STEP]").includes("Friction is mu N"),
  "nor does it lend its value to a step main treats as a relation step");
// "has magnitude" is rewritten in speech only, never inside a row (Greptile).
const magnitude = "[STEP]Use Newton's law. [WRITE:F = ma,90,211] [WRITE]the force has magnitude ma[/WRITE] The force has magnitude m a.[/STEP]";
assert(rowsAfter(magnitude).includes("the force has magnitude ma") && spokenAfter(magnitude).includes("The force equals m a"),
  `"has magnitude" changes the speech, not the row: ${JSON.stringify(rowsAfter(magnitude))} / ${spokenAfter(magnitude)}`);

// The result box goes on the closing relation only while it is still the last
// row on the board. When a plain row follows it, a trailing [EMPHASIZE:last]
// would frame that row, so neither the board nor the saved lesson gets a box.
const laterPlainRow = "[STEP]first x = 1. [WRITE:x = 1,90,211][/STEP][STEP]then y = 2. [WRITE:y = 2,90,277][/STEP]" +
  "[STEP]and z = 3. [WRITE:z = 3,90,343][/STEP][STEP]so the work is done. [WRITE:all three found,90,409][/STEP]";
const boxBuffer = new LectureMarkupBuffer();
let boxSpoken = "";
for (let index = 0; index < laterPlainRow.length; index += 23) boxSpoken += boxBuffer.push(laterPlainRow.slice(index, index + 23));
boxSpoken += boxBuffer.finish();
assert(!boxSpoken.includes("[EMPHASIZE") && !boxBuffer.text().includes("[EMPHASIZE"),
  `no box frames a non-result row, on the board or in the saved lesson: ${boxSpoken.slice(-80)}`);

// A value spoken in words, or a Greek name the old list missed, is still the
// row's value; a comparison after "is" is not.
for (const [step, spoken] of [
  ["[STEP]so the force is six newtons. [WRITE:F = 6 N,90,211][/STEP]", "the force equals six newtons"],
  ["[STEP]the output power is eta times the input. [WRITE:P_out = η P_in,90,211][/STEP]", "the output power equals eta times"],
  ["[STEP]two squared is two times two. [WRITE:2^2 = 2 × 2,90,211][/STEP]", "two squared equals two times two"],
  ["[STEP]so each share is one third. [WRITE:s = 1/3,90,211][/STEP]", "each share equals one third"],
  ["[STEP]so the force is one hundred and five newtons. [WRITE:F = 105 N,90,211][/STEP]", "the force equals one hundred and five newtons"],
] as const) {
  assert(spokenAfter(step).includes(spoken), `a value in words or a Greek name is spoken as equals: ${spokenAfter(step)}`);
}
assert(spokenAfter("[STEP]so the selling price is ten percent less than its cost price. [WRITE:SP = 10% less than CP,90,211][/STEP]").includes("is ten percent less than"),
  "a comparison after is stays a comparison");

// Review of #345: a comparison past the spoken number, or a count ("one way",
// "one of the"), is not the row's value, and must not steal the rewrite from
// the sentence that states it.
for (const [step, kept] of [
  ["[STEP]the selling price is twenty five percent less than its cost price. [WRITE:SP = 25% less than CP,90,211][/STEP]", "is twenty five percent less than"],
  ["[STEP]the load is ten newtons or more. [WRITE:F = 10 N,90,211][/STEP]", "is ten newtons or more"],
  ["[STEP]the new car is two times faster. [WRITE:v = 2 u,90,211][/STEP]", "is two times faster"],
  ["[STEP]this is one of the most important results. [WRITE:n = 1,90,211][/STEP]", "is one of the most important"],
  ["[STEP]this is one common mistake. [WRITE:x = 1,90,211][/STEP]", "is one common mistake"],
  ["[STEP]this is one important result. [WRITE:N = 100000,90,211][/STEP]", "is one important result"],
  ["[STEP]Kinetic energy is one form of energy. [WRITE:KE = 1/2 m v^2,90,211][/STEP]", "Kinetic energy is one form of energy"],
  ["[STEP]That is two marks for this step. [WRITE:x = 2,90,211][/STEP]", "That is two marks for this step"],
  ["[STEP]the selling price is sixty five rupees less than the cost price. [WRITE:SP = 65 less than CP,90,211][/STEP]", "is sixty five rupees less than"],
  ["[STEP]the new price is eighteen percent more than the old one. [WRITE:P = 18% more than Q,90,211][/STEP]", "is eighteen percent more than"],
  ["[STEP]This is one in which friction acts. [WRITE:F = 1.5 N,90,211][/STEP]", "This is one in which friction acts"],
  ["[STEP]This is one with a twist. [WRITE:x = 1,90,211][/STEP]", "This is one with a twist"],
  ["[STEP]There is one. [WRITE:n = 1,90,211][/STEP]", "There is one"],
  ["[STEP]In total there is twenty newtons. [WRITE:F = 20 N,90,211][/STEP]", "there is twenty newtons"],
  ["[STEP]Here is one rupee. [WRITE:C = 1,90,211][/STEP]", "Here is one rupee"],
  ["[STEP]The trick is one I always use. [WRITE:x = 1,90,211][/STEP]", "The trick is one I always use"],
  // A value in words needs strong evidence (#345 round 5): a lone number word,
  // "in", or a unit used loosely is a missed cue by design, never an equals.
  ["[STEP]Here is one. [WRITE:n = 1,90,211][/STEP]", "Here is one"],
  ["[STEP]The object is ten centimeters from the lens. [WRITE:u = 10 cm,90,211][/STEP]", "The object is ten centimeters from the lens"],
  ["[STEP]This is one a lot of students miss. [WRITE:x = 1,90,211][/STEP]", "This is one a lot of students miss"],
  ["[STEP]This is two to the power of teamwork. [WRITE:x = 2,90,211][/STEP]", "This is two to the power of teamwork"],
  ["[STEP]two squared is four. [WRITE:2^2 = 4,90,211][/STEP]", "two squared is four"],
  ["[STEP]The pair is four and five. [WRITE:x = 4,90,211][/STEP]", "The pair is four and five"],
  ["[STEP]so the probability is one in six. [WRITE:P = 1/6,90,211][/STEP]", "the probability is one in six"],
] as const) {
  assert(spokenAfter(step).includes(kept), `a comparison, a count or a weak value stays as spoken: ${spokenAfter(step)}`);
}
const oneWay = spokenAfter("[STEP]The force is one hundred newtons. This is one way to check the result. [WRITE:F = 100 N,90,211][/STEP]");
assert(oneWay.includes("The force equals one hundred newtons") && oneWay.includes("This is one way to check"),
  `the value sentence keeps the rewrite, the count sentence keeps its words: ${oneWay}`);
// Large values and omicron lead too (Greptile P2s).
assert(spokenAfter("[STEP]the pressure is one hundred thousand pascals. [WRITE:P = 100000 Pa,90,211][/STEP]").includes("the pressure equals one hundred thousand"),
  "a value of one hundred thousand leads with its first word");
assert(spokenAfter("[STEP]so x is omicron y. [WRITE:x = ο y,90,211][/STEP]").includes("x equals omicron y"), "omicron leads by its spoken name");
assert(spokenAfter("[STEP]so the probability is one over six. [WRITE:P = 1/6,90,211][/STEP]").includes("the probability equals one over six"), "a fraction spoken in words is still the value");
// A number word is read whole: "sixty" is not "six" plus "ty", so the value is
// still found ("sixty meters per second") and a comparison after it still is.
assert(spokenAfter("[STEP]so the speed is sixty meters per second. [WRITE:v = 60 m/s,90,211][/STEP]").includes("the speed equals sixty meters per second"),
  "a longer number word is read whole, not cut at a shorter one");
// The count and value guards apply only to a value spoken in words: a symbol
// reading ("v final" for v_final) keeps #334's rule.
assert(spokenAfter("[STEP]so the velocity is v final. [WRITE:v = v_final,90,211][/STEP]").includes("the velocity equals v final"),
  "a symbol value keeps its equals even when a count word follows it");
assert(spokenAfter("[STEP]so the answer is twenty-five. [WRITE:x = 25,90,211][/STEP]").includes("the answer equals twenty-five"), "a hyphenated number word is a value");
assert(spokenAfter("[STEP]so x is two to the power of four. [WRITE:x = 2^4,90,211][/STEP]").includes("x equals two to the power of four"), "a power spoken in words is a value");

// A numeral needs strong evidence too, except that it may end the clause: "1"
// is never a pronoun the way "one" is. A unit used loosely, a count, "here is"
// and "there still is" stay as spoken.
for (const [step, kept] of [
  ["[STEP]The object is 10 centimeters from the lens. [WRITE:u = 10 cm,90,211][/STEP]", "The object is 10 centimeters from the lens"],
  ["[STEP]Ali is 10 years old. [WRITE:a = 10,90,211][/STEP]", "Ali is 10 years old"],
  ["[STEP]Here is 1. [WRITE:n = 1,90,211][/STEP]", "Here is 1"],
  ["[STEP]There still is 1. [WRITE:n = 1,90,211][/STEP]", "There still is 1"],
  ["[STEP]This is 2 of the cases. [WRITE:n = 2,90,211][/STEP]", "This is 2 of the cases"],
] as const) {
  assert(spokenAfter(step).includes(kept), `a numeral without strong evidence stays as spoken: ${spokenAfter(step)}`);
}
for (const [step, spoken] of [
  ["[STEP]so the answer is 25. [WRITE:x = 25,90,211][/STEP]", "the answer equals 25"],
  ["[STEP]so the frequency is 170 hertz. [WRITE:f = 170 Hz,90,211][/STEP]", "the frequency equals 170 hertz"],
  ["[STEP]25°C is 25 + 273 = 298 K. [WRITE:T = 25 + 273 = 298 K,90,211][/STEP]", "25°C equals 25 + 273"],
  ["[STEP]half of 9 V is 4.5 V. [WRITE:V = 4.5 V,90,211][/STEP]", "half of 9 V equals 4.5 V"],
  ["[STEP]the room is 25 °C. [WRITE:T = 25 °C,90,211][/STEP]", "the room equals 25 °C"],
  ["[STEP]the wavelength is 2 metres — consistent with step one. [WRITE:λ = 2 m,90,211][/STEP]", "the wavelength equals 2 metres —"],
] as const) {
  assert(spokenAfter(step).includes(spoken), `a numeral with strong evidence is spoken as equals: ${spokenAfter(step)}`);
}

console.log("lecture cue repair: equals on the friction row, box on the closing relation; only an is that its row's value follows becomes equals; repaired rows are never rewritten; tag-closed rows do not widen the spoken repair");
