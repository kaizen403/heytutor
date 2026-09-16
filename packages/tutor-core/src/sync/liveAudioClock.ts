import {
  shouldReleaseAudioPositionWait,
} from "@heytutor/drawing";

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
  /** Live lecture rate. Wall fallback and stuck-clock detection must use media time. */
  playbackRate?: number;
}

export interface LiveAudioClock {
  positionMs: number;
  maxAudioPositionMs: number;
}

const END_PADDING_MS = 40;
const STUCK_PLAYBACK_BEHIND_WALL_MS = 250;

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
  const rate =
    typeof input.playbackRate === "number" && Number.isFinite(input.playbackRate) && input.playbackRate > 0
      ? input.playbackRate
      : 1;
  const wallClockMs =
    input.audioStartedAtMs !== null
      ? Math.max(input.nowMs - input.audioStartedAtMs, 0)
      : null;
  const wallMediaMs = wallClockMs !== null ? wallClockMs * rate : null;

  // 0 and negative positions mean "scheduled but not audible yet". Treating
  // them as a live clock pinned the pen at t=0 while speech was already going.
  if (
    playback !== null &&
    Number.isFinite(playback) &&
    playback > 0 &&
    playback + 50 >= input.maxAudioPositionMs
  ) {
    if (wallMediaMs !== null && playback + STUCK_PLAYBACK_BEHIND_WALL_MS < wallMediaMs) {
      const positionMs = Math.max(input.maxAudioPositionMs, wallMediaMs);
      return { positionMs, maxAudioPositionMs: positionMs };
    }
    const positionMs = playback;
    const maxAudioPositionMs = Math.max(input.maxAudioPositionMs, positionMs);
    return { positionMs, maxAudioPositionMs };
  }

  if (wallMediaMs !== null) {
    const positionMs = Math.max(input.maxAudioPositionMs, wallMediaMs);
    return { positionMs, maxAudioPositionMs: positionMs };
  }

  // Audio has not started. Keep the pen ready on the estimated schedule —
  // never return -1, which used to hang writeText until speechComplete.
  return { positionMs: 0, maxAudioPositionMs: Math.max(input.maxAudioPositionMs, 0) };
}

export { shouldReleaseAudioPositionWait };

/**
 * How long the pen waits for an alignment once the voice has started.
 *
 * Measured 10 Sep 2026 over 20 sentences: a prefetched sentence hands its
 * alignment over 1 to 3 ms before `onStart`, a sentence generated on demand
 * 1 ms before, and HTTP transports before `onStart` as well. The browser
 * voice never sends one. 120 ms covers every transport that will deliver at
 * all, and when nothing is coming it holds the pen for less than the audible
 * onset (20 to 73 ms after `onStart`) plus one frame.
 */
export const INITIAL_TIMING_GRACE_AFTER_START_MS = 120;

export interface InitialTimingWaitState {
  hasNarration: boolean;
  /** Characters in the alignment captured so far; 0 while none has arrived. */
  timingChars: number;
  /** Wall ms when the voice's `onStart` fired, null until it has. */
  audioStartedAtMs: number | null;
  nowMs: number;
  speechComplete: boolean;
  cancelled: boolean;
}

export type InitialTimingWaitRelease =
  /** The exact alignment is in hand: the schedule is built on it. */
  | "tts"
  /** The voice is speaking and nothing arrived in the grace window. */
  | "estimated"
  /** Speech ended, or failed, before any alignment arrived. */
  | "complete"
  | "cancelled"
  /** Nothing is spoken, so there is nothing to wait for. */
  | "silent";

export type InitialTimingWaitDecision =
  | { release: true; source: InitialTimingWaitRelease }
  | {
      release: false;
      /** Wall ms at which the grace window closes; null while the voice has not started. */
      releaseAtMs: number | null;
    };

/**
 * Whether the runner may build its first schedule yet.
 *
 * The old gate waited only when audio had already started, and in the paired
 * path it never had: the schedule was built 1 to 3 ms before the prefetched
 * alignment was replayed, so every WRITE row of a lesson ran on the estimate
 * with the exact timings sitting unread (15 of 15 rows, 10 Sep 2026). This
 * decides on the four things that can end the wait, and nothing else.
 */
export function resolveInitialTimingWait(state: InitialTimingWaitState): InitialTimingWaitDecision {
  if (state.cancelled) {
    return { release: true, source: "cancelled" };
  }
  if (!state.hasNarration) {
    return { release: true, source: "silent" };
  }
  if (state.timingChars > 0) {
    return { release: true, source: "tts" };
  }
  if (state.speechComplete) {
    return { release: true, source: "complete" };
  }
  if (state.audioStartedAtMs === null) {
    return { release: false, releaseAtMs: null };
  }
  const releaseAtMs = state.audioStartedAtMs + INITIAL_TIMING_GRACE_AFTER_START_MS;
  if (state.nowMs >= releaseAtMs) {
    return { release: true, source: "estimated" };
  }
  return { release: false, releaseAtMs };
}

/** What became of the exact alignment when a handwriting schedule was built. */
export type TtsScheduleUse =
  /** The schedule is the alignment. */
  | "used"
  /** No alignment had arrived. */
  | "missing"
  /** An alignment arrived and failed validation against the narration. */
  | "invalid"
  /** A valid alignment, but no board token was found in the spoken text. */
  | "unmatched"
  /** A matched schedule that the usability rule rejected. */
  | "unusable";

export interface TtsScheduleUseInput {
  scheduleSource: "tts" | "estimated";
  scheduleReason?: string | null;
  timingChars: number;
  timingValid: boolean;
}

/**
 * Names why a row is not on the exact clock, so a log line answers it
 * without a second probe. `schedule_source: estimated` alone could not tell a
 * sentence whose alignment never came from one whose alignment was thrown
 * away.
 */
export function classifyTtsScheduleUse(input: TtsScheduleUseInput): TtsScheduleUse {
  if (input.scheduleSource === "tts") {
    return "used";
  }
  if (input.timingChars <= 0) {
    return "missing";
  }
  if (!input.timingValid) {
    return "invalid";
  }
  if (input.scheduleReason === "tts-schedule-unusable") {
    return "unusable";
  }
  return "unmatched";
}
