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
  overlay.includes("preparing the lecture"),
  "the spinning pen must say the tutor is preparing the lecture",
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
assert(
  /waitingToTeach\s*=\s*phase === "planning" \|\| phase === "thinking"/.test(shell),
  "planning and the pre-lesson think share one pending overlay",
);
assert(
  /waitingToTeach\s*\?\s*"idle"/.test(shell),
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
  runner.includes("waitedMs: performance.now() - waitStartedAt"),
  "the first schedule must give up if the voice never starts",
);
assert(
  runner.includes("playbackPositionMs: tts.getPlaybackPositionMs()"),
  "the first schedule must wait for actual playback, not merely onStart",
);
assert(
  !/if \(isCancelled\(\) return;\s*applyTurnPhase\("speaking"\)/.test(runner),
  "queuing a segment must not drop the preparing overlay before the voice starts",
);
assert(
  !handler.includes('applyTurnPhase("speaking")'),
  "finishing the teaching stream must not drop the overlay before the voice starts",
);

console.log(
  "verify-thinking-overlay: pending overlay names the wait, and the board stays covered until the voice starts",
);
