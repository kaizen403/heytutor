/**
 * The pen follows the voice. This is the live WRITE path as the runner and
 * clock actually compose it: onStart, then (maybe later) audible playback,
 * then a schedule, then each character waits on resolveLiveAudioPositionMs.
 *
 * The failure this catches: `onStart` fires before the first sample is
 * audible, a 1.5× wall clock races ahead, and the pen dumps "x / y" while
 * the voice is still connecting — then never adopts the real playback
 * position because it looks "behind" the raced max.
 */
import type { DrawCommand } from "@heytutor/drawing";
import {
  AUDIBLE_GRACE_AFTER_START_MS,
  INITIAL_AUDIO_GIVE_UP_MS,
  catchUpWriteScheduleOffsets,
  getBestWriteCharScheduleMs,
  isPlaybackAudible,
  resolveInitialTimingWait,
  resolveLiveAudioPositionMs,
} from "../../src/index";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function command(text: string): DrawCommand {
  return {
    type: "WRITE",
    text,
    params: [90, 120],
    charPosition: 0,
    narrationBefore: "",
  };
}

const SYNC_SLACK_MS = 80;

interface LiveWriteSimInput {
  offsetsMs: readonly number[];
  playbackRate: number;
  /** Wall ms after onStart before getPlaybackPositionMs becomes positive. */
  audibleDelayMs: number;
  /** Wall ms of path setup after the wait releases. */
  setupMs: number;
  tickMs?: number;
}

interface LiveWriteGlyph {
  cueMs: number;
  /** Media ms the voice had actually reached when this glyph started. */
  voiceMs: number;
  /** What the pen's clock claimed. */
  clockMs: number;
}

function voiceMediaMs(wallMs: number, audibleDelayMs: number, rate: number): number {
  if (wallMs < audibleDelayMs) return 0;
  return (wallMs - audibleDelayMs) * rate;
}

function playbackAt(wallMs: number, audibleDelayMs: number, rate: number): number | null {
  if (wallMs < audibleDelayMs) return null;
  const media = voiceMediaMs(wallMs, audibleDelayMs, rate);
  return media > 0 ? media : 1;
}

function simulateLiveWrite(input: LiveWriteSimInput): {
  releasedAtWallMs: number;
  glyphs: LiveWriteGlyph[];
} {
  const tick = input.tickMs ?? 16;
  const rate = input.playbackRate;
  let releasedAtWallMs: number | null = null;

  for (let wall = 0; wall <= 4_000; wall += tick) {
    const started = wall >= 0;
    const decision = resolveInitialTimingWait({
      hasNarration: true,
      timingChars: 24,
      audioStartedAtMs: started ? 0 : null,
      nowMs: wall,
      speechComplete: false,
      cancelled: false,
      playbackPositionMs: playbackAt(wall, input.audibleDelayMs, rate),
    });
    if (decision.release) {
      releasedAtWallMs = wall;
      break;
    }
  }
  assert(releasedAtWallMs !== null, "the pen never got its schedule");

  const writeStartWall = releasedAtWallMs + input.setupMs;
  let maxAudioPositionMs = Number.NEGATIVE_INFINITY;
  const clockAt = (wall: number) => {
    const resolved = resolveLiveAudioPositionMs({
      speechComplete: false,
      capturedDurationMs: null,
      estimateSpeechMs: 8_000,
      playbackPositionMs: playbackAt(wall, input.audibleDelayMs, rate),
      audioStartedAtMs: 0,
      nowMs: wall,
      maxAudioPositionMs,
      playbackRate: rate,
    });
    maxAudioPositionMs = resolved.maxAudioPositionMs;
    return resolved.positionMs;
  };

  const offsets = catchUpWriteScheduleOffsets(
    [...input.offsetsMs],
    clockAt(writeStartWall),
  );

  const glyphs: LiveWriteGlyph[] = [];
  let wall = writeStartWall;
  for (let i = 0; i < offsets.length; i++) {
    const cue = offsets[i]!;
    let started = false;
    for (let guard = 0; guard < 2_000; guard++) {
      const clockMs = clockAt(wall);
      if (clockMs >= cue - 24) {
        glyphs.push({
          cueMs: input.offsetsMs[i]!,
          voiceMs: voiceMediaMs(wall, input.audibleDelayMs, rate),
          clockMs,
        });
        started = true;
        // One glyph of ink at the spoken slot, in media time, run in wall time.
        const slot = Math.min(
          Math.max((input.offsetsMs[i + 1] ?? cue + 160) - (input.offsetsMs[i] ?? cue), 90),
          350,
        );
        wall += slot / rate;
        break;
      }
      wall += tick;
    }
    assert(started, `glyph ${i} never started (cue ${cue}ms)`);
  }

  return { releasedAtWallMs, glyphs };
}

// --- the voice is the clock, even after a wall race ------------------------
{
  const raced = resolveLiveAudioPositionMs({
    speechComplete: false,
    capturedDurationMs: null,
    estimateSpeechMs: 8_000,
    playbackPositionMs: 80,
    audioStartedAtMs: 0,
    nowMs: 1_000,
    maxAudioPositionMs: 1_500,
    playbackRate: 1.5,
  });
  assert(
    Math.abs(raced.positionMs - 80) <= 1,
    `once playback exists it is the voice, not a raced wall max (got ${raced.positionMs})`,
  );
}

assert(
  !isPlaybackAudible(null) && !isPlaybackAudible(0) && !isPlaybackAudible(-40),
  "zero/negative playback is not audible",
);
assert(isPlaybackAudible(1), "a positive playback position is audible");

// Leftover media time from the previous sentence (measured live: 18–73 s)
// must not look like this sentence is already audible.
{
  const leftover = resolveInitialTimingWait({
    hasNarration: true,
    timingChars: 40,
    audioStartedAtMs: 0,
    nowMs: 16,
    speechComplete: false,
    cancelled: false,
    playbackPositionMs: null,
  });
  assert(
    !leftover.release,
    "null playback after onStart means this sentence is not audible yet, even if the last one still has a clock",
  );
}

// --- onStart is not audibility ---------------------------------------------
{
  const afterStart = resolveInitialTimingWait({
    hasNarration: true,
    timingChars: 40,
    audioStartedAtMs: 0,
    nowMs: 13,
    speechComplete: false,
    cancelled: false,
    playbackPositionMs: null,
  });
  assert(
    !afterStart.release,
    "peeked timings + onStart must not release the pen before the voice is audible",
  );
  assert(
    afterStart.release === false && afterStart.releaseAtMs === AUDIBLE_GRACE_AFTER_START_MS,
    "the audible grace is the deadline when playback never arrives",
  );

  const audible = resolveInitialTimingWait({
    hasNarration: true,
    timingChars: 40,
    audioStartedAtMs: 0,
    nowMs: 180,
    speechComplete: false,
    cancelled: false,
    playbackPositionMs: 12,
  });
  assert(audible.release && audible.source === "tts", "the pen starts once playback is audible");
}

// --- "x divided by y" lands on those words, not a silent dump --------------
{
  const narration = "so x divided by y is the ratio we need.";
  const text = "x / y";
  const schedule = getBestWriteCharScheduleMs(narration, command(text), null, undefined, 0, 86);
  assert(schedule, "x / y must get a character schedule against 'x divided by y'");
  assert(schedule.matched, "x / y must match the spoken words");
  assert(
    (schedule.offsetsMs[0] ?? 999) <= 3 * 86 + 40,
    `"x" must start on the spoken x, got ${schedule.offsetsMs[0]}`,
  );
  // Three spoken tokens: x, divided-by, y. Slash owns the "divided by" span.
  const slashSlot = schedule.charDurationsMs[1] ?? 0;
  assert(
    slashSlot >= 2 * 86,
    `"/" must fill "divided by" (${slashSlot} ms is shorter than two spoken characters)`,
  );

  const live = simulateLiveWrite({
    offsetsMs: schedule.offsetsMs,
    playbackRate: 1.5,
    audibleDelayMs: 200,
    setupMs: 80,
  });

  assert(
    live.releasedAtWallMs >= 200,
    `the pen released at +${live.releasedAtWallMs}ms, before the voice was audible at +200ms`,
  );

  for (const glyph of live.glyphs) {
    assert(
      glyph.clockMs <= glyph.voiceMs + SYNC_SLACK_MS,
      `pen clock ${glyph.clockMs}ms led the voice ${glyph.voiceMs}ms by more than ${SYNC_SLACK_MS}ms`,
    );
    assert(
      glyph.voiceMs + SYNC_SLACK_MS >= glyph.cueMs,
      `wrote a glyph whose cue is ${glyph.cueMs}ms while the voice was only at ${glyph.voiceMs}ms`,
    );
    assert(
      glyph.voiceMs - glyph.cueMs < 280,
      `glyph at cue ${glyph.cueMs}ms started ${Math.round(glyph.voiceMs - glyph.cueMs)}ms late`,
    );
  }

  const slash = live.glyphs[1];
  assert(slash, "slash glyph missing");
  assert(
    slash.voiceMs >= slash.cueMs - SYNC_SLACK_MS,
    `the slash must be inked while "divided by" is spoken (voice ${slash.voiceMs}, cue ${slash.cueMs})`,
  );
}

{
  const stillWaiting = resolveInitialTimingWait({
    hasNarration: true,
    timingChars: 0,
    audioStartedAtMs: null,
    nowMs: 1_000,
    speechComplete: false,
    cancelled: false,
    waitedMs: 1_000,
  });
  assert(!stillWaiting.release, "one second of silence is not permission to dump the figure");
  const giveUp = resolveInitialTimingWait({
    hasNarration: true,
    timingChars: 0,
    audioStartedAtMs: null,
    nowMs: INITIAL_AUDIO_GIVE_UP_MS,
    speechComplete: false,
    cancelled: false,
    waitedMs: INITIAL_AUDIO_GIVE_UP_MS,
  });
  assert(
    giveUp.release && giveUp.source === "give_up",
    "the pen must give up if the voice never starts",
  );
}

console.log(
  "verify-live-write-sync: the pen waits for audible playback, adopts the voice " +
    "after a wall race, and writes x / y on 'x divided by y'",
);
