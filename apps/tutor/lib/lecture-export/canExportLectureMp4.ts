import type { StoredTurn } from "@/lib/boards/boardsClient";
import { pageTurnsEndingAt } from "@/lib/boards/boardContinuation";
import type { ReplayCue } from "@/lib/replay/replayTimeline";
import { lectureExportCacheKey } from "./lectureExportFrames";
import { LECTURE_EXPORT_PLAYBACK_RATE } from "./lectureExportSpeed";
import type { LectureContainer } from "./lectureExportProfile";
import type { TutorPhase } from "@/features/tutor-session/types";

export type LectureEncoderGlobals = {
  VideoEncoder?: unknown;
  AudioEncoder?: unknown;
  VideoFrame?: unknown;
  AudioData?: unknown;
};

/**
 * Firefox encodes VP8/VP9 and can mux PCM without AudioEncoder. Only the
 * video WebCodecs pair is required; AAC is a Chrome/Safari bonus.
 */
export function canEncodeLectureMp4(
  globals: LectureEncoderGlobals = globalThis as LectureEncoderGlobals,
): boolean {
  return typeof globals.VideoEncoder === "function" && typeof globals.VideoFrame === "function";
}

export function speakingLectureSegments(turn: StoredTurn): StoredTurn["segments"] {
  return turn.segments.filter(
    (segment) => segment.narration.trim().length > 0 || segment.spokenText.trim().length > 0,
  );
}

export function turnHasExportableAudio(turn: StoredTurn): boolean {
  const speaking = speakingLectureSegments(turn);
  if (speaking.length === 0) {
    return false;
  }
  return speaking.some((segment) => Boolean(segment.audioUrl));
}

export function latestCompletedTurn(turns: StoredTurn[]): StoredTurn | null {
  if (turns.length === 0) {
    return null;
  }
  return turns.reduce((latest, turn) => (turn.orderIndex >= latest.orderIndex ? turn : latest));
}

export function canExportLectureTurn(turn: StoredTurn | null): boolean {
  return turn != null && turnHasExportableAudio(turn);
}

/**
 * The page the header download exports: the latest question and every doubt
 * answered under it, oldest first. A doubt continues the lesson's page, so
 * exporting it alone would record a few rows on a blank board with no figure.
 */
export function latestLecturePage(turns: StoredTurn[]): StoredTurn[] {
  const ordered = [...turns].sort((a, b) => a.orderIndex - b.orderIndex);
  return pageTurnsEndingAt(ordered);
}

export function pageHasExportableAudio(turns: readonly StoredTurn[]): boolean {
  return turns.some(turnHasExportableAudio);
}

/**
 * Cache identity of a page export. It changes whenever a doubt adds a turn to
 * the page, and a page of one turn keys exactly as that turn always has.
 */
export function lecturePageCacheKey(
  turns: readonly StoredTurn[],
  fileType: LectureContainer = "mp4",
): string {
  const turnsKey = turns.map((turn) => lectureExportCacheKey(turn)).join("+");
  const base = `${turnsKey}@${LECTURE_EXPORT_PLAYBACK_RATE}`;
  return fileType === "mp4" ? base : `${base}.${fileType}`;
}

export function shouldCancelLectureExport(state: {
  cancelled: boolean;
  phase: TutorPhase;
  isReplaying: boolean;
}): boolean {
  return state.cancelled || state.phase !== "idle" || state.isReplaying;
}

export function cueHasSpokenAudio(cue: ReplayCue): boolean {
  const spoken = cue.narration.trim().length > 0;
  return spoken && Boolean(cue.audioUrl);
}

export function lectureDownloadFilename(
  question: string,
  extension: LectureContainer = "mp4",
): string {
  const slug = question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `lecture-${slug || "question"}.${extension}`;
}
