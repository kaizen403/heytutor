/**
 * Live whiteboard clock. Writing must never wait for a missing TTS position
 * until the sentence ends — that is the "speak, pause, then ink" failure.
 */
export interface LiveAudioClockInput {
  speechComplete: boolean;
  capturedDurationMs: number | null;
  estimateSpeechMs: number;
  playbackPositionMs: number | null;
  audioStartedAtMs: number | null;
  nowMs: number;
  maxAudioPositionMs: number;
}

export interface LiveAudioClock {
  positionMs: number;
  maxAudioPositionMs: number;
}

const END_PADDING_MS = 40;

export function resolveLiveAudioPositionMs(input: LiveAudioClockInput): LiveAudioClock {
  if (input.speechComplete) {
    const durationMs =
      input.capturedDurationMs ??
      Math.max(input.estimateSpeechMs, 0);
    const endPosition = durationMs + END_PADDING_MS;
    const maxAudioPositionMs = Math.max(input.maxAudioPositionMs, endPosition);
    return { positionMs: endPosition, maxAudioPositionMs };
  }

  const playback = input.playbackPositionMs;
  // 0 and negative positions mean "scheduled but not audible yet". Treating
  // them as a live clock pinned the pen at t=0 while speech was already going.
  if (
    playback !== null &&
    Number.isFinite(playback) &&
    playback > 0 &&
    playback + 50 >= input.maxAudioPositionMs
  ) {
    const positionMs = playback;
    const maxAudioPositionMs = Math.max(input.maxAudioPositionMs, positionMs);
    return { positionMs, maxAudioPositionMs };
  }

  if (input.audioStartedAtMs !== null) {
    const wallClockMs = Math.max(input.nowMs - input.audioStartedAtMs, 0);
    const positionMs = Math.max(input.maxAudioPositionMs, wallClockMs);
    return { positionMs, maxAudioPositionMs: positionMs };
  }

  // Audio has not started. Keep the pen ready on the estimated schedule —
  // never return -1, which used to hang writeText until speechComplete.
  return { positionMs: 0, maxAudioPositionMs: Math.max(input.maxAudioPositionMs, 0) };
}

/** True when the pen should stop waiting for a cue that will never arrive. */
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
