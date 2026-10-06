/**
 * The video tail: after the frame loop reaches the end of the audio, the
 * drawing must still be able to finish.
 *
 * The export board only moves when its virtual clock is pumped. A last mark,
 * dwell or pause that runs past the last cue's end waited on a clock nobody
 * moved again, so `await drawPromise` hung and the control sat on 99% for
 * ever. This gate runs the real `drawLectureTimeline` on the real virtual
 * clock with an executor that animates on the clock's frames (as Konva does)
 * and proves the tail drains, stops at Cancel, and gives up at its limit.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createVirtualWhiteboardClock } from "@heytutor/whiteboard";
import { drawLectureTimeline } from "../../lib/lecture-export/drawLectureTimeline";
import {
  LECTURE_EXPORT_TAIL_LIMIT_MS,
  drainExportTail,
  pumpExportClock,
} from "../../lib/lecture-export/lectureExportTail";
import type { ReplayCue } from "../../lib/replay/replayTimeline";

const FRAME_MS = 1000 / 24;
const RATE = 1.25;
const STEP_MS = FRAME_MS * RATE;
const WALL_LIMIT_MS = 3_000;

function cue(id: string, startMs: number, endMs: number): ReplayCue {
  return {
    id,
    turnIndex: 0,
    segmentIndex: 0,
    startMs,
    endMs,
    durationMs: endMs - startMs,
    narration: "",
    commands: [{ type: "WRITE", text: "x", params: [90, 142], charPosition: 0, narrationBefore: "" }],
    trustedDiagramGeometry: false,
    audioUrl: null,
    durationMsStored: endMs - startMs,
    timings: null,
    segment: {
      id: `seg-${id}`,
      orderIndex: 0,
      narration: "",
      spokenText: "",
      command: null,
      audioUrl: null,
      durationMs: endMs - startMs,
      timings: null,
    },
  };
}

type Outcome = {
  tail: Awaited<ReturnType<typeof drainExportTail>> | "hung";
  draw: "resolved" | "hung";
  stepTimes: number[];
};

const withinWall = <T,>(work: Promise<T>): Promise<T | "hung"> =>
  Promise.race([
    work,
    new Promise<"hung">((done) => {
      setTimeout(() => done("hung"), WALL_LIMIT_MS);
    }),
  ]);

/**
 * Two cues (0 to 2000, 2000 to 3000 ms). The first draws for 500 ms; the
 * second for `lastMs`, as ink on the clock's frames or as a clock wait (a PAUSE
 * or a marker tour dwell, `cancellableDelay` in the export hook).
 */
async function runExport(options: {
  lastMs: number;
  lastKind: "ink" | "dwell";
  cancelAtStep?: number;
  limitMs?: number;
  /** Skip waiting for a drawing the case expects to still be running. */
  skipDrawWait?: boolean;
}): Promise<Outcome> {
  const clock = createVirtualWhiteboardClock(0);
  let cancelled = false;
  const shouldCancel = () => cancelled;
  const cues = [cue("a", 0, 2000), cue("b", 2000, 3000)];
  const totalMs = 3000;
  let call = 0;
  const executeCommand = async () => {
    const drawMs = call++ === 0 ? 500 : options.lastMs;
    const start = clock.source.now();
    if (options.lastKind === "dwell" && call === 2) {
      while (!cancelled && clock.now() - start < drawMs) await clock.waitForAdvance();
      return;
    }
    await new Promise<void>((done) => {
      const step = () => {
        if (cancelled || clock.source.now() - start >= drawMs) done();
        else clock.source.requestFrame(step);
      };
      clock.source.requestFrame(step);
    });
  };
  const drawPromise = drawLectureTimeline({
    cues,
    executeCommand,
    getClockMs: clock.now,
    waitForAdvance: clock.waitForAdvance,
    shouldCancel,
  });

  // The export's frame loop: one pump per frame in file time at 1.25x.
  const fileTotalMs = totalMs / RATE;
  const totalFrames = Math.ceil(fileTotalMs / FRAME_MS);
  for (let frame = 0; frame < totalFrames; frame++) {
    clock.setNow(frame * FRAME_MS * RATE);
    await pumpExportClock(clock);
    await new Promise((done) => setTimeout(done, 0));
  }

  const stepTimes: number[] = [];
  const tail = await withinWall(
    drainExportTail({
      clock,
      drawPromise,
      shouldCancel,
      startMs: totalFrames * FRAME_MS * RATE,
      stepMs: STEP_MS,
      limitMs: options.limitMs,
      onStep: (mediaMs, step) => {
        stepTimes.push(mediaMs);
        if (options.cancelAtStep !== undefined && step >= options.cancelAtStep) cancelled = true;
      },
    }),
  );
  const draw = options.skipDrawWait
    ? "hung"
    : await withinWall(drawPromise.then(() => "resolved" as const));
  cancelled = true;
  clock.pump();
  return { tail, draw, stepTimes };
}

async function main(): Promise<void> {
  {
    const fits = await runExport({ lastMs: 500, lastKind: "ink" });
    assert.notEqual(fits.tail, "hung", "a lesson whose ink fits its audio must finish");
    if (fits.tail === "hung") return;
    assert.equal(fits.tail.settled, true);
    // The timeline's last wait ends on the first advance: that one frame is
    // sampled (it could hold marks), and the encoder drops it when the picture
    // did not change, so the file is as before.
    assert.equal(fits.tail.steps, 1, "ink inside the audio adds only the one frame that confirms the end");
    assert.equal(fits.draw, "resolved");
  }

  {
    const overrun = await runExport({ lastMs: 1500, lastKind: "ink" });
    assert.notEqual(
      overrun.tail,
      "hung",
      "the 99% hang: ink that runs past the last word must finish, not wait on a frozen clock",
    );
    if (overrun.tail === "hung") return;
    assert.equal(overrun.tail.settled, true, "the overrunning ink settles inside the tail");
    assert.equal(overrun.tail.cancelled, false);
    assert.ok(overrun.tail.steps > 0, "the tail frames are encoded so the last mark is in the file");
    assert.ok(overrun.tail.extraMs <= 1_000, `the tail stops once the ink lands (${overrun.tail.extraMs} ms)`);
    assert.equal(overrun.draw, "resolved");
    for (let index = 1; index < overrun.stepTimes.length; index++) {
      assert.ok(
        overrun.stepTimes[index]! > overrun.stepTimes[index - 1]!,
        "each tail frame samples a later instant",
      );
    }
  }

  {
    const dwell = await runExport({ lastMs: 1500, lastKind: "dwell" });
    assert.notEqual(dwell.tail, "hung", "a last pause or marker dwell past the audio must finish");
    if (dwell.tail === "hung") return;
    assert.equal(dwell.tail.settled, true);
    assert.equal(dwell.draw, "resolved");
  }

  {
    const cancelled = await runExport({ lastMs: 1500, lastKind: "dwell", cancelAtStep: 2 });
    assert.notEqual(cancelled.tail, "hung", "Cancel at the tail must return");
    if (cancelled.tail === "hung") return;
    assert.equal(cancelled.tail.cancelled, true, "the tail reports the cancel");
    assert.equal(
      cancelled.draw,
      "resolved",
      "Cancel at the tail releases the drawing's clock waits (they need a pump to re-check)",
    );
  }

  {
    // A dwell far longer than the limit: the tail gives up and the file ends.
    const limitMs = 2_000;
    const endless = await runExport({ lastMs: 600_000, lastKind: "dwell", limitMs, skipDrawWait: true });
    assert.notEqual(endless.tail, "hung", "a drawing that never settles must not hang the export");
    if (endless.tail === "hung") return;
    assert.equal(endless.tail.settled, false, "the tail reports it gave up");
    assert.ok(endless.tail.extraMs <= limitMs, "the tail never draws past its limit");
    assert.ok(
      endless.tail.steps <= Math.ceil(limitMs / STEP_MS) + 1,
      "one encoded frame per step, bounded by the limit",
    );
  }

  {
    // The drawing finishes on the tail's very first advance: the marks that
    // advance put down need a frame, or the file ends without them.
    let now = 0;
    let finish: () => void = () => {};
    const drawPromise = new Promise<void>((done) => {
      finish = done;
    });
    const pumpedAt: number[] = [];
    const clock = {
      now: () => now,
      setNow: (ms: number) => {
        now = ms;
      },
      pump: () => {
        pumpedAt.push(now);
        if (now >= 3_000) finish();
      },
      pendingCount: () => 0,
    };
    const stepTimes: number[] = [];
    const lastMark = await withinWall(
      drainExportTail({
        clock,
        drawPromise,
        shouldCancel: () => false,
        startMs: 3_000,
        stepMs: STEP_MS,
        onStep: (mediaMs) => {
          stepTimes.push(mediaMs);
        },
        yieldToHost: () => new Promise((done) => setTimeout(done, 0)),
      }),
    );
    assert.notEqual(lastMark, "hung");
    if (lastMark === "hung") return;
    assert.equal(lastMark.settled, true);
    assert.deepEqual(pumpedAt.slice(0, 1), [3_000], "the first advance is the one that lands the last mark");
    assert.equal(lastMark.steps, 1, "the frame of that advance is encoded, so the final ink is in the file");
    assert.deepEqual(stepTimes, [3_000], "sampled after the advance, at its instant");

    // A drawing already finished before the tail adds no frame at all.
    const pumpedEarly: number[] = [];
    const finished = await withinWall(
      drainExportTail({
        clock: { ...clock, pump: () => pumpedEarly.push(now) },
        drawPromise: Promise.resolve(),
        shouldCancel: () => false,
        startMs: 3_000,
        stepMs: STEP_MS,
        onStep: () => {
          throw new Error("no tail frame for a finished drawing");
        },
        yieldToHost: () => new Promise((done) => setTimeout(done, 0)),
      }),
    );
    assert.notEqual(finished, "hung");
    if (finished === "hung") return;
    assert.equal(finished.steps, 0, "a drawing done before the tail adds no frame: the file is as before");
    assert.deepEqual(pumpedEarly, [], "and the clock is not moved");
  }

  assert.equal(LECTURE_EXPORT_TAIL_LIMIT_MS, 8_000, "the owner's limit: at most 8 s after the last word");

  // The encoder must drain the tail, never await the drawing bare. Both
  // anchors are checked: a missing end anchor would widen the slice and let a
  // later function satisfy the assertion.
  {
    const source = readFileSync(
      resolve(import.meta.dirname, "../../lib/lecture-export/exportLectureMp4.ts"),
      "utf8",
    );
    const startAnchor = "const totalFrames = Math.max(";
    const endAnchor = "await output.finalize();";
    const from = source.indexOf(startAnchor);
    assert.ok(from >= 0, `exportLectureMp4.ts: start anchor "${startAnchor}" is gone; repoint this gate`);
    const to = source.indexOf(endAnchor, from);
    assert.ok(to > from, `exportLectureMp4.ts: end anchor "${endAnchor}" is gone; repoint this gate`);
    const tail = source.slice(from, to);
    assert.ok(tail.includes("drainExportTail("), "the encoder must drain the tail after the frame loop");
    assert.ok(/if \(await encodeFrame\(totalFrames \+ step, mediaMs\)\) tailChanged = true;/.test(tail),
      "the encoder notes whether a tail frame changed the picture");
    assert.ok(tail.includes("const encodedFrames = totalFrames + (tail.settled && tail.steps === 1 && !tailChanged ? 0 : tail.steps);"),
      "a tail frame that only confirmed the end does not lengthen the file; one that put marks down is kept");
    assert.equal(
      /await\s+drawPromise\b/.test(tail),
      false,
      "the encoder must never await the drawing bare: it waits on a clock only the drain moves",
    );
  }

  console.log("verify-lecture-export-tail: overrunning ink and dwells drain, Cancel releases, the limit holds");
  process.exit(0);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
