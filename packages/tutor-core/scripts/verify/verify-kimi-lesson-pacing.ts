/** Pacing is a prompt contract; it must never be enforced by dropping work. */
import assert from "node:assert/strict";
import { getSegmentCommands, IncrementalTagParser, type TutorSegment } from "@heytutor/drawing";
import { HINGLISH_NARRATION_ADDON } from "../../src/llm/hinglishNarration";
import { TUTOR_CONTINUATION_PROMPT, TUTOR_SYSTEM_PROMPT } from "../../src/llm/systemPrompt";
import { lessonScopePromptAddon, resolveLessonBudget } from "../../src/llm/lessonScope";
import { dsaLessonIncludesCode, isExplanationOnlyDsaQuestion } from "../../src/code/codeLessonPlan";

for (const prompt of [TUTOR_SYSTEM_PROMPT, TUTOR_CONTINUATION_PROMPT,
  lessonScopePromptAddon(resolveLessonBudget("Calculate a gain, a resistance and an operating point.")),
  lessonScopePromptAddon(resolveLessonBudget("Explain force and acceleration."), { conceptLesson: true })]) {
  assert(prompt.includes("For a step that writes a new board row, begin with the spoken board row"), "the first useful cue belongs near the beginning, before the explanation");
  assert(prompt.includes("brief necessary condition"), "a condition must precede the numeric result it qualifies");
  assert(!/words that name the row come last|do not keep talking after the tag|then the step ends/i.test(prompt),
    "no later instruction may restore the reason-first contract");
}
assert(!HINGLISH_NARRATION_ADDON.includes("row come last"), "the final language override cannot reverse row-first timing");
assert(HINGLISH_NARRATION_ADDON.includes("brief necessary condition"));
assert(HINGLISH_NARRATION_ADDON.includes("For a step that writes a new board row"), "the final language addon must preserve code/doubt no-WRITE exceptions");
const scope = lessonScopePromptAddon({ scope: "extended", minSteps: 18, maxSteps: 24, boardPages: 4 });
assert(scope.includes("18-24 steps"), "keep the real range rather than inflating it to excuse overrun");
assert(scope.includes("two short consecutive rows"), "a coherent algebraic move can retain both rows without two announcements");
assert(scope.includes("Never drop an intermediate row"), "meeting a range cannot truncate the solution");
assert(!scope.includes("write every intermediate line rather than jumping"), "the range cannot also demand a new step for every trivial transformation");

// The public parser must retain both commands, the reason and their original
// spoken windows when the prompt groups rows. The model is not being graded here.
const row = "[STEP]assuming steady flow, p equals q r.[WRITE:p = q r,90,145]Dividing by r gives p over r equals q.[WRITE:p/r = q,90,211]Both lines express the same relation.[/STEP]";
const segments: TutorSegment[] = [];
const parser = new IncrementalTagParser({ preserveStepSpeech: true, onSegmentReady: segment => segments.push(segment) });
for (let i = 0; i < row.length; i += 7) parser.push(row.slice(i, i + 7));
parser.flush();
assert.equal(segments.length, 1);
assert.deepEqual(segments.flatMap(getSegmentCommands).filter(command => command.type === "WRITE").map(command => command.text), ["p = q r", "p/r = q"]);
assert.match(segments[0]!.narration, /assuming steady flow.*Dividing by r.*Both lines express the same relation/s);

assert.equal(dsaLessonIncludesCode(true), false, "explicit visual policy remains available");
assert(!isExplanationOnlyDsaQuestion("Explain recursion in computer programming."), "a programming explanation owes a concrete program");
for (const request of ["Explain recursion in programming without code.", "Explain recursion in programming, do not show a program.", "Explain recursion in programming without code using diagrams.", "Explain recursion in programming without code and only a visual example.", "Explain recursion in programming without code in the answer.", "Explain recursion in programming without code snippets."])
  assert(isExplanationOnlyDsaQuestion(request), "explicit no-code instructions win");
assert(!isExplanationOnlyDsaQuestion("Explain recursion in programming with no code duplication."), "a quality constraint is not a request to hide code");
assert(isExplanationOnlyDsaQuestion("Explain dynamic programming for coin change."), "a technique name alone does not request implementation");
assert(isExplanationOnlyDsaQuestion("Explain merge sort using a worked array."), "existing visual algorithm explanations stay visual");
console.log("verify-kimi-lesson-pacing: row-first prompts, retained grouped work and minimal programming intent pass; zero providers");
