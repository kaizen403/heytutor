import type { LecturePlayerView } from "../../hooks/useLecturePlayer";
import type { TutorPhase } from "../../types";

/** Shown above the caption while a sentence is taught without its voice. */
export const VOICE_UNAVAILABLE_NOTICE = "Voice unavailable, showing the words";

/**
 * The same narration follows live ink, rewind, and finished playback.
 *
 * A live sentence taught silently (both voices failed) forces its narration
 * as the caption whatever the subtitle setting, the way a code lesson does,
 * with a short notice: otherwise the student sees ink and hears nothing, with
 * no word of why. The flag clears when a later sentence speaks.
 */
export function sessionCaption({
  enabled,
  phase,
  currentSegmentText,
  rewindActive,
  rewindSegmentText,
  playerView,
  voiceDegraded = false,
}: {
  enabled: boolean;
  phase: TutorPhase;
  currentSegmentText: string;
  rewindActive: boolean;
  rewindSegmentText: string;
  playerView?: LecturePlayerView | null;
  voiceDegraded?: boolean;
}): { text: string; visible: boolean; notice: string | null } {
  if (playerView?.active) {
    return {
      text: playerView.segmentText,
      visible: enabled && playerView.revealed && playerView.segmentText.length > 0,
      notice: null,
    };
  }
  if (rewindActive) {
    return { text: rewindSegmentText, visible: enabled && rewindSegmentText.length > 0, notice: null };
  }
  const live = phase === "speaking" || phase === "drawing";
  const silent = voiceDegraded && live && currentSegmentText.trim().length > 0;
  return {
    text: currentSegmentText,
    visible: (enabled || silent) && live,
    notice: silent ? VOICE_UNAVAILABLE_NOTICE : null,
  };
}
