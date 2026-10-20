/** Real handler + parser + conductor + controller, without teaching providers. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getSegmentCommands, IncrementalTagParser, type TutorSegment } from "@heytutor/drawing";
import { dsaLessonIncludesCode, isExplanationOnlyDsaQuestion, type CodeLessonPlan } from "../../../../packages/tutor-core/src/code/codeLessonPlan";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { codeLessonResumeNote, createCodeLessonConductor } from "../../features/tutor-session/lib/code-lesson/codeLessonSegments";
import { resolveDsaFrames } from "../../features/tutor-session/lib/code-lesson/dsaFrames";
import { scenario } from "./verify-startup-turn";
import { buildDoubtTeachingPrompt, buildResumeTeachingPrompt, buildTurnTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";

const question = "Explain recursion in computer programming.";
const plan: CodeLessonPlan = { schemaVersion: "code-lesson/v1", question, title: "Recursive factorial", language: "python",
  sections: [{ id: "count", title: "Factorial", explanation: "Stop at one; otherwise multiply by the smaller factorial.",
    blocks: [{ id: "countb1", code: "def factorial(n):\n    if n <= 1:\n        return 1" },
      { id: "countb2", code: "    return n * factorial(n - 1)\n\nprint(factorial(3))" }], typeAlongRanges: [] }],
  diagramHint: { structure: "array", values: [3, 2, 1, 0], steps: [
    { id: "start", caption: "Start at three", values: [3, 2, 1, 0] },
    { id: "base", caption: "Reach zero", values: [3, 2, 1, 0] },
  ] } };
const frames = resolveDsaFrames(question, plan.diagramHint, plan);
assert(frames && frames.frames.length > 0, "the synthetic lesson uses the actual committed recursion walk");
const initial = frames.frames.map(frame => `[STEP]${frame.narrationIntent}[FOCUS:${frame.id}|spotlight][/STEP]`).join("\n");
const continuation = "[STEP]The function returns one at the base case.[TYPE:countb1][/STEP]" +
  "[STEP]The recursive return multiplies n by the smaller factorial, then the example invokes the function.[TYPE:countb2][/STEP]";
function parse(text: string) {
  const segments: TutorSegment[] = [];
  const parser = new IncrementalTagParser({ onSegmentReady: segment => segments.push(segment) });
  for (let index = 0; index < text.length; index += 11) parser.push(text.slice(index, index + 11));
  parser.flush(); return segments;
}
function obligations(sourcePlan: CodeLessonPlan, response: string) {
  const includeCode = dsaLessonIncludesCode(isExplanationOnlyDsaQuestion(sourcePlan.question));
  const conductor = createCodeLessonConductor(sourcePlan, { includeCode, frameCount: 0 });
  const output = conductor.resolve(parse(response));
  return { conductor, output, note: codeLessonResumeNote(conductor.status(), sourcePlan) };
}

async function main() {
assert.equal(isExplanationOnlyDsaQuestion(question), false, "programming context creates a real code obligation");
const pending = obligations(plan, initial);
assert.deepEqual(pending.conductor.status().missingBlockIds, ["countb1", "countb2"]);
assert.match(pending.note, /2 code blocks.*countb1/);
assert(!pending.output.segments.flatMap(getSegmentCommands).some(command => command.type === "TYPE"), "the runtime cannot fabricate code into a narration-only old response");
const turnPlan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [],
  qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "none" };
const result = await scenario("ready", false, false, { plan: turnPlan,
  recordedCodeLesson: { plan, response: initial, continuationResponses: [continuation], revealCommittedCode: true } });
assert("recordedCodeEvents" in result);
assert(result.recordedCodeEvents && result.recordedCodeTeachingRequests);
const requests = result.recordedCodeTeachingRequests;
assert.equal(requests.length, 2, "one genuine missing-obligation continuation is admitted, with no extra calls");
assert(requests[1]!.messages.some(message => message.role === "user" && /2 code blocks.*countb1/.test(message.content)),
  "the actual continuation names exactly what the code lesson still owes");
const commands = result.recordedCodeEvents.filter(event => event.name === "board-command").map(event => event.data) as Array<{ type: string; semanticRef?: { entityId?: string }; text?: string }>;
assert.deepEqual(commands.filter(command => command.type === "TYPE").map(command => command.semanticRef?.entityId), ["countb1", "countb2"]);
assert.deepEqual(result.recordedCodeEvents.filter(event => event.name === "typed-code").map(event => event.data),
  plan.sections.flatMap(section => section.blocks.map(block => ({ id: block.id, code: block.code }))),
  "the actual committed program types in full, with exact source and no fabricated or truncated lines");
assert.equal(pending.conductor.resolve(parse(continuation)).unknownBlockIds.length, 0);
assert.deepEqual(pending.conductor.status().missingBlockIds, []);

// Private recorded output is replayed without rewriting its words. It stays
// missing until a separately supplied, clearly synthetic continuation is used.
if (process.env.KIMI_CODE_RECORDED_FILE) {
  const recorded = JSON.parse(readFileSync(process.env.KIMI_CODE_RECORDED_FILE, "utf8")) as Array<{ plan: CodeLessonPlan; response: string; expectedMissing: string[] }>;
  let missing = 0, typed = 0;
  for (const item of recorded) {
    const actual = obligations(item.plan, item.response);
    assert.deepEqual(actual.conductor.status().missingBlockIds, item.expectedMissing);
    if (item.expectedMissing.length > 0) {
      assert(actual.note.includes(item.expectedMissing[0]!));
      assert(actual.note.includes(`${item.expectedMissing.length} code blocks`));
    }
    const commands = actual.output.segments.flatMap(getSegmentCommands).filter(command => command.type === "TYPE");
    const blocks = item.plan.sections.flatMap(section => section.blocks);
    for (const command of commands) assert.equal(command.text, blocks.find(block => block.id === command.semanticRef?.entityId)?.code,
      "recorded code commands retain exact committed source");
    missing += item.expectedMissing.length; typed += commands.length;
  }
  console.log(`Private recorded streams: ${recorded.length}; ${missing} missing code obligations, ${typed} exact typed blocks; no fabricated typing`);
}
const pacing = { ...turnPlan, question: "Calculate pressure from a stated resistance and flow." };
const common = { turnPlan: pacing, solverProjection: null, familiarity: "normal" as const, fastMode: true,
  diagramPromptAddon: null, boardRows: [{ workId: "w1", text: "p = q r" }], rowsLeftOnPage: 3, nextRowY: 211, codePanelShowing: false };
const fresh = buildTurnTeachingPrompt({ ...common, question: pacing.question, codeLesson: null, isDsa: false });
const doubt = buildDoubtTeachingPrompt({ ...common, lessonQuestion: pacing.question });
assert(doubt.runtimeAddon.includes("Your first step points and writes nothing"));
assert(doubt.runtimeAddon.includes("write only the lines that are missing"), "Teach it again must reuse visible rows rather than invent new writing");
const codeDoubt = buildDoubtTeachingPrompt({ ...common, lessonQuestion: pacing.question, codePanelShowing: true, codePanelText: "return value", narrationLanguage: "hinglish" });
assert(codeDoubt.runtimeAddon.includes("Never [WRITE], never [TYPE] and never [FOCUS]"));
assert(codeDoubt.runtimeAddon.includes("For a step that writes a new board row"), "the final language policy applies only to writing steps");
const pointerOnly = parse("[STEP]This is the existing row.[EMPHASIZE:w1|p = q r][/STEP]");
assert(pointerOnly.flatMap(getSegmentCommands).every(command => command.type !== "WRITE"), "a pointing-only doubt remains pointing-only");
for (const built of [fresh, doubt, ...(["stop", "doubt"] as const).map(reason => buildResumeTeachingPrompt({ ...common, lessonQuestion: pacing.question, reason }))])
  for (const prompt of [built.systemPrompt, built.continuationPrompt]) assert(prompt.includes("begin with the spoken board row"), "every actual non-code prompt path retains row-first guidance");
console.log("verify-kimi-code-obligations: actual handler requests missing blocks and types the exact committed IDs; no providers");

}
main().catch(error => { console.error(error); process.exitCode = 1; });
