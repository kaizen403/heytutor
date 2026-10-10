import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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

console.log("verify-early-lesson-opening: default-off policy, command-free opening and opening-only Stop classification verified");
