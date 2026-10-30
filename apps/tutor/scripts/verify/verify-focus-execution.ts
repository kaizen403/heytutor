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
  FOCUS_HOP_MAX_MS,
  FOCUS_PULSE_MS,
  focusHopMs,
  runScheduledFocus,
  type ScheduledFocusHost,
  type ScheduledFocusTarget,
} from "../../features/tutor-session/lib/board/scheduledFocus";
import type { SpotlightRect, SpotlightSpec } from "../../features/tutor-session/lib/board/spotlight";
import {
  MAX_PINNED_MARKS_PER_PAGE,
  compactPulseBox,
  pinnedMarksFor,
} from "../../features/tutor-session/lib/board/pinnedMarks";
import { emphasisEllipsePath, type DrawCommand, type VerifiedDiagram } from "@heytutor/drawing";

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
function fakeBoard(options: { startAtMs?: number; letterMs?: number; labelOffsetPx?: number; flightScaleAfterLetter?: number } = {}) {
  let audioMs = options.startAtMs ?? 0;
  let flightScale = 1;
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
      assert(ms >= 0, "a flight cannot have a negative duration");
      events.push({ kind: "fly", at: audioMs, x, y, ms });
      audioMs += ms / flightScale;
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
      flightScale = options.flightScaleAfterLetter ?? flightScale;
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
  // A label can leave the board at a slower animation pace than the voice.
  // The remaining speech time is not the duration the flight may consume.
  {
    const board = fakeBoard({ letterMs: 160, flightScaleAfterLetter: 0.5 });
    await runScheduledFocus(board.host, [board.target("M", 900, 2600, WINDOWS[0].at)], {
      emphasis: "trace", veil: VEIL, getAudioPositionMs: board.now,
      waitUntilAudioMs: board.waitUntil, isCancelled: () => false, floorMs: 420,
      flightBudgetMs: (audioMs: number) => audioMs * 0.5,
    });
    assert(board.traces()[0]!.at === 900, "a slowed return after lettering must still leave the trace on its spoken word");
  }

  // Finishing a label on the word leaves no time for a second flight.
  {
    const board = fakeBoard({ letterMs: 220 });
    await runScheduledFocus(board.host, [board.target("M", 900, 2600, WINDOWS[0].at)], {
      emphasis: "trace", veil: VEIL, getAudioPositionMs: board.now,
      waitUntilAudioMs: board.waitUntil, isCancelled: () => false, floorMs: 420,
    });
    assert(board.traces()[0]!.at === 900, "an exhausted lead must not add another flight after the word");
    const landing = board.events.filter((event): event is FlyEvent => event.kind === "fly").at(-1)!;
    assert(landing.ms === 0, "an exhausted lead must settle the nib at the trace start");
  }

  // A lead may be exhausted while its owning cue still has time left.
  // Once the actual writing deadline expires, there must be no endpoint jump.
  for (const deadlineMs of [900, 1800]) {
    const board = fakeBoard({ letterMs: deadlineMs === 900 ? 440 : 220 });
    await runScheduledFocus(board.host, [board.target("M", 900, 2600, WINDOWS[0].at)], {
      emphasis: "trace", veil: VEIL, getAudioPositionMs: board.now,
      waitUntilAudioMs: board.waitUntil, isCancelled: () => false, floorMs: 420,
      deadlineMs,
    });
    const settles = board.events.filter((event): event is FlyEvent => event.kind === "fly" && event.ms === 0);
    if (deadlineMs === 1800) {
      assert(settles.length === 1 && settles[0]?.x === WINDOWS[0].at.x && settles[0]?.y === WINDOWS[0].at.y,
        "an exhausted lead with a live deadline settles at the trace start exactly once");
      assert(board.traces()[0]?.at === 900, "a live deadline retains trace onset on the word");
    } else {
      assert(settles.length === 0, "an expired deadline never settles an old focus endpoint");
      assert(board.traces().length === 0, "an expired deadline never starts a catch-up trace");
    }
  }

  // Late alignment can expire the deadline after lettering, while sizing
  // a zero-time return. The dispatch must re-read ownership before settling.
  {
    const board = fakeBoard({ letterMs: 220 });
    let timingReadsAfterLetter = 0;
    await runScheduledFocus(board.host, [board.target("M", 900, 2600, WINDOWS[0].at)], {
      emphasis: "trace", veil: VEIL, getAudioPositionMs: board.now,
      waitUntilAudioMs: board.waitUntil, isCancelled: () => false, floorMs: 420,
      getTiming: () => ({
        targets: [{ id: "M", startMs: 900, endMs: 2600, anchor: "clause" }],
        deadlineMs: board.letters().length && timingReadsAfterLetter++ >= 2 ? 900 : 1800,
      }),
    });
    assert(timingReadsAfterLetter >= 3, "the alignment update actually occurs while sizing the return");
    assert(!board.events.some(event => event.kind === "fly" && event.ms === 0),
      "alignment expiry before zero-flight dispatch cannot catch up the endpoint");
    assert(board.traces().length === 0, "alignment expiry cannot start a catch-up trace");
  }

  // Already-revealed labels, as in the recorded pyramid intro, need no return.
  {
    const board = fakeBoard();
    const target = board.target("M", 900, 2600, WINDOWS[0].at);
    target.letter = async () => ({ cancelled: false, penAt: null });
    await runScheduledFocus(board.host, [target], {
      emphasis: "trace", veil: VEIL, getAudioPositionMs: board.now,
      waitUntilAudioMs: board.waitUntil, isCancelled: () => false, floorMs: 420,
      flightBudgetMs: (audioMs) => audioMs * 0.5,
    });
    assert(board.events.filter((event) => event.kind === "fly").length === 1, "revealed labels must keep their single original approach");
    assert(board.traces()[0]!.at === 900, "a revealed label keeps its trace on the spoken word");
  }

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
    const acrossBoard = focusHopMs({ x: 0, y: 0 }, { x: 800, y: 0 }, 600);
    assert(acrossBoard >= 360 && acrossBoard <= 420, "an explanatory cross-board reach must take enough frames to read as a smooth hand movement");
    assert(FOCUS_FLIGHT_LEAD_MS >= acrossBoard + 120, "leave early enough to finish the slower reach and label before the spoken name");
    assert(focusHopMs(null, { x: 0, y: 0 }, 160) === 160, "an unknown start costs the cap");
    assert(focusHopMs({ x: 0, y: 0 }, { x: 3, y: 0 }, 160) === 0, "under the nib's settle distance there is no flight");
    assert(focusHopMs({ x: 0, y: 0 }, { x: 14, y: 0 }, 160) === 80, "a hop across a label spans several display frames");
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

  // --- External cancellation joins a parked initial flight without unpausing. ---
  {
    const board = fakeBoard();
    let cancelled = false;
    let pollFlight = () => {};
    let releaseFlight = () => {};
    board.host.flyCursorTo = (...args: unknown[]) => new Promise<void>((resolve) => {
      const shouldCancel = args[4] as (() => boolean) | undefined;
      releaseFlight = resolve;
      pollFlight = () => { if (shouldCancel?.()) resolve(); };
    });
    let settled = false;
    const run = runScheduledFocus(board.host, [board.target("M", 900, 2600, WINDOWS[0].at)], {
      emphasis: "spotlight", veil: VEIL, getAudioPositionMs: board.now,
      waitUntilAudioMs: board.waitUntil, isCancelled: () => cancelled, floorMs: 420,
    }).then((result) => { settled = true; return result; });
    const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
    await flush();
    assert(!settled, "the flight must really be parked before external cancellation");
    cancelled = true;
    pollFlight();
    await flush();
    try {
      assert(settled, "scheduled focus must pass external cancellation to its initial flight so it joins while paused");
      assert(await run, "cancelled flight reports cancellation");
      assert(board.letters().length === 0, "a cancelled flight cannot consume/letter deferred annotations");
      assert(board.traces().length === 0, "a cancelled flight cannot trace");
      assert(board.spotlights().at(-1)?.hole === null, "a cancelled flight lowers its spotlight");
    } finally { releaseFlight(); await run; }
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
    assert(board.now() - 7000 < 3 * (420 + FOCUS_HOP_MAX_MS + 60) + 1, "a late focus spends only its bounded movement budget, without waiting for windows that have passed");
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
      /waitUntilAudioMs: async \(targetMs, getTargetMs\) =>[\s\S]{0,250}?const waitingFor = nextTarget;\s*await waitUntilDrawClock\(focusAudioClock, waitingFor, \{\s*shouldCancel: \(\) => commandCancelled\(\) \|\| Boolean\(getTargetMs && getTargetMs\(\) !== waitingFor\),\s*getPlaybackRate: options\.getPlaybackRate,/.test(executor),
      "the schedule's changing target waits retain the audio clock, cancellation and playback rate",
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

  // --- `[FOCUS:id|keep]`: one ring per verified part, from compactPulseBox. ---
  {
    const diagram: VerifiedDiagram = {
      id: "verified_scene", layout: "standard", name: "kept rings",
      anchors: [
        { id: "B", labels: ["B"], x: 700, y: 200, width: 80, height: 80 },
        { id: "P", labels: ["P"], x: 900, y: 300, width: 10, height: 10 },
        { id: "reference_picture.part.1", labels: ["R1"], x: 610, y: 241, width: 22, height: 14 },
      ],
      groups: [], reveals: [], promptAddon: "", deferredAnnotations: [],
      commands: [
        { type: "DRAW_LINE", params: [700, 200, 780, 280], semanticRef: { entityId: "B" } },
        { type: "DRAW_POINT", params: [905, 305, 4], semanticRef: { entityId: "P" } },
      ],
    };
    const focus = (text: string, params: number[] = []): DrawCommand => ({ type: "FOCUS", params, text, semanticRef: { entityId: text }, charPosition: 0, narrationBefore: "" });
    const plan = (text: string, pinsOnPage = 0, layout: VerifiedDiagram["layout"] = "standard", codeLessonActive = false) =>
      pinnedMarksFor({
        command: focus(text, [1, 2, 3, 4]),
        targets: diagram.anchors.filter((anchor) => text.split("|")[0]!.split(",").includes(anchor.id)),
        diagram: { ...diagram, layout },
        targetCommands: diagram.commands,
        codeLessonActive,
        pinsOnPage,
      });
    assert(plan("B|pulse").pins.length === 0, "a FOCUS without keep pins nothing");
    const kept = plan("B,P|keep");
    assert(kept.pins.length === 2 && kept.overflow.length === 0, "keep rings every named verified part");
    const boxB = compactPulseBox(diagram.anchors[0]!, [diagram.commands[0]!]);
    const boxP = compactPulseBox(diagram.anchors[1]!, [diagram.commands[1]!]);
    assert(kept.pins[0]!.path === emphasisEllipsePath(boxB.x, boxB.y, boxB.width, boxB.height), "B's ring is compactPulseBox of B");
    assert(kept.pins[1]!.path === emphasisEllipsePath(boxP.x, boxP.y, boxP.width, boxP.height), "P's ring is compactPulseBox of P's own point");
    assert(boxP.width === 24 && boxP.x === 893, "a point's ring is its own compact box");
    assert(!kept.pins.some((pin) => pin.box.x === 1 || pin.box.y === 2), "the command's params never reach a ring");
    const capped = plan("B,P|keep", MAX_PINNED_MARKS_PER_PAGE - 1);
    assert(MAX_PINNED_MARKS_PER_PAGE === 3, "the page cap is three rings");
    assert(capped.pins.length === 1 && capped.overflow.length === 1, "past the page cap a keep draws as a transient pulse");
    assert(plan("B|keep", 0, "code_lesson").pins.length === 0, "never a kept ring on a code lesson board");
    assert(plan("B|keep", 0, "standard", true).pins.length === 0, "never a kept ring while a code lesson plays");
    assert(plan("reference_picture.part.1|keep").pins.length === 0, "never a kept ring on a reference picture part in v1");
    const again = pinnedMarksFor({
      command: focus("B|keep"), targets: [diagram.anchors[0]!], diagram, targetCommands: diagram.commands,
      codeLessonActive: false, pinsOnPage: 1, alreadyPinned: new Set(["B"]),
    });
    assert(again.pins.length === 0 && again.overflow.length === 0, "a part already ringed on this page gets no second ring");

    // The seek pass draws the kept ring before it skips every gesture. Both
    // anchors of the slice are checked so a moved anchor cannot fail open.
    const strip = (raw: string) => raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const executor = strip(readFileSync(
      new URL("../../features/tutor-session/hooks/useCommandExecution.ts", import.meta.url),
      "utf8",
    ));
    const focusStart = executor.indexOf('case "FOCUS": {');
    const focusEnd = executor.indexOf('case "EMPHASIZE": {', focusStart);
    assert(focusStart >= 0, "slice anchor: the FOCUS case");
    assert(focusEnd > focusStart, "slice anchor: the EMPHASIZE case after FOCUS");
    const focusCase = executor.slice(focusStart, focusEnd);
    const seekGate = /if \(isSeekCatchUp\) \{\s*await drawKeptFocusRings\(command, targets, activeDiagram, codeLessonActive\);\s*break;\s*\}/;
    assert(seekGate.test(focusCase), "a seek draws the kept ring at duration 0 before the isSeekCatchUp break");
    assert(!/if \(isSeekCatchUp\) break;/.test(focusCase), "no bare isSeekCatchUp break may skip the kept ring");
    assert(/if \(scheduleCancelled\) return;\s*if \(await drawKeptFocusRings\(/.test(focusCase), "the scheduled path rings after its traces");
    assert(/if \(focusCancelled\) return;\s*if \(await drawKeptFocusRings\(/.test(focusCase), "the unscheduled path rings after its trace or spotlight");
    const helperStart = executor.indexOf("const drawKeptFocusRings = async (");
    const helperEnd = executor.indexOf("let command = rawCommand;", helperStart);
    assert(helperStart >= 0 && helperEnd > helperStart, "slice anchors: the kept ring helper");
    const helper = executor.slice(helperStart, helperEnd);
    assert(/const ringMs = isSeekCatchUp \? 0 : PINNED_MARK_DRAW_MS;/.test(helper), "a seek draws the ring at duration 0");
    assert(/pinned: true/.test(helper), "kept rings are drawn with pinned");
    assert(!/focusCommand\.params/.test(helper), "the helper never reads the model's params");
  }

  // A numbered picture's key entry is one spoken window with two places:
  // its mark on the drawing, then its row in the key. Both rings fall inside
  // the window, mark first, and the spotlight follows the pen from one to
  // the other instead of one hole spanning both. Each hole is used exactly
  // as given, since a fixed pad does not clear a ring round a tall row.
  {
    const board = fakeBoard();
    const mark = { x: 520, y: 470, width: 9, height: 12 };
    const row = { x: 922, y: 300, width: 196, height: 30 };
    const keyEntry: ScheduledFocusTarget = {
      ...board.target("reference_picture.key.3", 1400, 3800, { x: mark.x, y: mark.y }),
      rects: [mark, row],
      paths: [ring("mark", mark.x, mark.y), ring("row", row.x, row.y)],
      pathHoles: [
        { x: mark.x - 14, y: mark.y - 12, width: mark.width + 28, height: mark.height + 24 },
        { x: row.x - 16, y: row.y - 7, width: row.width + 32, height: row.height + 14 },
      ],
    };
    const cancelled = await runScheduledFocus(board.host, [keyEntry], {
      emphasis: "spotlight", veil: VEIL, getAudioPositionMs: board.now,
      waitUntilAudioMs: board.waitUntil, isCancelled: () => false, floorMs: 420,
    });
    assert(!cancelled, "the key entry runs to the end");
    const traces = board.traces();
    assert(traces.map((trace) => trace.path).join(",") === "ring:mark,ring:row", "mark first, then the key row");
    assert(traces[0]!.at >= 1400, "the mark is ringed on the name, not before it");
    const last = traces.at(-1)!;
    assert(last.at + last.ms <= 3800 + 1, `the key row's ring ends with the clause (${last.at + last.ms})`);
    const holes = board.spotlights().flatMap((event) => event.hole ? [event.hole] : []);
    const holeOf = (rect: SpotlightRect) => {
      const hole = keyEntry.pathHoles![rect === mark ? 0 : 1]!;
      return `${hole.x},${hole.y},${hole.width},${hole.height}`;
    };
    const seen = holes.map((hole) => `${hole.x},${hole.y},${hole.width},${hole.height}`);
    assert(seen[0] === holeOf(mark), "the veil opens on the mark, not on both places");
    assert(seen.at(-1) === holeOf(row), "the veil ends on the key row");
    const rowHoleAt = board.spotlights().find((event) => event.hole && `${event.hole.x},${event.hole.y},${event.hole.width},${event.hole.height}` === holeOf(row))!.at;
    assert(rowHoleAt >= traces[0]!.at + traces[0]!.ms && rowHoleAt <= traces[1]!.at,
      "the hole moves to the row between the two rings");
  }

  console.log("verify-focus-execution: each focus target is lettered in its beat and traced on its name, in spoken order, and a cancel lowers the veil");
}

void main();
