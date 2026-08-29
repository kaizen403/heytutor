import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeTutorQuestion } from "@heytutor/tutor-core";
import { shouldFlushPendingQuestion } from "../../features/tutor-session/hooks/turn/useQuestionHandler";
import {
  autoQuestionSubmissionKey,
  buildDoubtPrompt,
  buildInterruptedLessonExchange,
  doubtInterruptsLesson,
  isRuntimeReadyForDoubt,
  DOUBT_INTERRUPT_HINT,
  DOUBT_PLACEHOLDER,
} from "../../features/tutor-session/lib/askDoubt";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const idle = {
  phase: "idle" as const,
  turnActive: false,
  isReplaying: false,
  pendingSegmentCount: 0,
};

assert(!doubtInterruptsLesson(idle), "an idle board has no lesson to interrupt");
assert(
  doubtInterruptsLesson({ ...idle, phase: "speaking" }),
  "a speaking lesson must be stopped before the doubt turn",
);
assert(
  doubtInterruptsLesson({ ...idle, phase: "thinking" }),
  "a doubt during planning must still stop that turn",
);
assert(
  doubtInterruptsLesson({ ...idle, turnActive: true }),
  "a turn that owns the board must be stopped before the doubt turn",
);
assert(
  doubtInterruptsLesson({ ...idle, isReplaying: true }),
  "a replay must be stopped before the doubt turn",
);

assert(isRuntimeReadyForDoubt(idle), "a fully idle runtime accepts the doubt turn");
for (const busy of [
  { ...idle, phase: "drawing" as const },
  { ...idle, turnActive: true },
  { ...idle, isReplaying: true },
  { ...idle, pendingSegmentCount: 1 },
]) {
  assert(
    !isRuntimeReadyForDoubt(busy),
    "handleQuestion drops a question while the previous turn unwinds; the doubt must wait",
  );
}

// The doubt turn goes through handleQuestion, so the two readiness rules must
// agree — a tighter guard there would silently swallow every doubt.
for (const state of [
  idle,
  { ...idle, phase: "speaking" as const },
  { ...idle, turnActive: true },
  { ...idle, pendingSegmentCount: 2 },
]) {
  assert(
    isRuntimeReadyForDoubt(state) ===
      shouldFlushPendingQuestion({
        pendingQuestion: "why is it negative",
        boardLoaded: true,
        hasWhiteboard: true,
        phase: state.phase,
        turnActive: state.turnActive,
        pendingSegmentCount: state.pendingSegmentCount,
      }),
    "doubt readiness must match the question handler's own accept rule",
  );
}

const bare = buildDoubtPrompt("  why is the normal force there  ");
assert(bare.includes("why is the normal force there"), "the doubt text must survive");
assert(!bare.includes("  "), "the doubt prompt must be trimmed");

const contextual = buildDoubtPrompt("why is it negative", "a block slides down a 30 degree incline");
assert(
  contextual.includes("why is it negative"),
  "an interrupted doubt must keep the student's words",
);
assert(
  contextual.includes("a block slides down a 30 degree incline"),
  "an interrupted doubt must carry the lesson question so the planner has a problem",
);
assert(
  normalizeTutorQuestion(contextual).includes("a block slides down a 30 degree incline"),
  "question normalization must not strip the lesson context out of the doubt prompt",
);

const longLesson = "x".repeat(900);
assert(
  buildDoubtPrompt("why", longLesson).length < 700,
  "the lesson context must stay bounded",
);

assert(
  buildInterruptedLessonExchange("find the acceleration", "  ") === null,
  "an interruption with nothing taught yet must not fake a tutor reply",
);
assert(
  buildInterruptedLessonExchange("", "we started with newton's second law") === null,
  "an interruption without a question must not enter conversation history",
);
const exchange = buildInterruptedLessonExchange(
  "find the acceleration",
  "we started with newton's second law. ",
);
assert(
  exchange?.user === "find the acceleration" &&
    exchange.assistant === "we started with newton's second law.",
  "the interrupted lesson must reach the doubt turn as a real exchange",
);

// The shell never unmounts between boards, so a boolean "already submitted"
// latch would swallow the second Next Question of a session.
const firstBoard = autoQuestionSubmissionKey("board-a", "find v");
assert(
  firstBoard === autoQuestionSubmissionKey("board-a", "  find v  "),
  "the same question on the same board must not resubmit after the url is stripped",
);
assert(
  firstBoard !== autoQuestionSubmissionKey("board-b", "find v"),
  "the same question on the next board is a new submission",
);
assert(
  firstBoard !== autoQuestionSubmissionKey("board-a", "find a"),
  "a new question on the same board is a new submission",
);

const root = resolve(import.meta.dirname, "../..");
const inputBar = readFileSync(
  resolve(root, "features/tutor-session/components/InputBar.tsx"),
  "utf8",
);
assert(
  !inputBar.includes("wired up later"),
  "the live Ask Doubt button must not be a placeholder",
);
assert(
  inputBar.includes("onClick={askDoubtFromButton}"),
  "the live Ask Doubt button must submit the doubt",
);
assert(
  inputBar.includes("const inputLocked = isExtracting || (disabled && !canInterruptWithDoubt);"),
  "a live lesson must leave the question field typable for a doubt",
);
assert(
  inputBar.includes("pauseForDoubt()"),
  "typing a doubt must pause the lesson instead of talking over the student",
);
assert(
  inputBar.includes(DOUBT_PLACEHOLDER) || inputBar.includes("DOUBT_PLACEHOLDER"),
  "a live lesson must prompt for a doubt in the question bar",
);
assert(
  inputBar.includes("DOUBT_INTERRUPT_HINT"),
  "the student must be told the lesson stops and the board clears",
);
assert(DOUBT_INTERRUPT_HINT.length > 0, "the doubt hint must say something");

const boardSession = readFileSync(
  resolve(root, "features/tutor-session/hooks/useBoardSession.ts"),
  "utf8",
);
assert(
  !/if \(unused\.id !== sessionId\)/.test(boardSession),
  "a blank board the student is already on must take the question, not spawn another",
);

const turnControl = readFileSync(
  resolve(root, "features/tutor-session/hooks/turn/useTurnControl.ts"),
  "utf8",
);
assert(
  !/autoSubmitDoneRef\.current\s*=\s*true/.test(turnControl),
  "auto-submit must record which board and question it consumed, not latch forever",
);
assert(
  turnControl.includes("autoQuestionSubmissionKey(sessionId"),
  "auto-submit must key on the board it is submitting for",
);
const handleAskDoubt = turnControl.slice(turnControl.indexOf("const handleAskDoubt"));
assert(
  handleAskDoubt.includes("stopTurn()"),
  "a mid-lesson doubt must stop the running turn",
);
assert(
  handleAskDoubt.includes("isRuntimeReadyForDoubt"),
  "the doubt turn must wait for the interrupted turn to unwind",
);
assert(
  handleAskDoubt.includes("conversationHistoryRef.current.push"),
  "the interrupted lesson must reach the doubt turn's conversation history",
);
assert(
  handleAskDoubt.includes("DOUBT_INTERRUPT_TIMEOUT_MESSAGE"),
  "a doubt that never gets a slot must surface instead of vanishing",
);

console.log("ask doubt verification passed");
