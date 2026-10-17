import type { DrawCommand } from "@heytutor/drawing";
import type { ExecuteCommandOptions } from "../../hooks/turn/types";
import type { SegmentInkClock } from "./segmentInk";

/** Leave the pen's approach to WRITE's existing character schedule. */
const WRITE_APPROACH_WALL_MS = 800;
const MIN_EXPLANATION_GAP_WALL_MS = 2_400;

/**
 * Point at already-written work while the voice explains. This is transient
 * runtime motion, never an authored/persisted command or a diagram reveal.
 * A leading gap owns the already-computed WRITE cue: recomputing its estimated
 * schedule after touring would change its initial-wait clamp and move the ink.
 */
export async function pointThroughExplanation(input: {
  clock: SegmentInkClock;
  execute: (command: DrawCommand, options: ExecuteCommandOptions) => Promise<void>;
  isCancelled: () => boolean;
  /** Omit for the explanation after the sentence's last command. */
  beforeWriteMs?: number;
}): Promise<void> {
  const { clock, isCancelled } = input;
  if (!clock.narration.trim() || isCancelled() || clock.isSpeechComplete?.()) return;
  const rate = () => {
    const value = clock.getPlaybackRate();
    return Number.isFinite(value) && value > 0 ? value : 1;
  };
  const deadline = () => {
    if (input.beforeWriteMs !== undefined) {
      return input.beforeWriteMs - WRITE_APPROACH_WALL_MS * rate();
    }
    const alignedMs = (clock.getTimings()?.totalDuration ?? 0) * 1000;
    return alignedMs > 0 && Number.isFinite(alignedMs) ? alignedMs : clock.totalSpeechMs;
  };
  const remainingMs = deadline() - clock.getAudioPositionMs();
  if (remainingMs / rate() < MIN_EXPLANATION_GAP_WALL_MS) return;
  await input.execute({ type: "POINT", text: "last", params: [], charPosition: 0, narrationBefore: "" }, {
    applyLayout: false,
    explanationPointing: true,
    isCancelled,
    segmentNarration: clock.narration,
    speechDurationMs: remainingMs / rate(),
    speechShareMs: remainingMs / rate(),
    getPointDeadlineMs: deadline,
    isPaused: clock.isPaused,
    spokenClock: {
      narration: clock.narration,
      getTimings: clock.getTimings,
      estimatedTotalMs: clock.totalSpeechMs,
      getAudioPositionMs: clock.getAudioPositionMs,
      getPlaybackRate: clock.getPlaybackRate,
      isSpeechComplete: clock.isSpeechComplete,
      canAdvanceAfterSpeech: clock.canAdvanceAfterSpeech,
      msPerChar: clock.msPerChar,
    },
  });
}
