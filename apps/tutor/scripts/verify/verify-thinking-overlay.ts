/**
 * The wait before the first mark is the clicker on paper, named as
 * preparing the lecture — not a leftover Konva marker, not a silent dump.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const tutorRoot = resolve(import.meta.dirname, "../..");
const overlay = readFileSync(
  resolve(tutorRoot, "features/tutor-session/components/ThinkingOverlay.tsx"),
  "utf8",
);
const beats = readFileSync(
  resolve(tutorRoot, "features/tutor-session/lib/board/pendingBeats.ts"),
  "utf8",
);
const shell = readFileSync(
  resolve(tutorRoot, "features/tutor-session/TutorSessionShell.tsx"),
  "utf8",
);
const runner = readFileSync(
  resolve(tutorRoot, "features/tutor-session/hooks/turn/useSegmentRunner.ts"),
  "utf8",
);
const handler = readFileSync(
  resolve(tutorRoot, "features/tutor-session/hooks/turn/useQuestionHandler.ts"),
  "utf8",
);

assert(overlay.includes("PenSpinner"), "the pending overlay must be the clicker pen");
assert(overlay.includes("trail={false}"), "the pending clicker must not trail ink");
assert(overlay.includes("smear={false}"), "the pending clicker must not smear a second shadow");
assert(
  overlay.includes("preparing the lecture") || beats.includes("preparing the lecture"),
  "the spinning pen must say the tutor is preparing the lecture",
);
assert(beats.includes("thinking"), "the wait must name thinking");
assert(beats.includes("planning the diagram"), "the wait must name planning the diagram");
assert(beats.includes("planning the scene"), "the wait must name planning the scene");
assert(overlay.includes("usePendingBeat"), "the line under the pen must cycle");
assert(overlay.includes("wb-pending__rail"), "the wait must keep an ink rail under the words");
assert(
  !overlay.includes("wb-pending__compass"),
  "the wait must not draw construction rings around the pen",
);
assert(
  overlay.includes('aria-label="Preparing the lecture"'),
  "the pending overlay must name the wait for assistive tech",
);
assert(
  overlay.includes("size={48}"),
  "the centered lesson spinner must be size 48, not 88",
);
assert(
  !overlay.includes("size={88}"),
  "the centered lesson spinner must not stay at size 88",
);
assert(
  overlay.includes("size={32}"),
  "the doubt spinner must be size 32",
);
assert(
  /className="wb-pending\b/.test(overlay),
  "the centered overlay must keep the wb-pending class for the frosted board",
);
/*
  The rule is unchanged, only its address: the phase-to-marker map moved out of
  the shell into `markerVisibility.ts` so it could be gated on its own. Both
  ends are asserted, because the shell calling *a* helper proves nothing if the
  helper answers a different question.
*/
assert(
  /waitingToTeach\s*=\s*isWaitingToTeach\(phase\)/.test(shell),
  "planning and the pre-lesson think share one pending overlay",
);
assert(
  /isWaitingToTeach\(phase: TutorPhase\): boolean \{\s*\n\s*return phase === "planning" \|\| phase === "thinking";/.test(
    readFileSync(
      resolve(tutorRoot, "features/tutor-session/lib/board/markerVisibility.ts"),
      "utf8",
    ),
  ),
  "and the helper the shell calls must still mean planning and the pre-lesson think",
);
assert(
  /if \(isWaitingToTeach\(phase\)\) return "idle";/.test(
    readFileSync(
      resolve(tutorRoot, "features/tutor-session/lib/board/markerVisibility.ts"),
      "utf8",
    ),
  ),
  "the Konva marker must stay down while the pending overlay is up",
);
assert(
  !shell.includes("planning the diagram"),
  "the shell must not put 'planning the diagram' on the board",
);
assert(
  runner.includes('applyTurnPhase("speaking")'),
  "voice never starting must still drop the preparing overlay",
);
assert(
  runner.includes("waitedMs: waitClock.elapsedMs()"),
  "the first schedule must give up after active (not paused) wait if the voice never starts",
);
assert(
  runner.includes("playbackPositionMs: usingBrowserFallback ? null : tts.getPlaybackPositionMs()"),
  "the first schedule must wait for primary playback, not merely onStart or stale primary position during browser recovery",
);
assert(
  !/if \(isCancelled\(\) return;\s*applyTurnPhase\("speaking"\)/.test(runner),
  "queuing a segment must not drop the preparing overlay before the voice starts",
);
assert(
  !handler.includes('applyTurnPhase("speaking")'),
  "finishing the teaching stream must not drop the overlay before the voice starts",
);

const HANDLER_ANCHOR = "const handleQuestion = useCallback(";
const handlerAt = handler.indexOf(HANDLER_ANCHOR);
assert(handlerAt >= 0, `this gate reads handleQuestion from "${HANDLER_ANCHOR}"`);
const handlerBody = handler.slice(handlerAt);
const unlockAt = handlerBody.indexOf("unlockAudio");
const firstAwaitAt = handlerBody.search(/\n\s*await /);
assert(
  unlockAt >= 0 && firstAwaitAt >= 0 && unlockAt < firstAwaitAt,
  "WebAudio must unlock on the Ask click before the first await — committing the home board first drops the gesture, AudioContext stays suspended, and the lesson falls through to silent speechSynthesis",
);

const submitAt = shell.indexOf("const submitQuestionAndDropMarks = useCallback(");
assert(submitAt >= 0, "Ask must go through submitQuestionAndDropMarks");
const submitBody = shell.slice(submitAt, submitAt + 500);
const submitUnlockAt = submitBody.indexOf("unlockAudio");
const submitNextAt = submitBody.indexOf("startNextQuestion");
assert(
  submitUnlockAt >= 0 && submitNextAt >= 0 && submitUnlockAt < submitNextAt,
  "the Ask click must unlock WebAudio before it navigates to a new board, while the gesture still counts",
);

const turnControl = readFileSync(
  resolve(tutorRoot, "features/tutor-session/hooks/turn/useTurnControl.ts"),
  "utf8",
);
assert(
  /stopTurn\(\{ keepVisibleBoard: true \}\);[\s\S]{0,240}unlockAudio/.test(turnControl),
  "a doubt that stops the live lecture must re-arm WebAudio in the same click — stop() closes the lecture graph",
);

console.log(
  "verify-thinking-overlay: pending overlay names the wait, and the board stays covered until the voice starts",
);
