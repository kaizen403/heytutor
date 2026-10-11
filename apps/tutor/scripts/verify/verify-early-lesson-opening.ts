import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serializeSegmentCommands } from "@heytutor/drawing";
import { getMockCodeLessonPlan } from "@heytutor/tutor-core";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { lessonPageRecord, pausedLessonFromLive } from "../../features/tutor-session/lib/turn/doubtTurn";
import { lessonRecoveryFromStoredTurns, pausedLessonFromStoredTurns } from "../../features/tutor-session/lib/turn/pausedLessonRestore";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import {
  buildEarlyLessonOpeningSegment,
  classifyEarlyLessonProgress,
  shouldStartEarlyLessonOpening,
} from "../../features/tutor-session/lib/turn/earlyLessonOpening";

const freshLesson = {
  kind: "lesson" as const,
  isDsa: false,
  admitted: true,
  current: true,
  paused: false,
};

const openingModuleUrl = new URL("../../features/tutor-session/lib/turn/earlyLessonOpening.ts", import.meta.url).href;
for (const [flag, expected] of [[undefined, false], ["0", false], ["true", false], ["1", true]] as const) {
  const childEnv = { ...process.env };
  if (flag === undefined) delete childEnv.NEXT_PUBLIC_EARLY_LESSON_OPENING;
  else childEnv.NEXT_PUBLIC_EARLY_LESSON_OPENING = flag;
  const childResult = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    const loaded = await import(${JSON.stringify(openingModuleUrl)});
    const module = loaded.default ?? loaded;
    console.log(JSON.stringify({
      enabled: module.EARLY_LESSON_OPENING_ENABLED,
      admitted: module.shouldStartEarlyLessonOpening(${JSON.stringify(freshLesson)})
    }));
  `], { cwd: fileURLToPath(new URL("../../", import.meta.url)), env: childEnv, encoding: "utf8" });
  assert.deepEqual(JSON.parse(childResult), { enabled: expected, admitted: expected },
    `only literal 1 enables the feature; flag ${flag ?? "absent"} must remain intentional`);
}

assert.equal(shouldStartEarlyLessonOpening({ ...freshLesson, enabled: false }), false,
  "an explicitly disabled experiment must not start an opening");
assert.equal(shouldStartEarlyLessonOpening({ ...freshLesson, enabled: true }), true,
  "an enabled, admitted, current fresh standard lesson may start its safe opening");

for (const [name, input] of [
  ["DSA", { ...freshLesson, isDsa: true }],
  ["doubt", { ...freshLesson, kind: "doubt" as const }],
  ["resume", { ...freshLesson, kind: "resume" as const }],
  ["unbilled", { ...freshLesson, admitted: false }],
  ["stale generation", { ...freshLesson, current: false }],
  ["paused", { ...freshLesson, paused: true }],
] as const) {
  assert.equal(shouldStartEarlyLessonOpening({ ...input, enabled: true }), false,
    `${name} turns must keep their existing speech and authority gates`);
}

const englishOpening = buildEarlyLessonOpeningSegment();
assert.deepEqual(englishOpening, {
  narration: "Okay, let's take this question one step at a time.",
  command: null,
  delivery: "opening",
}, "the pre-authority opening is one fixed command-free sentence, not a model answer");
const hinglishOpening = buildEarlyLessonOpeningSegment("hinglish");
assert.equal(hinglishOpening.narration, "ठीक है, इस सवाल को आराम से समझते हैं.",
  "the Hinglish voice needs a language-matched safe opening");
for (const opening of [englishOpening, hinglishOpening]) {
  assert.equal(opening.command, null, "early speech has no drawing or writing authority");
  assert.equal(opening.commands, undefined, "no hidden multi-command ink may accompany an opening");
  assert(!/[\d\[\]<>]/u.test(opening.narration), "opening carries neither numeric results nor protocol tags");
  assert(!/\b(?:draw|diagram|figure|answer|equals|given|therefore)\b/i.test(opening.narration),
    "opening makes no figure, answer, given-value or equation claim");
}

assert.equal(classifyEarlyLessonProgress({
  earlyOpeningStarted: true, spokenSegments: [englishOpening], figureDrawn: false,
}), "opening_only", "a recorded early opening alone must not unlock Continue with a null plan");
assert.equal(classifyEarlyLessonProgress({
  earlyOpeningStarted: true, spokenSegments: [], activeNarration: englishOpening.narration, figureDrawn: false,
}), "opening_only", "Stop in the middle of the opening must restart planning, not skip it");
assert.equal(classifyEarlyLessonProgress({
  earlyOpeningStarted: true, spokenSegments: [], figureDrawn: false,
}), "none", "an opening queued but never heard is not taught content");

for (const [name, progress] of [
  ["verified figure", { spokenSegments: [englishOpening], figureDrawn: true }],
  ["recorded teaching", { spokenSegments: [englishOpening, { narration: "The displacement is the change in position." }], figureDrawn: false }],
  ["active teaching", { spokenSegments: [englishOpening], activeNarration: "A radius meets the tangent at a right angle.", figureDrawn: false }],
  ["work row", { spokenSegments: [{ ...englishOpening, command: { type: "WRITE", text: "F = ma" } }], figureDrawn: false }],
  ["multi-command ink", { spokenSegments: [{ ...englishOpening, commands: [{ type: "FOCUS" }] }], figureDrawn: false }],
  ["silent ink", { spokenSegments: [{ narration: "", command: { type: "WRITE", text: "setup" } }], figureDrawn: false }],
] as const) {
  assert.equal(classifyEarlyLessonProgress({ ...progress, earlyOpeningStarted: true }), "substantive",
    `${name} must not be erased or restarted as a mere early opening`);
}
assert.equal(classifyEarlyLessonProgress({
  earlyOpeningStarted: false, spokenSegments: [englishOpening], figureDrawn: false,
}), "substantive", "matching words without this turn's early-opening ownership are not exempt");
assert.equal(classifyEarlyLessonProgress({
  earlyOpeningStarted: true, spokenSegments: [hinglishOpening], figureDrawn: false,
}), "opening_only", "the Hinglish opening has the same planning-restart requirement");

assert.equal(classifyEarlyLessonProgress({
  earlyOpeningStarted: true, spokenSegments: [{ narration: "   ", command: null }], activeNarration: " ", figureDrawn: false,
}), "none", "empty rows and pending queue bookkeeping cannot unlock Continue");
assert.equal(classifyEarlyLessonProgress({
  earlyOpeningStarted: true, spokenSegments: [{ narration: `${englishOpening.narration} The answer is six.` }], figureDrawn: false,
}), "substantive", "an answer joined to a generic opening must not hide substantive teaching");
assert.equal(classifyEarlyLessonProgress({
  earlyOpeningStarted: true, spokenSegments: [{ ...englishOpening, command: { commands: [{ type: "WRITE" }] } }], figureDrawn: false,
}), "substantive", "a recorded command envelope is substantive even if its narration matches the opening");

const question = "Derive the formula for projectile range on level ground.";
const stopped: StoredTurn = {
  id: "opening-only-parent", orderIndex: 0, question, rawResponse: englishOpening.narration,
  speedMultiplier: 1, traceId: "opening-only-trace", kind: "lesson", status: "stopped", persistedStatus: "stopped",
  sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only", sceneArtifacts: null,
  resumeState: { v: 1, earlyOpeningOnly: true },
  segments: [{ id: "opening-only-segment", orderIndex: 0, narration: englishOpening.narration,
    spokenText: englishOpening.narration, command: null, audioUrl: null, durationMs: null, timings: null }],
};
const reload = (turn: StoredTurn) => pausedLessonFromStoredTurns([turn], { boardId: "opening-only-board", ownerState: "inactive" });
assert.equal(reload(stopped), null, "reload must offer Teach again, not Continue past an unfinished plan");
const epoch = { ...stopped.segments[0]!, id: "epoch", orderIndex: 0, narration: "", spokenText: "",
  command: { type: "CLEAR" as const, params: [], charPosition: 0, narrationBefore: "" } };
for (const epochCommand of [epoch.command, { commands: [epoch.command] }]) {
  const withEpoch = { ...stopped, segments: [{ ...epoch, command: epochCommand }, { ...stopped.segments[0]!, orderIndex: 1 }] };
  assert.equal(reload(withEpoch), null,
    "the real saved blank epoch CLEAR cannot authorize Continue past unfinished planning");
  assert.equal(lessonRecoveryFromStoredTurns([withEpoch], { boardId: "opening-only-board", ownerState: "inactive" })?.kind, "restart");
  assert.equal(lessonRecoveryFromStoredTurns([{ ...withEpoch, segments: withEpoch.segments.slice(0, 1) }],
    { boardId: "opening-only-board", ownerState: "inactive" })?.kind, "restart", "a queued/unheard marked opening is restartable");
}
for (const [name, command, narration] of [
  ["silent WRITE", { type: "WRITE", text: "setup", params: [] }, ""],
  ["FOCUS", { type: "FOCUS", params: [] }, ""],
  ["unknown direct input", { unknown: true }, ""],
  ["unknown scalar input", "opaque", ""],
  ["empty command envelope", { commands: [] }, ""],
  ["mixed CLEAR and WRITE", { commands: [epoch.command, { type: "WRITE", text: "setup", params: [] }] }, ""],
  ["narrated CLEAR", epoch.command, englishOpening.narration],
] as const) {
  // Malformed historical command JSON is deliberately exercised at this boundary.
  const turn = { ...stopped, segments: [epoch, { ...stopped.segments[0]!, orderIndex: 1,
    command: command as StoredTurn["segments"][number]["command"], narration }] };
  assert.notEqual(lessonRecoveryFromStoredTurns([turn], { boardId: "opening-only-board", ownerState: "inactive" })?.kind,
    "restart", `${name} cannot use the blank epoch exemption`);
}
assert(reload({ ...stopped, resumeState: null }), "unmarked legacy speech retains its existing Continue behavior");
assert(reload({ ...stopped, segments: [{ ...stopped.segments[0]!, narration: "The horizontal speed stays constant." }] }),
  "a stale opening marker cannot discard substantive speech");
const turnPlan = { schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [],
  qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
assert(reload({ ...stopped, sceneArtifacts: { turnPlan } }), "a completed authoritative plan survives an old opening marker");
const codeLesson = getMockCodeLessonPlan("Explain LeetCode 20 Valid Parentheses");
assert(reload({ ...stopped, sceneArtifacts: { codeLesson } }), "DSA authority never becomes an opening restart");
assert(reload({ ...stopped, segments: [{ ...stopped.segments[0]!, command: serializeSegmentCommands([
  { type: "DRAW_LINE", params: [500, 200, 700, 300], charPosition: 0, narrationBefore: "" },
], { trustedDiagramGeometry: true }) }] }), "actual trusted figure ink remains substantive");
const page = { ...lessonPageRecord("opening-only-board", question), earlyOpeningStarted: true };
const doubtSnapshot = { record: page, boardId: page.boardId, lessonQuestion: question,
  codeLesson: false, figureDrawn: false, interruptedStep: englishOpening.narration };
assert.equal(pausedLessonFromLive(doubtSnapshot), null, "an opening-only doubt cannot resume an unplanned lesson");
assert(pausedLessonFromLive({ ...doubtSnapshot, record: { ...page, earlyOpeningStarted: false } }),
  "default-off planning snapshots remain unchanged");
assert(pausedLessonFromLive({ ...doubtSnapshot, figureDrawn: true }), "visible verified ink remains a real continuation");
assert(pausedLessonFromLive({ ...doubtSnapshot, spokenSegments: [{ narration: "", command: { type: "WRITE", text: "setup" } }] }),
  "earlier substantive rows survive an opening marker even when the interrupted words match the opening");

const multiline = { ...stopped, question: "Derive projectile range.\nState the assumptions.", segments: [epoch, ...stopped.segments] };
const doubt: StoredTurn = { ...stopped, id: "answered-doubt", orderIndex: 1, kind: "doubt", question: "Clarify the symbols",
  status: "complete", persistedStatus: "complete", resumeState: null, sceneArtifacts: boardContinuationArtifacts(multiline.question),
  segments: [{ ...stopped.segments[0]!, narration: "The symbol denotes launch speed.", spokenText: "The symbol denotes launch speed." }] };
const recovery = lessonRecoveryFromStoredTurns([multiline, doubt], { boardId: "opening-only-board", ownerState: "inactive" });
assert.equal(recovery?.kind, "restart");
assert.equal(recovery?.request.lessonQuestion, multiline.question, "restart uses the complete original lesson rather than the doubt title");
assert.equal(recovery?.request.reason, "doubt");
assert.equal(recovery?.request.parentTurnId, stopped.id);
for (const ownerState of ["active", "unknown"] as const) {
  assert.equal(lessonRecoveryFromStoredTurns([multiline, doubt], { boardId: "opening-only-board", ownerState }), null);
}
for (const turn of [
  { ...multiline, status: "complete" as const, persistedStatus: "complete" as const },
  { ...multiline, persistedStatus: undefined },
  { ...multiline, status: "live" as const, persistedStatus: "live" as const, updatedAt: Date.now() },
]) assert.equal(lessonRecoveryFromStoredTurns([turn], { boardId: "opening-only-board", ownerState: "inactive" }), null);
assert.equal(lessonRecoveryFromStoredTurns([multiline, { ...multiline, id: "newer-same-text-page", orderIndex: 2,
  status: "complete", persistedStatus: "complete" }], { boardId: "opening-only-board", ownerState: "inactive" }), null,
  "same question on a newer complete page never resurrects the stopped opening");

const packageScripts = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).scripts;
for (const mode of ["early-stop", "early-doubt", "early-pause"]) {
  assert(packageScripts["verify:early-opening"].includes(`verify-startup-turn.ts ${mode}`),
    `publication's early opening gate must execute the actual-hook ${mode} boundary`);
}

console.log("verify-early-lesson-opening: default-off policy, command-free opening and opening-only Stop classification verified");
