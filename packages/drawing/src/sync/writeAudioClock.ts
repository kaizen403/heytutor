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
  if (input.clockEverStarted && input.stalledFrames >= 30) {
    return true;
  }
  if (input.clockEverStarted && input.elapsedMs > Math.min(input.targetMs + 2000, 8000)) {
    return true;
  }
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
