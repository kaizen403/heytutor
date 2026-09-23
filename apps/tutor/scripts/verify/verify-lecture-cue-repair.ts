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

console.log("lecture cue repair: equals on the friction row, box on the closing relation");
