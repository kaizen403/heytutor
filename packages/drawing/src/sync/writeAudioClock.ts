/**
 * WRITE/LABEL waits must not hang when TTS/replay position is missing or stuck.
 * A missing clock used to park the pen while speech continued.
 */

export interface ScheduledWriteClockInput {
  rawPositionMs: number | null | undefined;
  elapsedWallMs: number;
  stalledFrames: number;
}

export function resolveScheduledWriteClockMs(input: ScheduledWriteClockInput): number {
  const wall = Math.max(input.elapsedWallMs, 0);
  const raw = input.rawPositionMs;
  if (raw == null || !Number.isFinite(raw) || raw <= 0) {
    return wall;
  }
  if (input.stalledFrames >= 30) {
    return Math.max(raw, wall);
  }
  return raw;
}

export const WRITE_CLOCK_STALL_FRAMES = 30;

/**
 * Clock the pen uses while waiting for a spoken cue.
 *
 * An advancing playback position is the voice, even when a wall fallback ran
 * ahead of it (onStart firing before the first sample is audible). Holding
 * `max(wall, playback)` forever was the "pen dumps the row, then the lecture
 * starts" failure. A stalled or missing clock still falls through to wall so
 * a dead TTS position cannot park the nib.
 */
export function resolveWriteWaitClockMs(input: {
  rawPositionMs: number;
  elapsedMediaMs: number;
  stalledFrames: number;
  maxPositionMs: number;
}): { positionMs: number; maxPositionMs: number } {
  const raw = input.rawPositionMs;
  if (Number.isFinite(raw) && raw > 0 && input.stalledFrames < WRITE_CLOCK_STALL_FRAMES) {
    return { positionMs: raw, maxPositionMs: raw };
  }
  const fallback = resolveScheduledWriteClockMs({
    rawPositionMs: raw,
    elapsedWallMs: input.elapsedMediaMs,
    stalledFrames: input.stalledFrames,
  });
  const positionMs = Math.max(input.maxPositionMs, fallback);
  return { positionMs, maxPositionMs: positionMs };
}

export function shouldReleaseAudioPositionWait(input: {
  positionMs: number;
  targetMs: number;
  elapsedMs: number;
  clockEverStarted: boolean;
  stalledFrames: number;
}): boolean {
  if (input.positionMs >= input.targetMs) {
    return true;
  }
  if (!input.clockEverStarted && input.elapsedMs >= 400) {
    return true;
  }
  if (input.clockEverStarted && input.stalledFrames >= WRITE_CLOCK_STALL_FRAMES) {
    return true;
  }
  // An advancing clock must wait for a late cue. Capping at 8 s started a
  // row spoken at 9 s two seconds early (live: "quotient = ?" at 9265 ms).
  return false;
}

export function createScheduledWriteClock(options: {
  getRawPositionMs: () => number | null | undefined;
  nowMs?: () => number;
}): () => number {
  const nowMs = options.nowMs ?? (() => (
    typeof performance !== "undefined" ? performance.now() : Date.now()
  ));
  const originMs = nowMs();
  let lastRaw = -1;
  let stalledFrames = 0;
  let maxPositionMs = 0;

  return () => {
    const raw = options.getRawPositionMs();
    if (raw != null && Number.isFinite(raw) && raw > 0) {
      if (raw === lastRaw) {
        stalledFrames += 1;
      } else {
        stalledFrames = 0;
        lastRaw = raw;
      }
    } else {
      lastRaw = -1;
      stalledFrames = 0;
    }
    const positionMs = resolveScheduledWriteClockMs({
      rawPositionMs: raw,
      elapsedWallMs: nowMs() - originMs,
      stalledFrames,
    });
    maxPositionMs = Math.max(maxPositionMs, positionMs);
    return maxPositionMs;
  };
}

export interface SimulatedWriteWaitResult {
  elapsedMs: number;
  completed: boolean;
  charsWritten: number;
}

/**
 * Drive a WRITE character schedule against a (possibly null/stuck) audio clock.
 * Used as the parked-pen regression: it must finish during speech, not hang.
 */
export function simulateScheduledWriteWait(input: {
  offsetsMs: number[];
  getRawPositionMs: (nowMs: number) => number | null;
  tickMs?: number;
  maxElapsedMs?: number;
}): SimulatedWriteWaitResult {
  const tickMs = input.tickMs ?? 16;
  const maxElapsedMs = input.maxElapsedMs ?? 8_000;
  let nowMs = 0;
  let lastRaw = -1;
  let stalledFrames = 0;
  let charsWritten = 0;

  for (const targetMs of input.offsetsMs) {
    while (true) {
      const raw = input.getRawPositionMs(nowMs);
      if (raw != null && Number.isFinite(raw) && raw > 0 && raw === lastRaw) {
        stalledFrames += 1;
      } else {
        stalledFrames = 0;
        lastRaw = raw != null && Number.isFinite(raw) ? raw : -1;
      }
      const positionMs = resolveScheduledWriteClockMs({
        rawPositionMs: raw,
        elapsedWallMs: nowMs,
        stalledFrames,
      });
      if (
        positionMs >= targetMs ||
        shouldReleaseAudioPositionWait({
          positionMs,
          targetMs,
          elapsedMs: nowMs,
          clockEverStarted: positionMs > 0 || nowMs > 0,
          stalledFrames,
        })
      ) {
        charsWritten += 1;
        break;
      }
      nowMs += tickMs;
      if (nowMs > maxElapsedMs) {
        return { elapsedMs: nowMs, completed: false, charsWritten };
      }
    }
  }

  return { elapsedMs: nowMs, completed: true, charsWritten };
}
