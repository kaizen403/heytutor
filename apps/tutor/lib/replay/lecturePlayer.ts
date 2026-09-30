import type { ReplayCue } from "./replayTimeline";
import { buildReplayTimeline } from "./replayTimeline";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { storedTurnContinuesBoard } from "@/lib/boards/boardContinuation";

/**
 * The finished-lecture player: one stitched audio track is the clock, and the
 * board is drawn as a function of that clock. Everything here is pure so the
 * seek rules, the gate and the store can be checked without a browser.
 */

/** One question or doubt on the board, as a stretch of the timeline. */
export interface LecturePlayerChapter {
  id: string;
  turnIndex: number;
  title: string;
  startMs: number;
  endMs: number;
}

export interface LecturePlayerTimeline {
  cues: ReplayCue[];
  totalMs: number;
  chapters: LecturePlayerChapter[];
  /**
   * For each turn index, the turn index that opened its page. A doubt answered
   * on the lesson's page points back at the lesson; a question points at itself.
   */
  pageStartTurnIndex: number[];
}

export interface LecturePlayerSeekPlan {
  /** Clamped to [0, totalMs]. */
  targetMs: number;
  /** First cue of the page `targetMs` falls on. Catch-up draws from here. */
  epochCueIndex: number;
  /** Cue containing `targetMs`; the last cue when `targetMs` is the end. */
  targetCueIndex: number;
  /** `targetMs - cues[targetCueIndex].startMs`. */
  targetOffsetMs: number;
}

export type LecturePlayerStatus =
  | "unavailable"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "seeking"
  | "ended";

export interface LecturePlayerSnapshot {
  status: LecturePlayerStatus;
  /** True once playback has started and the player board owns the picture. */
  active: boolean;
  positionMs: number;
  durationMs: number;
  /** How much of the audio track is decoded, in lecture ms (0..durationMs). */
  loadedMs: number;
  rate: number;
  chapters: LecturePlayerChapter[];
  /** Set when the audio track failed to load. */
  error: string | null;
}

export interface LecturePlayerStore {
  getSnapshot: () => LecturePlayerSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Shallow-merges `patch`; listeners only fire when a field changed. */
  set: (patch: Partial<LecturePlayerSnapshot>) => void;
}

export interface LecturePlayerControls {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (ms: number) => void;
  skip: (deltaMs: number) => void;
  setRate: (rate: number) => void;
}

export type LecturePlayerKeyAction = "toggle" | "back" | "forward" | "start" | "end";

export const LECTURE_PLAYER_SKIP_MS = 10_000;

/**
 * The pace the lecture actually plays at.
 *
 * 1.25 is the default stop. It sits a little under real time, so it is not
 * the same pace as 1.5. Every other stop is the number on the menu.
 */
export function lecturePaceRate(selected: number): number {
  if (!Number.isFinite(selected) || selected <= 0) return 1;
  if (Math.abs(selected - 1.25) < 0.001) return 0.9;
  return Math.min(Math.max(selected, 0.1), 4);
}

/**
 * Seconds to put on an HTML media element for a lecture seek.
 *
 * Playing from the exact duration leaves the element `ended`, which is silent.
 */
export function mediaSecondsForSeek(targetMs: number, durationSec: number): number {
  const seconds = (Number.isFinite(targetMs) ? Math.max(0, targetMs) : 0) / 1000;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return seconds;
  return Math.min(seconds, Math.max(durationSec - 0.05, 0));
}

export function audioIsAtMediaEnd(audio: {
  ended: boolean;
  currentTime: number;
  duration: number;
}): boolean {
  if (audio.ended) return true;
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return false;
  return audio.currentTime >= audio.duration - 0.05;
}

/** `m:ss`, or `h:mm:ss` from an hour up. */
export function formatPlayerTime(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = seconds.toString().padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

export function chapterAt(
  chapters: readonly LecturePlayerChapter[],
  ms: number,
): LecturePlayerChapter | null {
  if (chapters.length === 0) return null;
  for (let index = chapters.length - 1; index >= 0; index--) {
    const chapter = chapters[index]!;
    if (ms >= chapter.startMs) return chapter;
  }
  return chapters[0]!;
}

/** Position on the track as 0..1. */
export function timelineFraction(ms: number, totalMs: number): number {
  if (!(totalMs > 0) || !Number.isFinite(ms)) return 0;
  return Math.max(0, Math.min(ms / totalMs, 1));
}

const MAX_CHAPTER_TITLE_CHARS = 80;

function clampMs(ms: number, maxMs: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.min(ms, Math.max(0, maxMs)));
}

function chapterTitle(question: string, chapterNumber: number): string {
  const normalized = question.replace(/\s+/g, " ").trim();
  if (!normalized) return `Question ${chapterNumber}`;
  if (normalized.length > MAX_CHAPTER_TITLE_CHARS) {
    return `${normalized.slice(0, MAX_CHAPTER_TITLE_CHARS - 1).trimEnd()}…`;
  }
  return normalized;
}

export function buildLecturePlayerTimeline(turns: StoredTurn[]): LecturePlayerTimeline {
  const { cues, totalMs } = buildReplayTimeline(turns);

  const firstCueStartByTurn = new Map<number, number>();
  for (const cue of cues) {
    if (!firstCueStartByTurn.has(cue.turnIndex)) {
      firstCueStartByTurn.set(cue.turnIndex, cue.startMs);
    }
  }

  const chapters: LecturePlayerChapter[] = [];
  turns.forEach((turn, turnIndex) => {
    const startMs = firstCueStartByTurn.get(turnIndex);
    if (startMs === undefined) return;
    chapters.push({
      id: turn.id,
      turnIndex,
      title: chapterTitle(turn.question, chapters.length + 1),
      startMs,
      endMs: totalMs,
    });
  });
  for (let index = 0; index < chapters.length - 1; index++) {
    chapters[index]!.endMs = chapters[index + 1]!.startMs;
  }

  // A turn that drew nothing leaves the page before it on the board, so a
  // doubt after it still belongs to that page.
  const pageStartTurnIndex: number[] = [];
  turns.forEach((turn, turnIndex) => {
    const keepsPage =
      turnIndex > 0 && (storedTurnContinuesBoard(turn) || !firstCueStartByTurn.has(turnIndex));
    pageStartTurnIndex.push(keepsPage ? pageStartTurnIndex[turnIndex - 1]! : turnIndex);
  });

  return { cues, totalMs, chapters, pageStartTurnIndex };
}

function segmentHasNarration(segment: StoredTurn["segments"][number]): boolean {
  return segment.narration.trim().length > 0;
}

function segmentHasAudio(segment: StoredTurn["segments"][number]): boolean {
  return Boolean(segment.audioUrl?.trim());
}

/** Every narrated segment has recorded audio, and there is at least one. */
export function lectureAudioComplete(turns: StoredTurn[]): boolean {
  let spoken = 0;
  for (const turn of turns) {
    for (const segment of turn.segments) {
      if (!segmentHasNarration(segment)) continue;
      if (!segmentHasAudio(segment)) return false;
      spoken += 1;
    }
  }
  return spoken > 0;
}

/**
 * The finished-lecture bar can stitch silence over a missing clip. It only
 * needs one narrated step with audio, not a perfect recording of every step.
 */
export function lectureHasPlayableAudio(turns: StoredTurn[]): boolean {
  for (const turn of turns) {
    for (const segment of turn.segments) {
      if (segmentHasNarration(segment) && segmentHasAudio(segment)) return true;
    }
  }
  return false;
}

export function canPlayFinishedLecture(input: {
  isHeadless: boolean;
  phase: string;
  lectureActive: boolean;
  storedTurns: StoredTurn[];
}): boolean {
  return (
    !input.isHeadless &&
    input.phase === "idle" &&
    !input.lectureActive &&
    input.storedTurns.length > 0 &&
    lectureHasPlayableAudio(input.storedTurns) &&
    buildReplayTimeline(input.storedTurns).totalMs > 0
  );
}

export function planLectureSeek(
  timeline: LecturePlayerTimeline,
  ms: number,
): LecturePlayerSeekPlan | null {
  const { cues, totalMs } = timeline;
  if (cues.length === 0) return null;

  const targetMs = clampMs(ms, totalMs);
  let targetCueIndex = cues.length - 1;
  if (targetMs < totalMs) {
    const found = cues.findIndex((cue) => cue.startMs <= targetMs && targetMs < cue.endMs);
    if (found !== -1) targetCueIndex = found;
  }
  const targetCue = cues[targetCueIndex]!;

  const pageStart = timeline.pageStartTurnIndex[targetCue.turnIndex];
  let epochCueIndex =
    pageStart === undefined ? -1 : cues.findIndex((cue) => cue.turnIndex === pageStart);
  if (epochCueIndex === -1) {
    epochCueIndex = cues.findIndex((cue) => cue.turnIndex === targetCue.turnIndex);
  }
  if (epochCueIndex === -1) epochCueIndex = 0;

  return {
    targetMs,
    epochCueIndex,
    targetCueIndex,
    targetOffsetMs: targetMs - targetCue.startMs,
  };
}

export interface SmoothedMediaClock {
  sample: (input: { mediaMs: number; wallMs: number; playing: boolean; rate: number }) => number;
  /** Hard re-anchor after a seek; the next sample may be lower than earlier ones. */
  reset: (mediaMs: number, wallMs: number) => void;
}

/**
 * A media element's `currentTime` is coarse (Firefox reports about four times a
 * second), so this interpolates between reports on the wall clock. While
 * playing the output never runs backwards; a report further than `maxDriftMs`
 * from the prediction wins outright.
 */
export function createSmoothedMediaClock(options?: { maxDriftMs?: number }): SmoothedMediaClock {
  const maxDriftMs = options?.maxDriftMs ?? 120;
  let anchored = false;
  let anchorMedia = 0;
  let anchorWall = 0;
  let lastMedia = 0;
  let lastOutput: number | null = null;

  const anchor = (mediaMs: number, wallMs: number) => {
    anchored = true;
    anchorMedia = mediaMs;
    anchorWall = wallMs;
  };

  return {
    sample({ mediaMs, wallMs, playing, rate }) {
      if (!anchored) {
        anchor(mediaMs, wallMs);
        lastMedia = mediaMs;
      }
      if (!playing) {
        anchor(mediaMs, wallMs);
        lastMedia = mediaMs;
        lastOutput = mediaMs;
        return mediaMs;
      }
      if (mediaMs !== lastMedia) anchor(mediaMs, wallMs);
      let predicted = anchorMedia + (wallMs - anchorWall) * Math.max(rate, 0);
      if (Math.abs(predicted - mediaMs) > maxDriftMs) {
        predicted = mediaMs;
        anchor(mediaMs, wallMs);
      }
      const output = lastOutput === null ? predicted : Math.max(lastOutput, predicted);
      lastOutput = output;
      lastMedia = mediaMs;
      return output;
    },
    reset(mediaMs, wallMs) {
      anchor(mediaMs, wallMs);
      lastMedia = mediaMs;
      lastOutput = mediaMs;
    },
  };
}

export interface SeekQueue {
  /** True when the caller should start seeking to `ms` now. */
  request: (ms: number) => boolean;
  /** The next target to seek to, or null when the queue went idle. */
  finish: () => number | null;
  busy: () => boolean;
  clear: () => void;
}

/** One seek in flight; requests made meanwhile collapse to the latest. */
export function createSeekQueue(): SeekQueue {
  let running = false;
  let pending: number | null = null;
  return {
    request(ms) {
      if (!running) {
        running = true;
        return true;
      }
      pending = ms;
      return false;
    },
    finish() {
      if (pending !== null) {
        const next = pending;
        pending = null;
        return next;
      }
      running = false;
      return null;
    },
    busy: () => running,
    clear() {
      running = false;
      pending = null;
    },
  };
}

const DEFAULT_LECTURE_PLAYER_SNAPSHOT: LecturePlayerSnapshot = {
  status: "unavailable",
  active: false,
  positionMs: 0,
  durationMs: 0,
  loadedMs: 0,
  rate: 1,
  chapters: [],
  error: null,
};

export function createLecturePlayerStore(
  initial?: Partial<LecturePlayerSnapshot>,
): LecturePlayerStore {
  let snapshot: LecturePlayerSnapshot = { ...DEFAULT_LECTURE_PLAYER_SNAPSHOT, ...initial };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(patch) {
      const keys = Object.keys(patch) as (keyof LecturePlayerSnapshot)[];
      if (keys.every((key) => Object.is(snapshot[key], patch[key]))) return;
      snapshot = { ...snapshot, ...patch };
      for (const listener of [...listeners]) listener();
    },
  };
}

export function lecturePlayerKeyAction(input: {
  key: string;
  withModifier: boolean;
  typing: boolean;
  dialogOpen: boolean;
}): LecturePlayerKeyAction | null {
  if (input.withModifier || input.typing || input.dialogOpen) return null;
  switch (input.key) {
    case " ":
    case "k":
    case "K":
      return "toggle";
    case "ArrowLeft":
    case "j":
    case "J":
      return "back";
    case "ArrowRight":
    case "l":
    case "L":
      return "forward";
    case "Home":
      return "start";
    case "End":
      return "end";
    default:
      return null;
  }
}

export function skipTarget(positionMs: number, deltaMs: number, totalMs: number): number {
  return clampMs(positionMs + deltaMs, totalMs);
}

export function msFromFraction(fraction: number, totalMs: number): number {
  if (!Number.isFinite(fraction) || !Number.isFinite(totalMs)) return 0;
  return Math.max(0, Math.min(fraction, 1)) * totalMs;
}
