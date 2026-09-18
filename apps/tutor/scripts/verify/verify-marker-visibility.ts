/**
 * The marker is on the board while the tutor is talking.
 *
 * That is the whole gate. It sounds too obvious to need one, which is exactly
 * why it kept breaking: `cursorState` is a five-value enum, `idle` in it means
 * opacity 0, and every path that wanted "the pen has nothing to do right now"
 * reached for `idle` and took the marker off the board mid-lesson. It has
 * happened through the spotlight paths, through the code-lesson TYPE handler,
 * through the marker tour, and through the shell's own phase mapping.
 *
 * So the rule is asserted at three levels:
 *
 *   1. The mapping. No teaching phase may produce a state whose opacity is 0.
 *   2. The lecture. Across a real run of phases, the marker's alpha never
 *      reaches zero between the first spoken beat and the last.
 *   3. The fade. A state change is approached, never switched, so even the
 *      legitimate disappearances at the two ends of a turn are the pen being
 *      set down rather than deleted.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cursorOpacity, type CursorState } from "@heytutor/whiteboard";
import {
  CURSOR_ALPHA_EPSILON,
  CURSOR_FADE_TIME_CONSTANT_MS,
  approachFraction,
} from "@heytutor/whiteboard";

import {
  TEACHING_PHASES,
  isTeachingPhase,
  isWaitingToTeach,
  markerCursorState,
  markerIsOnBoard,
  rewindMarkerCursorState,
} from "../../features/tutor-session/lib/board/markerVisibility";
import type { TutorPhase } from "../../features/tutor-session/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ALL_PHASES: readonly TutorPhase[] = ["idle", "planning", "thinking", "drawing", "speaking"];

// --- 1. the mapping ---------------------------------------------------------
{
  for (const phase of ALL_PHASES) {
    for (const isReplaying of [false, true]) {
      const state = markerCursorState({ phase, isReplaying });
      const alpha = cursorOpacity(state);
      assert(alpha >= 0 && alpha <= 1, `${phase} produced an alpha outside the range: ${alpha}`);
      if (isTeachingPhase(phase) || isReplaying) {
        assert(
          state !== "idle",
          `the marker is off the board during ${phase}${isReplaying ? " (replay)" : ""}`,
        );
        assert(
          markerIsOnBoard({ phase, isReplaying }),
          `markerIsOnBoard disagrees with the state it derives for ${phase}`,
        );
        // Not merely non-idle: visible enough to follow across the paper.
        assert(
          alpha >= 0.7,
          `the marker is only ${alpha} opaque during ${phase}, which reads as faded out`,
        );
      }
    }
  }

  assert(TEACHING_PHASES.length === 2, "speaking and drawing are the phases a student watches");
  for (const phase of TEACHING_PHASES) {
    assert(!isWaitingToTeach(phase), `${phase} is teaching, not waiting`);
  }

  // A replay is a lecture too: scrubbing back must not hand back a blank board.
  assert(
    markerCursorState({ phase: "idle", isReplaying: true }) === "drawing",
    "a replay draws, whatever the live phase says",
  );

  // The two legitimate disappearances, and only those two.
  const hidden = ALL_PHASES.filter(
    (phase) => !markerIsOnBoard({ phase, isReplaying: false }),
  );
  assert(
    hidden.join(",") === "idle,planning,thinking",
    `the marker may only be down before and after a turn, got: ${hidden.join(",") || "none"}`,
  );
}

// --- 2. the lecture ---------------------------------------------------------
/*
  A real turn: plan, wait for the first token, then alternate speaking and
  drawing for a few dozen beats, then finish. The marker has to be continuously
  on the board from the first spoken beat to the last, with no hole anywhere in
  the middle — a single frame at zero is the "it vanished" report.
*/
{
  const lecture: TutorPhase[] = ["idle", "planning", "thinking"];
  for (let beat = 0; beat < 40; beat += 1) {
    lecture.push("speaking");
    if (beat % 3 === 0) lecture.push("drawing");
    // A doubt mid-lecture re-enters the turn, which is the one place a live
    // lesson legitimately shows the clicker again.
    if (beat === 17) lecture.push("thinking", "speaking");
  }
  lecture.push("idle");

  const firstTeaching = lecture.findIndex(isTeachingPhase);
  const lastTeaching = lecture.length - 1 - [...lecture].reverse().findIndex(isTeachingPhase);
  assert(firstTeaching > 0 && lastTeaching > firstTeaching, "the fixture must contain a lecture");

  let holes = 0;
  for (let index = firstTeaching; index <= lastTeaching; index += 1) {
    const phase = lecture[index]!;
    if (!isTeachingPhase(phase)) continue;
    if (cursorOpacity(markerCursorState({ phase, isReplaying: false })) <= 0) holes += 1;
  }
  assert(holes === 0, `the marker went to zero on ${holes} teaching beats of one lecture`);

  // And the state does not flap: a lecture that switches the marker's state on
  // every beat is a marker that spends the lesson fading.
  let switches = 0;
  let previous: CursorState | null = null;
  for (let index = firstTeaching; index <= lastTeaching; index += 1) {
    const state = markerCursorState({ phase: lecture[index]!, isReplaying: false });
    if (previous !== null && state !== previous) switches += 1;
    previous = state;
  }
  assert(
    switches <= 2,
    `the marker changed state ${switches} times inside one lecture; each one is a fade`,
  );
}

// --- the rewind overlay is a board too --------------------------------------
/*
  Scrubbing back plays a recorded lecture on a second board over the live one.
  Its marker state used to be derived from the *recorded* phase, so any beat of
  the playback that was not speaking or drawing took the marker off that board
  as well. Playback is playback: while it runs the marker is on the board.
*/
{
  assert(
    rewindMarkerCursorState({ active: true, paused: false }) === "drawing",
    "a playing rewind must keep its marker on the board",
  );
  assert(
    cursorOpacity(rewindMarkerCursorState({ active: true, paused: false })) >= 0.7,
    "and at full strength, not faded",
  );
  assert(
    rewindMarkerCursorState({ active: true, paused: true }) === "idle",
    "a held rewind sets the marker down",
  );
  assert(
    rewindMarkerCursorState({ active: false, paused: false }) === "idle",
    "and a closed overlay has no marker at all",
  );

  // It must not read the recorded phase back: that is the bug, and a signature
  // that accepts one is an invitation to reintroduce it.
  const rewind = readFileSync(
    resolve(
      import.meta.dirname,
      "../../features/tutor-session/hooks/useLectureRewind.ts",
    ),
    "utf8",
  );
  const rewindCode = rewind.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert(
    /rewindMarkerCursorState\(\{ active: rewindActive, paused: rewindPaused \}\)/.test(rewindCode),
    "the rewind overlay must take its marker state from markerVisibility",
  );
  assert(
    !/rewindPhase === "drawing" \|\| rewindPhase === "speaking" \? "drawing" : "idle"/.test(
      rewindCode,
    ),
    "the recorded phase is back in the rewind marker state; it blanks the marker between beats",
  );
}

// --- 3. the fade ------------------------------------------------------------
/*
  Even where the marker is allowed to go, it goes gradually. `cursorOpacity` is
  a step function; the board approaches it. A gate on the arithmetic here is
  cheap, and it is the half of the fix that the whiteboard's own source check
  cannot see from this side.
*/
{
  assert(
    CURSOR_ALPHA_EPSILON < 0.02,
    "the board may only stop drawing the marker once the fade is genuinely done",
  );

  for (const [from, to] of [
    ["thinking", "idle"],
    ["idle", "thinking"],
    ["thinking", "erasing"],
    ["drawing", "thinking"],
  ] as const) {
    const target = cursorOpacity(to);
    let alpha = cursorOpacity(from);
    let frames = 0;
    let worstStep = 0;
    while (Math.abs(alpha - target) > 1e-3 && frames < 600) {
      const next = alpha + (target - alpha) * approachFraction(16, CURSOR_FADE_TIME_CONSTANT_MS);
      worstStep = Math.max(worstStep, Math.abs(next - alpha));
      alpha = next;
      frames += 1;
    }
    assert(
      frames > 4,
      `${from} to ${to} resolved in ${frames} frames, which is a switch rather than a fade`,
    );
    assert(frames < 45, `${from} to ${to} took ${frames} frames and outlasts the pause`);
    assert(
      worstStep < 0.2,
      `${from} to ${to} stepped the marker's opacity by ${worstStep.toFixed(2)} in one frame`,
    );
  }
}

// --- the shell uses the module, not a ternary of its own --------------------
{
  const tutorRoot = resolve(import.meta.dirname, "../..");
  const shell = readFileSync(
    resolve(tutorRoot, "features/tutor-session/TutorSessionShell.tsx"),
    "utf8",
  );
  const code = shell.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert(
    /const cursorState: CursorState = markerCursorState\(/.test(code),
    "the shell must take its cursor state from markerVisibility",
  );
  assert(
    !/cursorState: CursorState =\s*\n?\s*phase === "idle"/.test(code),
    "the inline phase ternary is back; it is where a branch that hides the pen gets added",
  );
  // Every board the student can see is handed the stunt setting, including the
  // rewind overlay: a setting that only reaches one of three boards is a bug
  // report about the other two.
  const canvas = readFileSync(
    resolve(tutorRoot, "features/tutor-session/components/SessionBoardCanvas.tsx"),
    "utf8",
  );
  // `\s` keeps `RefObject<WhiteboardHandle>` out of the count.
  const boards = (canvas.match(/<Whiteboard\s/g) ?? []).length;
  const wired = (canvas.match(/markerStunts=\{settings\.markerStunts\}/g) ?? []).length;
  // The live board, the rewind overlay and the off-screen export board. Only
  // the first two are ever looked at, and the export board deliberately runs
  // with no idle motion at all, so it is the one that stays unwired.
  assert(boards === 3, `expected the live, rewind and export boards, found ${boards}`);
  assert(
    wired === 2,
    `${wired} of the 2 student-facing boards were given the stunt setting`,
  );
}

console.log(
  "✓ marker visibility: the marker is on the board through every speaking and drawing beat of a lecture and through every frame of a rewind, it may only be down before and after a turn, it fades to and from that rather than switching, and the stunt setting reaches every board the student sees",
);
