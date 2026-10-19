/** Actual scheduled handwriting follows a live positive clock through buffering. */
import assert from "node:assert/strict";
import { mountTestWhiteboard, unmountTestWhiteboard } from "./whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../src/whiteboardClock";
import { runWhiteboardVerifier } from "./runWhiteboardVerifier";
import type { WhiteboardHandle, WriteSchedule } from "../src/Whiteboard";

type Start = { wallMs: number; audioPositionMs: number; targetMs: number };
type Options = {
  raw: (wallMs: number) => number;
  active?: (wallMs: number) => boolean;
  offsets?: number[];
  control?: (board: WhiteboardHandle, wallMs: number, starts: Start[]) => boolean | void;
};
async function actualWrite(options: Options) {
  const board = mountTestWhiteboard();
  const clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  board.setCursorPos(90, 208);
  const starts: Start[] = [];
  let completed = false;
  let unmounted = false;
  const schedule: WriteSchedule = {
    // P08's due prefix followed by '-' and '1' during a finite positive plateau.
    charStartOffsetsMs: options.offsets ?? [0, 5824, 6320],
    charDurationsMs: [120, 496, 120],
    getAudioPositionMs: () => options.raw(clock.now()),
    getPlaybackRate: () => 1.25,
    isAudioActive: options.active ? () => options.active!(clock.now()) : undefined,
    onCharacterStart: event => starts.push({ wallMs: clock.now(), ...event }),
  };
  const work = board.writeText("t-1", 90, 208, 2000, schedule, 32).then(() => { completed = true; });
  try {
    for (let step = 0; step < 1000 && !completed; step++) {
      clock.advance(16);
      unmounted = options.control?.(board, clock.now(), starts) === true || unmounted;
      clock.pump();
      for (let count = 0; count < 20; count++) await Promise.resolve();
    }
    assert(completed, "actual scheduled work must complete or cancel within its bounded media timeline");
    await work;
    return { starts, completedAtMs: clock.now(), pendingFrames: clock.pendingCount() };
  } finally { if (!unmounted) unmountTestWhiteboard(board); }
}

async function main() {
  let groups = 0;
  const positive = (wallMs: number) => 3050 + Math.max(0, wallMs - 900) * 1.25;
  const buffered = await actualWrite({ raw: positive, active: () => true });
  assert.equal(buffered.starts.length, 3, "all three actual glyphs start after finite buffering");
  assert(buffered.starts.every(start => start.audioPositionMs >= start.targetMs - 50),
    `an active positive clock must not release future glyphs early: ${JSON.stringify(buffered.starts)}`);
  groups++;

  const longBuffer = await actualWrite({ raw: wallMs => 3050 + Math.max(0, wallMs - 7000) * 1.25, active: () => true });
  assert(longBuffer.starts.every(start => start.audioPositionMs >= start.targetMs - 50), "a known active clock cannot be replaced by elapsed wall time during a longer buffer");
  groups++;

  const firstCue = await actualWrite({ raw: positive, active: () => true, offsets: [5824, 6100, 6320] });
  assert(firstCue.starts.every(start => start.audioPositionMs >= start.targetMs - 50), "the first-glyph approach also holds the active clock");
  groups++;

  const inactive = await actualWrite({ raw: () => 16 });
  assert.equal(inactive.starts.length, 3);
  assert(inactive.completedAtMs < 5000, "a legacy/dead positive clock keeps its bounded escape");
  groups++;
  const explicitlyInactive = await actualWrite({ raw: () => 16, active: () => false });
  assert(explicitlyInactive.completedAtMs < 5000, "an inactive live schedule keeps the same bounded escape");
  groups++;
  for (const raw of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const unavailable = await actualWrite({ raw: () => raw, active: () => true });
    assert.equal(unavailable.starts.length, 3);
    assert(unavailable.completedAtMs < 9000, "active state cannot make a missing/invalid clock hang");
    groups++;
  }

  const ended = await actualWrite({ raw: () => 3050, active: wallMs => wallMs < 900 });
  assert.equal(ended.starts.length, 3);
  assert(ended.starts[1]!.wallMs >= 900, "valid playback holds ink until the segment actually ends");
  assert(ended.completedAtMs < 5000, "terminal speech releases a permanently stuck positive clock");
  groups++;

  let pauseVerified = false;
  const paused = await actualWrite({ raw: wallMs => 3050 + Math.max(0, wallMs - 2600) * 1.25, active: () => true,
    control: (board, wallMs, starts) => {
      if (wallMs === 208) board.setPaused(true);
      if (wallMs === 2400) { assert.equal(starts.length, 1, "no future glyph starts while paused"); pauseVerified = true; board.setPaused(false); }
    },
  });
  assert(pauseVerified);
  assert(paused.starts.every(start => start.audioPositionMs >= start.targetMs - 50), "resume retains media-clock authority through its remaining buffer");
  groups++;

  for (const mode of ["cancel", "unmount"] as const) {
    const cancelled = await actualWrite({ raw: () => 3050, active: () => true,
      control: (board, wallMs) => {
        if (wallMs === 208) board.setPaused(true);
        if (wallMs === 320) {
          if (mode === "cancel") board.cancelAnimations();
          else { unmountTestWhiteboard(board); return true; }
        }
      },
    });
    assert.equal(cancelled.starts.length, 1, `${mode}: cancelled active cue cannot create future ink`);
    assert(cancelled.completedAtMs <= 352, `${mode}: a paused active cue settles without Resume`);
    assert.equal(cancelled.pendingFrames, 0, `${mode}: no animation frame remains after cancellation`);
    groups++;
  }
  console.log(`verify-active-audio-write: ${groups} groups passed (actual glyphs, bounded fallback, pause and cancellation)`);
}
runWhiteboardVerifier(main);
