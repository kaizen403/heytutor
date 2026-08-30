import type { DrawCommand } from "@heytutor/drawing";
import type {
  RecordedSegmentPayload,
  StoredSegment,
  StoredTurn,
} from "@/lib/boards/boardsClient";
import { buildReplayTimeline, type ReplayTimeline } from "./replayTimeline";

/**
 * Where the student's playhead sits relative to the lecture.
 *
 * - `replay` — the lecture is over. The whole timeline is scrubbable.
 * - `live` — the lecture is running and the student is at the live edge. Only
 *   what has already been taught exists, so the track ends at "now".
 * - `rewind` — the lecture is running but paused while the student watches an
 *   earlier part of it. Same track as `live`; the playhead is behind the edge.
 */
export type LecturePlaybackMode = "replay" | "live" | "rewind";

/** Within this of the edge, the student is watching live, not the past. */
export const LIVE_EDGE_TOLERANCE_MS = 350;

/**
 * The CLEAR the runtime draws when a question takes the board
 * (`beginBoardEpoch`). `withBoardEpochSegment` prepends the same command when
 * the turn is persisted, so a rewind into the live turn wipes the previous
 * page exactly the way the lecture did.
 */
const BOARD_EPOCH_CLEAR: DrawCommand = {
  type: "CLEAR",
  params: [],
  charPosition: 0,
  narrationBefore: "",
};

/**
 * Segments the in-progress turn has already taught, in replay form. Audio is
 * captured live as raw bytes; `audioUrlFor` hands back a stable object URL per
 * segment so rebuilding the timeline does not mint a new one every tick.
 */
export function buildLiveTurnSegments(
  recorded: RecordedSegmentPayload[],
  audioUrlFor: (segment: RecordedSegmentPayload) => string | null,
): StoredSegment[] {
  const epoch: StoredSegment = {
    id: "live-epoch",
    orderIndex: 0,
    narration: "",
    spokenText: "",
    command: BOARD_EPOCH_CLEAR,
    audioUrl: null,
    durationMs: 50,
    timings: null,
  };

  return [
    epoch,
    ...recorded.map((segment, index) => ({
      id: `live-seg-${segment.orderIndex}`,
      orderIndex: index + 1,
      narration: segment.narration,
      spokenText: segment.spokenText,
      command: segment.command,
      audioUrl: audioUrlFor(segment),
      durationMs: segment.durationMs,
      timings: segment.timings,
    })),
  ];
}

/**
 * Everything taught so far — persisted turns plus the turn still being taught.
 * The returned `turns` feed the replay engine; `timeline.totalMs` is the live
 * edge, which only advances as each segment finishes and is recorded.
 */
export function buildLectureTimeline(input: {
  storedTurns: StoredTurn[];
  liveSegments: RecordedSegmentPayload[];
  liveQuestion: string;
  audioUrlFor: (segment: RecordedSegmentPayload) => string | null;
}): { turns: StoredTurn[]; timeline: ReplayTimeline } {
  const turns = [...input.storedTurns];

  if (input.liveSegments.length > 0) {
    turns.push({
      id: "live-turn",
      orderIndex: turns.length,
      question: input.liveQuestion,
      rawResponse: "",
      speedMultiplier: 1,
      traceId: null,
      sceneDocument: null,
      sceneEngineVersion: null,
      validationReport: null,
      visualStatus: null,
      sceneArtifacts: null,
      segments: buildLiveTurnSegments(input.liveSegments, input.audioUrlFor),
    });
  }

  return { turns, timeline: buildReplayTimeline(turns) };
}

export function clampToLiveEdge(ms: number, liveEdgeMs: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.min(ms, Math.max(liveEdgeMs, 0)));
}

export function isAtLiveEdge(
  ms: number,
  liveEdgeMs: number,
  toleranceMs: number = LIVE_EDGE_TOLERANCE_MS,
): boolean {
  return ms >= liveEdgeMs - toleranceMs;
}

/**
 * What the scrub track shows. During a live lecture the track stops at the
 * live edge — there is no "front part" to drag into, only the past — and the
 * thumb rides the edge until the student pulls it back.
 */
export function lectureScrubberModel(input: {
  mode: LecturePlaybackMode;
  progressMs: number;
  totalMs: number;
  liveEdgeMs: number;
}): { maxMs: number; valueMs: number; atLiveEdge: boolean } {
  if (input.mode === "replay") {
    const maxMs = Math.max(input.totalMs, 0);
    return {
      maxMs,
      valueMs: Math.max(0, Math.min(input.progressMs, maxMs)),
      atLiveEdge: false,
    };
  }

  const maxMs = Math.max(input.liveEdgeMs, 0);
  if (input.mode === "live") {
    return { maxMs, valueMs: maxMs, atLiveEdge: true };
  }

  const valueMs = clampToLiveEdge(input.progressMs, maxMs);
  return { maxMs, valueMs, atLiveEdge: isAtLiveEdge(valueMs, maxMs) };
}

/**
 * A drag only leaves the live edge when it lands meaningfully behind it —
 * otherwise a stray pixel of pointer movement would pause the lecture.
 */
export function shouldEnterRewind(seekMs: number, liveEdgeMs: number): boolean {
  return liveEdgeMs > 0 && !isAtLiveEdge(seekMs, liveEdgeMs);
}

/**
 * Which timeline the board's scrub bar is showing, and whether it is running.
 *
 * One bar serves three situations, and the difference matters: a finished
 * lecture scrubs end to end, a running one only into its past, and the
 * headless recorder has no student to scrub at all.
 */
export function resolveLecturePlayback(input: {
  isHeadless: boolean;
  isReplaying: boolean;
  /** Replay's own pause flag; shared with the live lesson. */
  isPaused: boolean;
  rewindActive: boolean;
  rewindPlaying: boolean;
  /** A live lecture with a past worth scrubbing back into. */
  canRewind: boolean;
}): { mode: LecturePlaybackMode; visible: boolean; playing: boolean } {
  const mode: LecturePlaybackMode = input.isReplaying
    ? "replay"
    : input.rewindActive
      ? "rewind"
      : "live";

  return {
    mode,
    visible:
      !input.isHeadless &&
      (input.isReplaying || input.rewindActive || input.canRewind),
    playing: input.isReplaying ? !input.isPaused : input.rewindPlaying,
  };
}

/**
 * Always-hittable live hover slab, in CSS pixels of the board overlay.
 * Opacity-0 chrome is not a reliable hit target once a transform puts it
 * on its own layer, and a 6px slider is too thin to find on a live board.
 */
export const LIVE_BAR_HIT_PX = 64;

/** Headless recording must not poll the live edge or mint bar audio URLs. */
export function shouldTrackLiveLectureEdge(input: {
  enabled: boolean;
  phase: string;
  isReplaying: boolean;
}): boolean {
  return input.enabled && input.phase !== "idle" && !input.isReplaying;
}

/** Snapshot taken before rewind calls pause: did rewind freeze a playing lecture? */
export function rewindPausedTheLecture(liveAlreadyPaused: boolean): boolean {
  return !liveAlreadyPaused;
}

/**
 * Go Live may only restart a lecture that rewind itself paused.
 * A student who had already paused stays paused.
 */
export function shouldResumeLiveAfterRewind(input: {
  rewindPausedTheLecture: boolean;
  lecturePhase: string;
}): boolean {
  return input.rewindPausedTheLecture && input.lecturePhase !== "idle";
}
