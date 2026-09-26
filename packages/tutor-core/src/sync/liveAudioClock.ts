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

export function resolveLiveAudioPositionMs(input: LiveAudioClockInput): LiveAudioClock {
  if (input.speechComplete) {
    // Browser fallback may hand us a short or partial alignment only when it
    // ends. Estimated FOCUS and WRITE cues can sit beyond that duration; if
    // the finished clock stops at the reported end, each later cue waits for
    // its timeout even though there is no voice left to follow.
    const endPosition = Math.max(
      input.capturedDurationMs ?? 0,
      input.estimateSpeechMs,
      input.maxAudioPositionMs,
      0,
    ) + END_PADDING_MS;
    return { positionMs: endPosition, maxAudioPositionMs: endPosition };
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
  //
  // Once a positive playback position exists it is the voice, even if a wall
  // fallback ran ahead of it. Requiring `playback + 50 >= maxAudioPositionMs`
  // locked the pen onto that raced wall clock for the rest of the sentence.
  // A frozen playback is reported honestly; `resolveWriteWaitClockMs` unsticks
  // the pen after stalled frames rather than this clock inventing a lead.
  if (playback !== null && Number.isFinite(playback) && playback > 0) {
    return { positionMs: playback, maxAudioPositionMs: playback };
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
/**
 * `onStart` fires when playback is *about to be scheduled*, not when the first
 * sample is audible. Measured gap: tens to a few hundred ms of decode / HTML
 * audio spin-up. The pen must not run a 1.5× wall clock across that gap.
 */
export const AUDIBLE_GRACE_AFTER_START_MS = 280;
/**
 * If TTS never starts (relay skip, HTTP hang, autoplay), the preparing overlay
 * must not sit on the board forever. Eight seconds is longer than a healthy
 * first-chunk and shorter than a student waiting out a dead lecture.
 */
export const INITIAL_AUDIO_GIVE_UP_MS = 8_000;

export function isPlaybackAudible(playbackPositionMs: number | null | undefined): boolean {
  return (
    playbackPositionMs != null &&
    Number.isFinite(playbackPositionMs) &&
    playbackPositionMs > 0
  );
}

export interface InitialTimingWaitState {
  hasNarration: boolean;
  /** Characters in the alignment captured so far; 0 while none has arrived. */
  timingChars: number;
  /** Wall ms when the voice's `onStart` fired, null until it has. */
  audioStartedAtMs: number | null;
  nowMs: number;
  speechComplete: boolean;
  cancelled: boolean;
  /**
   * Live TTS media position. `onStart` is not audibility: wait until this is
   * positive (or the audible grace expires) before building a handwriting
   * schedule.
   */
  playbackPositionMs?: number | null;
  /** Ms since this waiter armed. Used only to give up when the voice never starts. */
  waitedMs?: number;
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
  | "silent"
  /** The voice never started; drop the overlay rather than spin forever. */
  | "give_up";

export type InitialTimingWaitDecision =
  | { release: true; source: InitialTimingWaitRelease }
  | {
      release: false;
      /** Wall ms at which the grace window closes; null while the voice has not started. */
      releaseAtMs: number | null;
    };

/**
 * Whether the runner may start inking this spoken segment.
 *
 * A peeked alignment is not permission to draw. Releasing on timings alone
 * let the pen run the whole figure on the wall clock at playback speed while
 * TTS was still connecting — a silent 1.5–2× dump, then the lecture "started".
 * `onStart` is also not permission: it fires before the first sample is
 * audible. Wait until playback is actually advancing, then use the alignment
 * that is already in hand.
 */
export function resolveInitialTimingWait(state: InitialTimingWaitState): InitialTimingWaitDecision {
  if (state.cancelled) {
    return { release: true, source: "cancelled" };
  }
  if (!state.hasNarration) {
    return { release: true, source: "silent" };
  }
  if (state.audioStartedAtMs === null) {
    if (state.speechComplete) {
      return { release: true, source: "complete" };
    }
    if ((state.waitedMs ?? 0) >= INITIAL_AUDIO_GIVE_UP_MS) {
      return { release: true, source: "give_up" };
    }
    return { release: false, releaseAtMs: null };
  }
  const audible = isPlaybackAudible(state.playbackPositionMs);
  if (!audible) {
    if (state.speechComplete) {
      return { release: true, source: "complete" };
    }
    const audibleAtMs = state.audioStartedAtMs + AUDIBLE_GRACE_AFTER_START_MS;
    if (state.nowMs < audibleAtMs) {
      return { release: false, releaseAtMs: audibleAtMs };
    }
  }
  if (state.timingChars > 0) {
    return { release: true, source: "tts" };
  }
  if (state.speechComplete) {
    return { release: true, source: "complete" };
  }
  const releaseAtMs = state.audioStartedAtMs + INITIAL_TIMING_GRACE_AFTER_START_MS;
  if (state.nowMs >= releaseAtMs) {
    return { release: true, source: "estimated" };
  }
  return { release: false, releaseAtMs };
}

/**
 * Spoken ink stays off the board until the voice is audible. A segment whose
 * speech finished without `onStart` must not dump its commands in silence.
 * Draw-only segments (no narration) may ink immediately.
 */
export function shouldStartLiveDraw(input: {
  hasNarration: boolean;
  audioStarted: boolean;
}): boolean {
  return !input.hasNarration || input.audioStarted;
}

/**
 * Whether this spoken beat may start inking.
 *
 * A beat that never started audio must not dump its commands. Browser speech
 * can fire `onStart` and then fail the utterance; that partial start is still
 * a failed beat. A primary voice that already started and later stalled may
 * keep the ink that matches what was heard.
 */
export function shouldInkSpokenSegment(input: {
  hasNarration: boolean;
  audioStarted: boolean;
  speechFailed: boolean;
  browserFallback: boolean;
}): boolean {
  if (input.speechFailed && (!input.audioStarted || input.browserFallback)) {
    return false;
  }
  return shouldStartLiveDraw({
    hasNarration: input.hasNarration,
    audioStarted: input.audioStarted,
  });
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
