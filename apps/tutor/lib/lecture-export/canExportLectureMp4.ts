import type { StoredTurn } from "@/lib/boards/boardsClient";
import type { ReplayCue } from "@/lib/replay/replayTimeline";
import type { TutorPhase } from "@/features/tutor-session/types";

export type LectureEncoderGlobals = {
  VideoEncoder?: unknown;
  AudioEncoder?: unknown;
  VideoFrame?: unknown;
  AudioData?: unknown;
};

export function canEncodeLectureMp4(
  globals: LectureEncoderGlobals = globalThis as LectureEncoderGlobals,
): boolean {
  return (
    typeof globals.VideoEncoder === "function" &&
    typeof globals.AudioEncoder === "function" &&
    typeof globals.VideoFrame === "function" &&
    typeof globals.AudioData === "function"
  );
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

export function lectureDownloadFilename(question: string): string {
  const slug = question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `lecture-${slug || "question"}.mp4`;
}
