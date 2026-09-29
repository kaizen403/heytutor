import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { IncrementalTagParser, parseDrawingCommands, prepareVerifiedLessonSegments, type TutorSegment } from "@heytutor/drawing";
import { canStreamResumeRepair, createResumeInkGate, isTeachingResponseIncomplete, normalizeSegmentForAlignment, shouldRepairResumeWithoutInk } from "../../features/tutor-session/lib/turn/segmentPlanning";
import { pausedLessonFromLive } from "../../features/tutor-session/lib/turn/doubtTurn";
import { LectureMarkupBuffer } from "../../features/tutor-session/lib/turn/lectureCueRepair";
import { buildResumeTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const speechOnly: TutorSegment = { narration: "Now substitute the value and solve for x.", command: null };
const write = parseDrawingCommands("[WRITE:x = 12,100,140]").commands[0]!;
const nextStep: TutorSegment = { narration: "So x is twelve.", command: write };

const gate = createResumeInkGate();
assert(gate.offer(speechOnly).length === 0, "a resumed lesson must not speak before its first board action");
assert(!gate.hasInk(), "speech alone is not a resumed board lesson");
const released = gate.offer(nextStep);
assert(released.length === 1 && released[0] === nextStep,
  "speech-only lead-in must not play before the first resumed written step");
assert(gate.hasInk(), "the resumed lesson has reached a board-writing step");
assert(gate.offer(speechOnly).length === 1, "normal narration may follow once the pen starts");

const silentInkGate = createResumeInkGate();
const silentWrite: TutorSegment = { narration: "", command: write };
assert(silentInkGate.offer(silentWrite).length === 0 && !silentInkGate.hasInk(),
  "a silent WRITE cannot count as the first spoken-and-written resumed step");
assert(silentInkGate.offer(speechOnly).length === 0,
  "speech after a silent WRITE must not become an audio-only continuation");
assert(silentInkGate.offer(nextStep).length === 1 && silentInkGate.hasInk(),
  "the first audible step must carry its own ink");
assert(canStreamResumeRepair(3, 2, true), "a corrective retry must get one extra request after the normal continuation budget");
assert(!canStreamResumeRepair(3, 2, false), "ordinary continuation must stay bounded");
assert(!canStreamResumeRepair(4, 2, true), "a corrective retry cannot get a second extra request");
assert(canStreamResumeRepair(2, 2, false), "the last ordinary continuation remains available");
const openStep = "[STEP]We must now find the next value";
assert(isTeachingResponseIncomplete(openStep, openStep), "an unclosed final STEP is incomplete");
assert(shouldRepairResumeWithoutInk(true, 2, 2),
  "an incomplete no-ink chunk at the budget limit must reserve a corrective retry");
assert(!shouldRepairResumeWithoutInk(true, 1, 2),
  "an incomplete no-ink chunk before the limit should continue normally");
assert(shouldRepairResumeWithoutInk(false, 0, 2),
  "a closed speech-only chunk should be repaired immediately");

const bufferedInk = createResumeInkGate();
const bufferedMarkup = new LectureMarkupBuffer();
let bufferedStep: TutorSegment | null = null;
const bufferedParser = new IncrementalTagParser({
  preserveStepSpeech: true,
  onSegmentReady: (segment) => {
    if (bufferedStep) {
      const prepared = prepareVerifiedLessonSegments([bufferedStep], null);
      for (const entry of prepared.segments) bufferedInk.offer(normalizeSegmentForAlignment(entry));
    }
    bufferedStep = segment;
  },
});
const openWrittenStep = "[STEP]The next result is twelve. [WRITE:x = 12,100,140]";
bufferedParser.push(bufferedMarkup.push(openWrittenStep));
assert(!bufferedInk.hasInk(), "unclosed STEP ink remains buffered until the final stream flush");
const pendingInk = bufferedMarkup.finish();
if (pendingInk) bufferedParser.push(pendingInk);
bufferedParser.flush();
if (bufferedStep) {
  const prepared = prepareVerifiedLessonSegments([bufferedStep], null);
  for (const entry of prepared.segments) bufferedInk.offer(normalizeSegmentForAlignment(entry));
}
assert(bufferedInk.hasInk(), "an open final STEP must reveal its valid WRITE before a retry decision");

const onlySpeech = createResumeInkGate();
onlySpeech.offer(speechOnly);
assert(!onlySpeech.hasInk(), "a closed speech-only STEP must request repair rather than complete the lesson");
onlySpeech.reset();
assert(onlySpeech.offer(nextStep).length === 1, "a repaired response must start without replaying rejected speech");

const focusGate = createResumeInkGate();
focusGate.offer({ narration: "Look at the triangle.", command: parseDrawingCommands("[FOCUS:triangle]").commands[0]! });
assert(!focusGate.hasInk(), "pointing alone cannot count as the missing derivation ink");

const streamed = createResumeInkGate();
const releasedStream: TutorSegment[] = [];
const parser = new IncrementalTagParser({
  preserveStepSpeech: true,
  onSegmentReady: (segment) => {
    const prepared = prepareVerifiedLessonSegments([segment], null);
    for (const entry of prepared.segments) {
      releasedStream.push(...streamed.offer(normalizeSegmentForAlignment(entry)));
    }
  },
});
parser.push("[STEP]Now we continue the derivation.[/STEP]");
parser.flush();
assert(releasedStream.length === 0, "a real closed speech-only STEP must not begin playback");
streamed.reset();
parser.push("[STEP]The sine ratio is five over thirteen. [WRITE:sin theta = 5/13,100,140][/STEP]");
parser.flush();
assert(releasedStream.some((segment) => segment.commands?.some((command) => command.type === "WRITE")),
  "the repaired, parsed lesson must reach playback with a real WRITE");

const positions: number[] = [];
let retryParser = new IncrementalTagParser({
  preserveStepSpeech: true,
  onSegmentReady: (segment) => positions.push(...(segment.commands ?? []).map((command) => command.charPosition)),
});
retryParser.push("[STEP]An unwanted first answer with many words.[/STEP]");
retryParser.flush();
retryParser = new IncrementalTagParser({ preserveStepSpeech: true, onSegmentReady: retryParser.onSegmentReady });
retryParser.push("[STEP]We write twelve. [WRITE:x = 12,100,140][/STEP]");
retryParser.flush();
const freshPositions: number[] = [];
const freshParser = new IncrementalTagParser({ preserveStepSpeech: true,
  onSegmentReady: (segment) => freshPositions.push(...(segment.commands ?? []).map((command) => command.charPosition)),
});
freshParser.push("[STEP]We write twelve. [WRITE:x = 12,100,140][/STEP]");
freshParser.flush();
assert(positions.length === 1 && positions[0] === freshPositions[0],
  "a retried WRITE offset must match its retained response rather than the discarded attempt");

const paused = pausedLessonFromLive({
  record: null,
  boardId: "board-1",
  lessonQuestion: "Find the angle in a 5-12-13 triangle",
  codeLesson: false,
  figureDrawn: true,
  lessonBoardRows: [{ text: "sin theta = 5/13" }],
  interruptedStep: "Next we find the adjacent side.",
});
assert(paused?.lessonBoardRows?.[0]?.text === "sin theta = 5/13", "the pre-doubt work survives an overflow page");
const prompt = buildResumeTeachingPrompt({
  lessonQuestion: paused.lessonQuestion,
  boardRows: [{ text: "Why is arcsin acute?" }],
  lessonBoardRows: paused.lessonBoardRows,
  interruptedStep: paused.interruptedStep,
  rowsLeftOnPage: 3,
  nextRowY: 200,
  diagramPromptAddon: null,
  codePanelShowing: false,
  turnPlan: null,
  solverProjection: null,
  familiarity: "normal",
  fastMode: false,
});
assert(prompt.runtimeAddon.includes("sin theta = 5/13"), "resume must see the pre-doubt step");
assert(prompt.runtimeAddon.includes("Next we find the adjacent side"), "resume must know the interrupted idea");
assert(prompt.runtimeAddon.includes("Why is arcsin acute?"), "resume must also see the current doubt page");

const source = readFileSync(resolve(__dirname, "../../features/tutor-session/hooks/turn/useQuestionHandler.ts"), "utf8");
assert(source.includes("createResumeInkGate("), "the live resume path must use the ink gate");
assert(/resumeInkGate\.offer\(normalizeSegmentForAlignment\(seg\)\)/.test(source), "filtered stream segments must pass through the gate");
const flushBody = source.split("const flushBufferedSegment = () => {")[1]?.split("let markup =")[0] ?? "";
assert(flushBody.includes("if (!resumeInkGate) {") &&
  flushBody.includes("if (!codeLesson) enqueueLessonOpening();") &&
  flushBody.includes("if (resumeInkGate && readySegments.length > 0) enqueueLessonOpening();"),
  "a failed resume must not enqueue its figure intro before a written step passes the ink gate");
assert(source.includes("resumeInkGate.reset()"), "speech-only first attempts must be discarded before retry");
assert(source.includes("resumeInkGate.hasInk()"), "the final response must be checked for ink");
assert(source.includes("offerPausedLessonResume(resume)"), "a failed generation must keep Continue available for another try");
const billingGate = source.split("billed = await beginTurn(")[1]?.split("const partialTurnSaved =")[0] ?? "";
assert(billingGate.split("if (resume) offerPausedLessonResume(resume);").length === 3,
  "network and billing failures before teaching must each restore Continue");
const teachingFailure = source.split("console.error(\"Tutor error:\", error);")[1]?.split("} finally {")[0] ?? "";
const teachingCleanup = source.split("} finally {")[1]?.split("finishLectureUi(turnGeneration);")[0] ?? "";
assert(teachingFailure.includes("resumeFailed = Boolean(resume);") &&
  teachingCleanup.includes("if (resumeFailed && resume && isCurrentTurn()) offerPausedLessonResume(resume);"),
  "a teaching-stream error must restore Continue after pending board work settles");
assert(source.includes("canStreamResumeRepair(continueCount, MAX_LLM_CONTINUATIONS, resumeInkRetry)"),
  "the live stream must allow the reserved corrective retry");
assert(source.includes("shouldRepairResumeWithoutInk(chunkIncomplete, continueCount, MAX_LLM_CONTINUATIONS)"),
  "the live stream must repair an unfinished no-ink response at the continuation limit");
const beforeRetryDecision = source.split("const chunkIncomplete = isTeachingResponseIncomplete(")[1]?.split("if (\n            resumeInkGate && !resumeInkGate.hasInk()")[1] ?? "";
assert(beforeRetryDecision.includes("markup?.finish()") && beforeRetryDecision.includes("flushBufferedSegment()"),
  "flush buffered final STEP ink before deciding whether to spend the corrective retry");
assert(source.includes("parser = new IncrementalTagParser({"), "a rejected attempt must not leak parser offsets into the retry");
const runner = readFileSync(resolve(__dirname, "../../features/tutor-session/hooks/turn/useSegmentRunner.ts"), "utf8");
const onStartBody = runner.split("const markVoiceStarted = () => {")[1]?.split("const speakOptions =")[0] ?? "";
const beforePlayback = runner.split("let segmentCompleted = false;")[1]?.split("try {")[0] ?? "";
assert(onStartBody.includes("speakingNarrationRef.current = narration;") &&
  !beforePlayback.includes("speakingNarrationRef.current = narration;"),
  "a sentence must enter interrupted history only after speech starts");
console.log("resume ink verification passed");
