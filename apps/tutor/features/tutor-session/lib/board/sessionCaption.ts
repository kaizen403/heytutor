import type { LecturePlayerView } from "../../hooks/useLecturePlayer";
import type { TutorPhase } from "../../types";

/** The same narration follows live ink, rewind, and finished playback. */
export function sessionCaption({
  enabled,
  phase,
  currentSegmentText,
  rewindActive,
  rewindSegmentText,
  playerView,
}: {
  enabled: boolean;
  phase: TutorPhase;
  currentSegmentText: string;
  rewindActive: boolean;
  rewindSegmentText: string;
  playerView?: LecturePlayerView | null;
}): { text: string; visible: boolean } {
  if (playerView?.active) {
    return {
      text: playerView.segmentText,
      visible: enabled && playerView.revealed && playerView.segmentText.length > 0,
    };
  }
  return {
    text: rewindActive ? rewindSegmentText : currentSegmentText,
    visible: enabled && (rewindActive
      ? rewindSegmentText.length > 0
      : phase === "speaking" || phase === "drawing"),
  };
}
