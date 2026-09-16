/**
 * Focus execution gate.
 *
 * A FOCUS naming several parts was one gesture at the start of its sentence:
 * all withheld labels lettered at once, all paths traced in one 900 ms
 * budget, then the pen parked. On the mirror lesson "mirror,C,F" fired at
 * t=0 of a 7.2 s sentence that named M, C and F in turn; the labels had
 * already leaked under "Given: f = 15 cm". These checks drive the scheduled
 * loop through a fake whiteboard on a virtual audio clock and pin, per
 * target: the pen waits for the name, letters that target's label alone in
 * the beat before it, traces on the word until the clause ends, and a cancel
 * between targets still lowers the spotlight.
 */
import { readFileSync } from "node:fs";
import {
  FOCUS_FLIGHT_LEAD_MS,
  FOCUS_PULSE_MS,
  focusHopMs,
  runScheduledFocus,
  type ScheduledFocusHost,
  type ScheduledFocusTarget,
} from "../../features/tutor-session/lib/board/scheduledFocus";
import type { SpotlightRect, SpotlightSpec } from "../../features/tutor-session/lib/board/spotlight";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface FlyEvent { kind: "fly"; at: number; x: number; y: number; ms: number }
interface MarkEvent { kind: "underline" | "circle_around"; at: number; ms: number; path: string }
interface LetterEvent { kind: "letter"; at: number; id: string; ms: number }
interface SpotlightEvent { kind: "spotlight"; at: number; hole: SpotlightRect | null }
type BoardEvent = FlyEvent | MarkEvent | LetterEvent | SpotlightEvent;

/** The ring a target traces; its path names the target so events can be attributed. */
function ring(id: string, x: number, y: number): { path: string; x: number; y: number } {
  return { path: `ring:${id}`, x, y };
}

/**
 * A whiteboard on a virtual audio clock. The clock is the voice: a wait jumps
 * it forward to the word; a flight, a glyph or a trace advances it by what
 * the pen spent, because the voice keeps going while the pen works.
 */
function fakeBoard(options: { startAtMs?: number; letterMs?: number; labelOffsetPx?: number } = {}) {
  let audioMs = options.startAtMs ?? 0;
  // One glyph at scene pace. It fits the lead with room to spare, so a
  // trace that does not wait for the name starts visibly before it.
  const letterMs = options.letterMs ?? 60;
  const labelOffsetPx = options.labelOffsetPx ?? 14;
  const events: BoardEvent[] = [];
  const host: ScheduledFocusHost = {
    setSpotlight: (spec: SpotlightSpec | null) => {
      events.push({ kind: "spotlight", at: audioMs, hole: spec?.hole ?? null });
    },
    flyCursorTo: async (x, y, ms) => {
      assert(ms > 0, "a flight must have a positive duration");
      events.push({ kind: "fly", at: audioMs, x, y, ms });
      audioMs += ms;
    },
    drawAnnotation: async (kind, path, ms) => {
      assert(ms > 0, "a trace must have a positive duration");
      events.push({ kind, at: audioMs, ms, path });
      audioMs += ms;
    },
  };
  const target = (
    id: string,
    startMs: number,
    endMs: number,
    at: { x: number; y: number },
  ): ScheduledFocusTarget => ({
    id,
    startMs,
    endMs,
    rects: [{ x: at.x - 6, y: at.y - 6, width: 12, height: 12 }],
    paths: [ring(id, at.x, at.y)],
    pulse: { path: `pulse:${id}`, x: at.x, y: at.y - 12 },
    // Lettering costs a glyph and leaves the pen just right of the point,
    // where a label sits.
    letter: async () => {
      events.push({ kind: "letter", at: audioMs, id, ms: letterMs });
      audioMs += letterMs;
      return { cancelled: false, penAt: { x: at.x + labelOffsetPx, y: at.y } };
    },
  });
  return {
    host,
    events,
    target,
    now: () => audioMs,
    waitUntil: async (targetMs: number) => {
      if (audioMs < targetMs) audioMs = targetMs;
    },
    traces: () => events.filter((event): event is MarkEvent => event.kind === "underline"),
    letters: () => events.filter((event): event is LetterEvent => event.kind === "letter"),
    spotlights: () => events.filter((event): event is SpotlightEvent => event.kind === "spotlight"),
  };
}

const VEIL: SpotlightRect = { x: 620, y: 90, width: 540, height: 460 };
/** "M is the mirror, C is the centre, and the focus F is halfway to C." */
const WINDOWS = [
  { id: "M", startMs: 900, endMs: 2600, at: { x: 1000, y: 200 } },
  { id: "C", startMs: 3400, endMs: 4600, at: { x: 760, y: 320 } },
  { id: "F", startMs: 5200, endMs: 6400, at: { x: 880, y: 320 } },
] as const;

async function main(): Promise<void> {
  // --- Three names, three windows: each traced on its word, in order. ---
  {
    const board = fakeBoard();
    const targets = WINDOWS.map((window) => board.target(window.id, window.startMs, window.endMs, window.at));
    const cancelled = await runScheduledFocus(board.host, targets, {
      emphasis: "trace",
      veil: VEIL,
      getAudioPositionMs: board.now,
      waitUntilAudioMs: board.waitUntil,
      isCancelled: () => false,
      floorMs: 420,
    });
    assert(cancelled === false, "an uncancelled focus must report no cancellation");

    const traces = board.traces();
    assert(
      traces.map((trace) => trace.path).join(",") === "ring:M,ring:C,ring:F",
      `targets must be traced in spoken order, got ${traces.map((trace) => trace.path).join(",")}`,
    );
    for (const [index, window] of WINDOWS.entries()) {
      const trace = traces[index]!;
      const lag = trace.at - window.startMs;
      assert(
        lag >= 0 && lag <= 40,
        `${window.id}: the trace must start on its name (start ${window.startMs}), started ${trace.at} (${lag} ms off)`,
      );
      const end = trace.at + trace.ms;
      assert(
        Math.abs(end - window.endMs) <= 40,
        `${window.id}: the trace must run to the end of its clause (${window.endMs}), ended ${end}`,
      );
    }

    // Each label is lettered in the beat before its own name, after the
    // previous target is done, and before its own trace. All three used to
    // land together at the start of the sentence.
    const letters = board.letters();
    assert(
      letters.map((letter) => letter.id).join(",") === "M,C,F",
      `labels must be lettered one target at a time, got ${letters.map((letter) => letter.id).join(",")}`,
    );
    for (const [index, window] of WINDOWS.entries()) {
      const letter = letters[index]!;
      const trace = traces[index]!;
      assert(letter.at < trace.at, `${window.id}: the label must be lettered before the trace`);
      assert(
        letter.at >= window.startMs - FOCUS_FLIGHT_LEAD_MS,
        `${window.id}: the label must wait for its own beat (from ${window.startMs - FOCUS_FLIGHT_LEAD_MS}), lettered at ${letter.at}`,
      );
      assert(
        letter.at + letter.ms <= window.startMs + 40,
        `${window.id}: the label must be on the board as the name is said, finished at ${letter.at + letter.ms} for a name at ${window.startMs}`,
      );
      const previous = WINDOWS[index - 1];
      if (previous) {
        assert(letter.at >= previous.endMs, `${window.id}: the label must not be lettered while ${previous.id} is still being traced`);
      }
    }

    // The pen goes to the part before the name, not after it.
    const flights = board.events.filter((event): event is FlyEvent => event.kind === "fly");
    const approachToM = flights.find((flight) => flight.x === WINDOWS[0].at.x && flight.y === WINDOWS[0].at.y);
    assert(approachToM && approachToM.at < WINDOWS[0].startMs, "the pen must fly to the first part before its name is spoken");
    // withSpotlight still runs its teardown with no veil; that is a lower, not a raise.
    assert(board.spotlights().every((event) => event.hole === null), "a plain trace raises no veil");
  }

  // --- A hop is sized by the distance, and no distance is no hop. ---
  {
    assert(focusHopMs(null, { x: 0, y: 0 }, 160) === 160, "an unknown start costs the cap");
    assert(focusHopMs({ x: 0, y: 0 }, { x: 3, y: 0 }, 160) === 0, "under the nib's settle distance there is no flight");
    assert(focusHopMs({ x: 0, y: 0 }, { x: 14, y: 0 }, 160) === 24, "a hop across a label is the minimum hop");
    assert(focusHopMs({ x: 0, y: 0 }, { x: 800, y: 0 }, 160) === 160, "a long hop is capped");
    assert(focusHopMs({ x: 0, y: 0 }, { x: 800, y: 0 }, 60) === 60, "a small budget caps the hop below the ceiling");
  }

  // --- Pulse: each target is ringed after its own trace, inside its window. ---
  {
    const board = fakeBoard();
    const targets = WINDOWS.map((window) => board.target(window.id, window.startMs, window.endMs, window.at));
    await runScheduledFocus(board.host, targets, {
      emphasis: "pulse",
      veil: VEIL,
      getAudioPositionMs: board.now,
      waitUntilAudioMs: board.waitUntil,
      isCancelled: () => false,
      floorMs: 420,
    });
    const marks = board.events.filter(
      (event): event is MarkEvent => event.kind === "underline" || event.kind === "circle_around",
    );
    assert(
      marks.map((mark) => mark.path).join(",") === "ring:M,pulse:M,ring:C,pulse:C,ring:F,pulse:F",
      `each target must be ringed right after its trace, got ${marks.map((mark) => mark.path).join(",")}`,
    );
    for (const [index, window] of WINDOWS.entries()) {
      const pulse = marks[index * 2 + 1]!;
      assert(pulse.ms === FOCUS_PULSE_MS, `${window.id}: the pulse ring keeps its fixed length`);
      assert(
        pulse.at + pulse.ms <= window.endMs + 40,
        `${window.id}: the pulse must end with the clause (${window.endMs}), ended ${pulse.at + pulse.ms}`,
      );
    }
  }

  // --- Spotlight follows the spoken target; a cancel between targets lowers it. ---
  {
    const board = fakeBoard();
    const targets = WINDOWS.map((window) => board.target(window.id, window.startMs, window.endMs, window.at));
    const cancelled = await runScheduledFocus(board.host, targets, {
      emphasis: "spotlight",
      veil: VEIL,
      getAudioPositionMs: board.now,
      waitUntilAudioMs: board.waitUntil,
      // The turn is cancelled once the first target has been traced.
      isCancelled: () => board.traces().length >= 1,
      floorMs: 420,
    });
    assert(cancelled === true, "a cancelled focus must say so, so the caller drops the rest of the segment");
    assert(board.traces().length === 1, `a cancel between targets must stop the loop, traced ${board.traces().length}`);
    assert(board.letters().length === 1, "a cancel between targets must not letter the next target's label");
    const spotlights = board.spotlights();
    assert(spotlights.length >= 3, `expected raise, re-aim and lower, got ${spotlights.length} spotlight calls`);
    assert(spotlights[0]!.hole !== null, "the veil must be raised before the first target");
    const aimedAtM = spotlights.find((event) => event.hole && event.at < WINDOWS[0].startMs && event.at >= WINDOWS[0].startMs - FOCUS_FLIGHT_LEAD_MS);
    assert(aimedAtM?.hole, "the hole must move to the target as its beat begins");
    const hole = aimedAtM.hole!;
    const rect = targets[0]!.rects[0]!;
    assert(
      hole.x <= rect.x && hole.y <= rect.y && hole.x + hole.width >= rect.x + rect.width && hole.y + hole.height >= rect.y + rect.height,
      "the re-aimed hole must cover the spoken target",
    );
    assert(
      hole.width < 200,
      `the per-target hole must light that target alone, not the union of all three (width ${hole.width})`,
    );
    assert(
      spotlights[spotlights.length - 1]!.hole === null,
      "a cancel between targets must still lower the veil; left up it greys the whole figure",
    );
  }

  // --- Arriving late: every target still gets its label and a floor trace, in order. ---
  {
    const board = fakeBoard({ startAtMs: 7000 });
    const targets = WINDOWS.map((window) => board.target(window.id, window.startMs, window.endMs, window.at));
    await runScheduledFocus(board.host, targets, {
      emphasis: "trace",
      veil: VEIL,
      getAudioPositionMs: board.now,
      waitUntilAudioMs: board.waitUntil,
      isCancelled: () => false,
      floorMs: 420,
    });
    assert(board.letters().map((letter) => letter.id).join(",") === "M,C,F", "a late focus still letters every label");
    const traces = board.traces();
    assert(traces.length === 3, "a late focus still traces every target");
    assert(traces.every((trace) => trace.ms >= 180), "a late trace is a gesture, not a flicker");
    assert(
      traces.every((trace, index) => index === 0 || trace.at >= traces[index - 1]!.at),
      "a late focus never runs the clock backwards",
    );
    assert(board.now() - 7000 < 3 * (420 + 160 + 60) + 1, "a late focus does not wait for windows that have passed");
  }

  // --- The executor wires the loop, and labels are released by ids alone. ---
  {
    const strip = (raw: string) => raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const executor = strip(readFileSync(
      new URL("../../features/tutor-session/hooks/useCommandExecution.ts", import.meta.url),
      "utf8",
    ));
    assert(
      !/takeDeferredAnnotations\([^)]*\btext:/.test(executor),
      "no command may release withheld labels by text: a WRITE row containing a letter is not that label's name",
    );
    assert(/focusSchedule\?: FocusTargetSchedule/.test(executor), "executeCommand must accept a focusSchedule option");
    assert(/getAudioPositionMs\?: \(\) => number/.test(executor), "executeCommand must accept the audio clock the schedule is measured on");
    assert(
      /case "FOCUS":[\s\S]{0,1200}?!codeLessonActive &&[\s\S]{0,200}?focusSchedule &&[\s\S]{0,6000}?runScheduledFocus\(/.test(executor),
      "the FOCUS branch must run a schedule through runScheduledFocus, and never on a code lesson",
    );
    assert(
      /waitUntilAudioMs: \(targetMs\) =>\s*waitUntilDrawClock\(focusAudioClock, targetMs, \{\s*shouldCancel: commandCancelled,\s*getPlaybackRate: options\.getPlaybackRate,/.test(executor),
      "the schedule's waits must run on the audio clock with the playback rate, as the runner's do",
    );
    assert(
      /entityIds: \[\.\.\.spec\.targetIds, \.\.\.targets\.map\(\(target\) => target\.id\)\]/.test(executor),
      "without a schedule the FOCUS branch keeps today's release by ids",
    );
    const gesture = strip(readFileSync(
      new URL("../../../../packages/drawing/src/protocol/semanticGesture.ts", import.meta.url),
      "utf8",
    ));
    assert(!/trigger\.text/.test(gesture), "takeDeferredAnnotations must not read a text trigger");
  }

  console.log("verify-focus-execution: each focus target is lettered in its beat and traced on its name, in spoken order, and a cancel lowers the veil");
}

void main();
