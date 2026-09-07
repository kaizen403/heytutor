/**
 * Marker-motion gate.
 *
 * The owner asked a bubble-sort question and watched the board draw, stop, and
 * then sit there while the tutor kept talking: "the pen was ideally just at one
 * point while it was speaking". Three separate paths caused that, and each is
 * pinned here.
 *
 *   1. A spoken step with no board tag issued no command, so the pen stayed
 *      where the last stroke ended for the whole step.
 *   2. Both spotlight paths flew the pen to the lit entity and then set the
 *      cursor to `idle`, which is opacity 0 — not standing at the figure,
 *      gone from the board.
 *   3. A focus was budgeted as one shape, about a second and a half. The step
 *      it belonged to ran a minute, and the pen spent the rest of it parked.
 *
 * The checks below are on the shared walk itself (route, pace, cancellation)
 * plus the source invariants that keep the three call sites using it.
 */
import { readFileSync } from "node:fs";
import {
  MARKER_DWELL_MS,
  MARKER_HOP_MS,
  markerTourStops,
  narrationTourMs,
  tourMarker,
  type MarkerTourCursorState,
  type TourRect,
  type TourStop,
} from "../../features/tutor-session/lib/board/markerTour";
import { CODE_FOCUS_SPOTLIGHT_MS } from "../../features/tutor-session/constants";
import { resolveCommandInkBudgetMs } from "../../features/tutor-session/types";
import type { DrawCommand } from "@heytutor/drawing";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function rect(x: number, y: number, width = 40, height = 30): TourRect {
  return { x, y, width, height };
}

/** A host on a virtual clock: every flight and every rest advances it. */
function fakeHost(options: { cancelAfterHops?: number } = {}) {
  let clock = 0;
  const visited: TourStop[] = [];
  const states: string[] = [];
  const host = {
    flyCursorTo: async (x: number, y: number, durationMs: number) => {
      assert(durationMs > 0, "a flight must have a positive duration");
      visited.push({ x, y });
      clock += durationMs;
    },
    setCursorState: (state: MarkerTourCursorState) => void states.push(state),
  };
  return {
    host,
    visited,
    states,
    now: () => clock,
    delay: async (ms: number) => {
      assert(ms >= 0, "a rest must not be negative");
      clock += ms;
    },
    isCancelled: () =>
      options.cancelAfterHops !== undefined && visited.length >= options.cancelAfterHops,
    elapsed: () => clock,
  };
}

async function main(): Promise<void> {
  // --- The route spreads over the figure rather than pinning one corner. ---
  {
    assert(markerTourStops([]).length === 0, "no targets means no route");

    const spread = markerTourStops([rect(100, 100), rect(200, 100), rect(300, 140)]);
    assert(spread.length === 3, `expected one stop per target, got ${spread.length}`);
    const xs = new Set(spread.map((stop) => stop.x));
    assert(xs.size === 3, "three targets must give three distinct stops, not one spot three times");

    // A single wide target is worth walking across; a small one is a point.
    const wide = markerTourStops([rect(100, 100, 240, 40)]);
    assert(wide.length === 3, `a wide target should be traced, got ${wide.length} stop(s)`);
    assert(
      Math.max(...wide.map((s) => s.x)) - Math.min(...wide.map((s) => s.x)) > 100,
      "a traced target's stops must actually span it",
    );
    assert(markerTourStops([rect(100, 100, 18, 18)]).length === 1, "a small target is one stop");

    // A target with a broken measurement would fly the pen to an undrawable
    // point. Dropping it is right; passing NaN to the board is not.
    const broken = markerTourStops([
      { x: 10, y: 10, width: Number.NaN, height: 20 },
      rect(200, 100),
    ]);
    assert(
      broken.length === 1 && broken.every((stop) => Number.isFinite(stop.x) && Number.isFinite(stop.y)),
      "a target with a non-finite measurement must be dropped, not walked to",
    );

    // Stops sit on the top edge: the pen graphic hangs below and right of its
    // tip, so a stop in the middle of a cell covers the value being named.
    assert(wide.every((stop) => stop.y === 100), "stops must sit on the target's top edge");
  }

  // --- Rotation stops consecutive steps replaying the same two moves. ---
  {
    const targets = [rect(10, 10), rect(60, 10), rect(110, 10), rect(160, 10)];
    const first = markerTourStops(targets, 0);
    const second = markerTourStops(targets, 1);
    const third = markerTourStops(targets, 2);
    assert(first[0]!.x !== second[0]!.x, "rotation 1 must start somewhere else");
    assert(second[0]!.x !== third[0]!.x, "rotation 2 must start somewhere else again");
    assert(
      new Set(first.map((s) => s.x)).size === new Set(second.map((s) => s.x)).size,
      "rotation must reorder the same stops, not drop any",
    );
    // Out-of-range rotations wrap rather than emptying the route.
    assert(markerTourStops(targets, 9).length === 4, "a large rotation must wrap");
    assert(markerTourStops(targets, -3).length === 4, "a negative rotation must wrap");
  }

  // --- The pen keeps moving for the whole spoken step. ---
  {
    const clock = fakeHost();
    const stops = markerTourStops([rect(10, 10), rect(60, 10), rect(110, 10)]);
    const cancelled = await tourMarker(clock.host, stops, {
      totalMs: 24_000,
      isCancelled: clock.isCancelled,
      delay: clock.delay,
      now: clock.now,
    });
    assert(cancelled === false, "an uncancelled walk must report no cancellation");
    // A 24s step at roughly a hop plus a rest per stop is well over a dozen moves.
    const expected = Math.floor(24_000 / (MARKER_HOP_MS + MARKER_DWELL_MS)) - 1;
    assert(
      clock.visited.length >= expected,
      `a 24s step must keep moving: expected at least ${expected} moves, got ${clock.visited.length}`,
    );
    // The longest gap between moves is what the student reads as "stopped".
    assert(
      MARKER_DWELL_MS + MARKER_HOP_MS <= 2_000,
      "the pen must not stand still for more than two seconds at a time",
    );
    assert(
      clock.elapsed() <= 24_000 + MARKER_HOP_MS,
      `a walk must not outrun its step: ${clock.elapsed()}ms spent of 24000ms`,
    );
    assert(clock.visited.length > stops.length, "a long step must loop the route, not stop at its end");
    assert(
      clock.states.every((state) => state !== "idle"),
      "the walking pen must never be set to idle: that is opacity 0",
    );
    assert(clock.states.includes("speaking"), "a walking pen is a speaking pen");
  }

  // --- A short step still puts the pen at the figure. ---
  {
    const clock = fakeHost();
    await tourMarker(clock.host, markerTourStops([rect(500, 200)]), {
      totalMs: 0,
      isCancelled: clock.isCancelled,
      delay: clock.delay,
      now: clock.now,
    });
    assert(clock.visited.length === 1, "even a zero-length step flies the pen to its target once");
  }

  // --- Cancellation stops the walk rather than finishing the route. ---
  {
    const clock = fakeHost({ cancelAfterHops: 2 });
    const cancelled = await tourMarker(clock.host, markerTourStops([rect(10, 10), rect(60, 10), rect(110, 10)]), {
      totalMs: 30_000,
      isCancelled: clock.isCancelled,
      delay: clock.delay,
      now: clock.now,
    });
    assert(cancelled === true, "a cancelled walk must say so, so the caller drops the rest of the segment");
    assert(clock.visited.length === 2, `a cancelled walk must stop moving, got ${clock.visited.length} moves`);
  }

  // --- A walk is sized by the words, not by the shape budget. ---
  {
    // Sixty words of narration is about 330 characters.
    const beat = "x".repeat(330);
    const walk = narrationTourMs(beat, 900);
    assert(walk > 20_000, `a sixty-word step must be walked for its length, got ${walk}ms`);
    assert(walk < 330 * 85, "a walk must finish inside its step, not outlast it");
    assert(narrationTourMs("", 900) === 900, "with no narration the shape budget stands");
    assert(narrationTourMs("x".repeat(20_000), 900) <= 45_000, "a walk is capped");
    assert(
      narrationTourMs(beat, 0) - CODE_FOCUS_SPOTLIGHT_MS > 15_000,
      "after the spotlight lifts there must still be most of the step left to walk",
    );

    // --- A walk may never outrun its own command's share of the beat. ---
    //
    // 14% of measured beats carry two board actions. Sized from the whole
    // segment's narration, a frame swap and the focus after it each asked for
    // the beat's full time: an 83-word beat is about 30s of speech, and the
    // focus alone wanted 33s of walking on top of the frame's own redraw. The
    // draw chain then ran tens of seconds behind its audio and the commands
    // after it, the ones that type the code, arrived long after the words or
    // not at all. A pen that walks instead of writing is worse than a still one.
    const share = 8_000;
    assert(
      narrationTourMs(beat, 900, share) <= share,
      `a walk must not exceed its share of the beat: got ${narrationTourMs(beat, 900, share)}ms of ${share}ms`,
    );
    assert(
      narrationTourMs(beat, 900, 0) === narrationTourMs(beat, 900),
      "a missing or zero share means the command owns the segment, so the estimate stands",
    );
    assert(
      narrationTourMs("x".repeat(20), 900, 100) === 900,
      "the shape budget is still the floor: a share cannot cut the walk below one flight",
    );
    assert(
      narrationTourMs(beat, 900, 60_000) === narrationTourMs(beat, 900),
      "a generous share does not extend the walk past what the words justify",
    );
  }

  // --- A POINT costs no ink, so its budget must come from the words. ---
  {
    const point = { type: "POINT", params: [], text: "cell0,cell3", charPosition: 0 } as unknown as DrawCommand;
    const budget = resolveCommandInkBudgetMs({
      command: point,
      pace: "scene",
      verifiedDiagramIntro: false,
      isTextCommand: false,
      // A pointing command matches no phrase and draws nothing, so the window
      // it resolves to is zero. Reading that as the budget parks the pen.
      speechWindowMs: 0,
      commandSpeechMs: 18_000,
      naturalDrawMs: 0,
      multiShapeSegment: false,
    });
    assert(budget === 18_000, `a POINT must be budgeted at its spoken step, got ${budget}ms`);
  }

  // --- The three call sites must keep using the shared walk. ---
  {
    const path = new URL("../../features/tutor-session/hooks/useCommandExecution.ts", import.meta.url);
    const raw = readFileSync(path, "utf8");
    // Comments explain the bug by quoting the code that caused it, so strip
    // them before asserting on what the file actually does.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

    assert(
      !/setCursorState\(\s*"idle"\s*\)/.test(source),
      "the command executor must never set the cursor to idle: opacity 0 is a pen that has left the board",
    );
    assert(
      /case "TYPE":[\s\S]{0,2500}?setCursorState\("thinking"\)/.test(source),
      "after typing, the pen must spin (thinking). speaking is a still pen; idle is gone",
    );
    const thinkingHolds = source.match(/setCursorState\("thinking"\)/g) ?? [];
    assert(
      thinkingHolds.length >= 4,
      `every walk and the type-along must leave the pen spinning, found ${thinkingHolds.length} hold(s)`,
    );
    const walks = source.match(/tourMarker\(/g) ?? [];
    assert(
      walks.length >= 3,
      `expected the POINT case and both focus paths to walk the marker, found ${walks.length} call(s)`,
    );
    assert(
      /case "POINT":[\s\S]{0,900}?tourMarker\(/.test(source),
      "a POINT must walk the marker",
    );
    // Both halves of the focus split matter: a spotlight capped but no walk
    // after it leaves the pen parked, and a walk under the veil greys the
    // figure for the whole step.
    assert(
      new RegExp(`Math\\.min\\([\\s\\S]{0,80}CODE_FOCUS_SPOTLIGHT_MS`).test(source),
      "the walk under the veil must be capped at the spotlight hold",
    );
    assert(
      /focusCancelled\) return;[\s\S]{0,700}?tourMarker\(/.test(source),
      "the pen must keep walking after the veil lifts, not stand where the spotlight left it",
    );
    assert(
      /narrationTourMs\([\s\S]{0,80}options\.segmentNarration,\s*0,\s*options\.speechShareMs\)[\s\S]{0,40}CODE_FOCUS_SPOTLIGHT_MS/.test(source),
      "the walk after the veil must be the rest of the spoken step, bounded by this command's share",
    );
    // Both walking call sites take the share, or a two-command beat starves.
    const walkCalls = source.match(/narrationTourMs\(/g) ?? [];
    const sharedCalls = source.match(/options\.speechShareMs/g) ?? [];
    assert(
      sharedCalls.length >= walkCalls.length,
      `${walkCalls.length} walk(s) but only ${sharedCalls.length} bounded by a share`,
    );
  }

  // --- The runner tells each command what slice of the beat it may spend. ---
  {
    const runner = readFileSync(
      new URL("../../features/tutor-session/hooks/turn/useSegmentRunner.ts", import.meta.url),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    assert(
      /speechShareMs:\s*speechWindow\?\.durationMs \|\| commandSpeechMs/.test(runner),
      "the runner must pass each command its own share of the segment's spoken time",
    );

    const shell = readFileSync(
      new URL("../../features/tutor-session/TutorSessionShell.tsx", import.meta.url),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    assert(
      !/phase === "drawing" \|\| phase === "speaking"/.test(shell),
      "speaking must not force a still drawing cursor: that parks the pen for the close of a code lesson",
    );
  }

  // --- A frame offers several places to stand, not one corner twice. ---
  {
    const { resolveDsaFrames } = await import(
      "../../features/tutor-session/lib/code-lesson/dsaFrames"
    );
    const frameSet = resolveDsaFrames(
      "Sort the array [5, 1, 4, 2, 8] using bubble sort and explain each pass.",
    );
    assert(frameSet !== null, "bubble sort must still produce frames");
    const opening = frameSet.frames[0]!;
    assert(
      opening.pointEntityIds.length >= 3,
      `an opening frame must offer somewhere to walk, got ${opening.pointEntityIds.length} stop(s)`,
    );
    assert(
      new Set(opening.pointEntityIds).size === opening.pointEntityIds.length,
      "a frame's stops must be distinct",
    );
  }

  console.log("verify-marker-tour: the pen walks the figure for as long as the step is spoken");
}

void main();
